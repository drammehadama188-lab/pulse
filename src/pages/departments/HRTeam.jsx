import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, AlertTriangle, Target, Shield,
  Plus, Edit2, Trash2, Settings, ChevronDown, UserX, RotateCcw,
} from 'lucide-react';
import { team, pastStaff, payrollHistory } from '../../data/team';
import Contracts from '../Contracts.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

// HR & Team — migrated from the Founder Hub HR page into Pulse.
// Metrics read from team.js (Pulse's roster source of truth). KPI rules and
// warnings persist via Pulse's own API (/api/kpi-rules, /api/warnings).

const workingTeam = team.filter(t => t.status !== 'maternity');
const activeTeam = team.filter(t => t.status === 'active');
const probationTeam = team.filter(t => t.status === 'probation');
const trainingTeam = team.filter(t => t.status === 'training');
const totalBase = workingTeam.reduce((sum, t) => sum + t.base, 0);
const totalPayroll = team.reduce((sum, t) => sum + t.total, 0);
const today = new Date();

const alerts = [];
team.filter(t => t.performance > 0 && t.performance < 40 && t.status !== 'maternity').forEach(t => {
  alerts.push({ type: 'danger', msg: `${t.name} is underperforming (${t.performance}%)`, detail: t.nextActionNote });
});
probationTeam.concat(trainingTeam).forEach(t => {
  if (!t.contractEnd) return;
  const daysLeft = Math.ceil((new Date(t.contractEnd) - today) / 86400000);
  if (daysLeft < 0) {
    alerts.push({ type: 'danger', msg: `${t.name} — ${t.contract || 'contract'} ended ${-daysLeft} days ago`, detail: 'Already expired — decide: confirm, extend, or end' });
  } else if (daysLeft <= 21) {
    alerts.push({ type: daysLeft <= 7 ? 'danger' : 'warning', msg: `${t.name} — ${t.contract || 'contract'} ends in ${daysLeft} days`, detail: 'Decide: confirm, extend, or end' });
  }
});

const contractDeadlines = team.filter(t => t.contractEnd).sort((a, b) => a.contractEnd.localeCompare(b.contractEnd)).map(t => ({
  ...t, daysLeft: Math.ceil((new Date(t.contractEnd) - today) / 86400000)
}));

// The "Last Month / This Month" TimePeriodSelector and its periodRange helper
// were removed 8 Jul 2026 (Adama): the computed range was discarded — the
// dropdown controlled nothing and mislabelled pages like Run Payroll (July
// shown under a "Last Month" chip). Payroll's month comes from the server.

const perfColor = p => p >= 80 ? 'text-emerald-600' : p >= 50 ? 'text-amber-600' : p > 0 ? 'text-red-600' : 'text-gray-400';
const perfBg = p => p >= 80 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : p > 0 ? 'bg-red-500' : 'bg-gray-300';
const perfLabel = p => p >= 80 ? 'On Track' : p >= 50 ? 'Needs Attention' : p > 0 ? 'Underperforming' : 'New';
const statusBadge = s => ({ active: 'bg-emerald-100 text-emerald-700', maternity: 'bg-purple-100 text-purple-700', probation: 'bg-amber-100 text-amber-700', training: 'bg-orange-100 text-orange-700' })[s] || 'bg-gray-100 text-gray-700';
const typeBadge = t => ({ Sales: 'bg-green-100 text-green-700', Operations: 'bg-gray-100 text-gray-700', Marketing: 'bg-pink-100 text-pink-700', Technology: 'bg-blue-100 text-blue-700', Training: 'bg-amber-100 text-amber-700' })[t] || 'bg-gray-100 text-gray-700';
const actionBadge = a => ({ review: 'bg-blue-100 text-blue-700', warning: 'bg-red-100 text-red-700', training: 'bg-orange-100 text-orange-700', promotion: 'bg-green-100 text-green-700', 'let-go': 'bg-red-200 text-red-800', monitor: 'bg-gray-100 text-gray-600', none: 'bg-gray-50 text-gray-400' })[a] || 'bg-gray-100 text-gray-600';

// Derive a leave/exit category from a past-staff reason (categorising existing
// text — no data invented). Drives the Past Staff filter chips.
function pastCategory(reason) {
  const r = (reason || '').toLowerCase();
  if (/terminat|let go|dismiss|fired/.test(r)) return 'Terminated';
  if (/contract end/.test(r)) return 'Contract Ended';
  if (/training|intern|trainee|not confirmed|not converted|probation/.test(r)) return 'Training/Internship';
  if (/left|resign|voluntar/.test(r)) return 'Resigned';
  return 'Other';
}
const PAST_CAT_COLOR = {
  Terminated: 'bg-red-100 text-red-700',
  'Contract Ended': 'bg-blue-100 text-blue-700',
  'Training/Internship': 'bg-orange-100 text-orange-700',
  Resigned: 'bg-gray-100 text-gray-700',
  Other: 'bg-gray-100 text-gray-600',
};

export default function HRTeam({
  only = null,
  title = 'HR & Team',
  subtitle = 'Who is performing, who is costing money, and what to do next',
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Per-person payroll history is owner/CEO-only. Managers with the payroll
  // power still see the month + total, but not who was paid what.
  const canSeePayDetail = user?.username === 'adama';
  // "Momodou's day" card — every team lead's auto-built Top 3 with live ticks,
  // so Adama sees the plan AND the execution without asking (9 Jul).
  const [weekOverview, setWeekOverview] = useState(null);
  useEffect(() => {
    if (!only || !only.includes('dashboard')) return;
    api('/myweek/overview').then((d) => setWeekOverview(d.leads || [])).catch(() => setWeekOverview([]));
  }, []);
  const [openPayMonth, setOpenPayMonth] = useState(null);
  // History is grouped by year; the current year is open, older years collapse
  // so the page doesn't become an endless scroll of months.
  const [openYears, setOpenYears] = useState(() => [String(new Date().getFullYear())]);
  const toggleYear = (y) => setOpenYears(s => s.includes(y) ? s.filter(x => x !== y) : [...s, y]);
  // Payroll is split into its own sub-pages (Run / History / Team Salaries).
  // Section + month survive a reload (Adama 9 Jul: "it should leave me always
  // where i was") — kept per-tab in sessionStorage.
  const [paySection, setPaySectionRaw] = useState(() => sessionStorage.getItem('payroll.section') || 'run');
  const setPaySection = (s) => { sessionStorage.setItem('payroll.section', s); setPaySectionRaw(s); };
  const [payHistYear, setPayHistYear] = useState('all');
  const [payHistSearch, setPayHistSearch] = useState('');
  // Run Payroll is owner-only; non-owners get History + Team Salaries only.
  const payTabs = canSeePayDetail
    ? [['run', 'Run Payroll'], ['history', 'History'], ['team', 'Team Salaries']]
    : [['history', 'History'], ['team', 'Team Salaries']];
  const paySec = payTabs.some(([k]) => k === paySection) ? paySection : payTabs[0][0];
  // Live payroll history from Zoho Books (owner-only). Falls back to the static
  // team.js list if the pull fails or the user isn't the owner.
  const [payLive, setPayLive] = useState(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState(null);
  // History data source + available years (used by the History sub-page filter).
  const histMonths = canSeePayDetail && payLive ? payLive : payrollHistory;
  const histYearOf = (m) => (m.ym ? m.ym.slice(0, 4) : (String(m.month).match(/\d{4}/)?.[0] || '—'));
  const histYears = [...new Set((histMonths || []).map(histYearOf))].sort((a, b) => b.localeCompare(a));
  // Run-payroll (write to Books) state.
  const [payRun, setPayRun] = useState(null);            // { period, people[], paySources[] }
  const [payDraft, setPayDraft] = useState({});          // name -> { salary, bonus, source }
  const [payConfirm, setPayConfirm] = useState(null);    // { person, preview, ... } modal
  const [payPosting, setPayPosting] = useState(false);
  const [payEdit, setPayEdit] = useState(null);          // { rec, salary, bonus, source, date } edit modal
  const [payUndo, setPayUndo] = useState(null);          // { rec } undo-confirm modal
  const todayISO = new Date().toISOString().slice(0, 10);
  // Which month the payroll run applies to — defaults to this month, but any
  // month can be picked (Adama 8 Jul: enter June's payroll late, or fix an
  // error in a past month). The server takes ?period= and pays into it.
  const [payPeriod, setPayPeriod] = useState(() => {
    const saved = sessionStorage.getItem('payroll.period');
    return /^\d{4}-\d{2}$/.test(saved || '') ? saved : new Date().toISOString().slice(0, 7);
  });
  // Salaries are paid end of month (Adama): the payment date defaults to the
  // period's last day — capped at today so it never lands in the future — and
  // stays editable. Every Mark paid in the run uses this one date.
  const eomOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const defaultPayDate = (ym) => { const eom = eomOf(ym); return eom < todayISO ? eom : todayISO; };
  const [payDate, setPayDate] = useState(() => defaultPayDate(payPeriod));

  function loadPayRun(period = payPeriod) {
    api(`/payroll/run?period=${period}`)
      .then(d => {
        setPayRun(d);
        // MERGE with what the owner already typed — marking one person paid
        // must not reset everyone else's numbers back to the defaults.
        setPayDraft(prev => {
          const draft = {};
          (d.people || []).forEach(p => { draft[p.name] = prev[p.name] || { salary: p.suggestedSalary, bonus: p.suggestedBonus, source: (d.paySources?.[0]?.key) || 'wave' }; });
          return draft;
        });
      })
      .catch(() => setPayRun({ error: true }));
  }
  function changePayPeriod(period) {
    if (!/^\d{4}-\d{2}$/.test(period)) return;
    sessionStorage.setItem('payroll.period', period);
    setPayPeriod(period);
    setPayDate(defaultPayDate(period));
    setPayRun(null); // show fresh state while the month loads
    setPayDraft({}); // a new month starts from that month's defaults
    loadPayRun(period);
  }
  const openProfile = (name) => navigate(`/agents/${name.toLowerCase().replace(/\s+/g, '-')}`);
  const urlTab = new URLSearchParams(location.search).get('tab');
  const initialTab = only ? (only.includes(urlTab) ? urlTab : only[0]) : (urlTab || 'dashboard');
  const [tab, setTab] = useState(initialTab);
  // When mounted as a focused control-centre page (only=[…]), the big metric
  // cards + attention alerts only belong on the Dashboard view, not on every page.
  const showOverview = !only || only.includes('dashboard');
  // expandedRow state removed 12 Jun 2026 — the roster detail panel it gated
  // was dead code (no setter); rows now open the full profile via openProfile.
  const [allWarnings, setAllWarnings] = useState([]);
  const [pendingLeave, setPendingLeave] = useState(null);
  const [pastFilter, setPastFilter] = useState('all');
  // Restore lives here now (Past agents removed from the Staff page). Map a
  // former employee's name -> username when they're a restorable archived account.
  const [restorableMap, setRestorableMap] = useState({});
  useEffect(() => {
    api('/past-agents').then((d) => {
      const m = {};
      (d.pastAgents || []).forEach((p) => { if (p.restorable && p.username) m[p.name.toLowerCase().replace(/\s+/g, '')] = p.username; });
      setRestorableMap(m);
    }).catch(() => {});
  }, []);
  async function restorePast(username) {
    try {
      await api(`/staff/${username}/restore`, { method: 'POST' });
      setRestorableMap((m) => { const n = { ...m }; for (const k of Object.keys(n)) if (n[k] === username) delete n[k]; return n; });
    } catch { /* no-op */ }
  }

  useEffect(() => {
    api('/warnings').then(d => setAllWarnings(d.warnings || [])).catch(() => setAllWarnings([]));
  }, [tab]);

  // Pending leave count for the Records dashboard (owner/approvers only).
  useEffect(() => {
    if (tab !== 'warnings') return;
    api('/leave?status=pending').then(d => setPendingLeave((d.requests || []).length)).catch(() => setPendingLeave(null));
  }, [tab]);

  // Pull live payroll history once the owner opens the Payroll tab.
  useEffect(() => {
    if (tab !== 'payroll' || !canSeePayDetail || payLive || payLoading) return;
    setPayLoading(true);
    setPayError(null);
    api('/payroll/history')
      .then(d => setPayLive(d.months || []))
      .catch(e => setPayError(e.message || 'Could not load from Zoho Books'))
      .finally(() => setPayLoading(false));
    if (!payRun) loadPayRun();
  }, [tab, canSeePayDetail]);

  // Open the confirm modal for a person: dry-run first so the owner sees the
  // exact vendor + Books payload before anything posts.
  async function startPay(person) {
    const d = payDraft[person.name] || {};
    setPayConfirm({ person, loading: true, salary: d.salary, bonus: d.bonus, source: d.source, date: payDate, label: (d.note || '').trim() });
    try {
      const preview = await api(`/payroll/pay?dryRun=1`, { method: 'POST', body: { name: person.name, salary: Number(d.salary) || 0, bonus: Number(d.bonus) || 0, paySourceKey: d.source, date: payDate, period: payRun.period } });
      // A duplicate found at preview time gets the same choices as one found on
      // confirm: adopt & edit the existing expense, or knowingly pay again.
      const dup = preview?.ok === false && preview?.reason === 'duplicate' ? { duplicate: preview.duplicate, message: preview.message } : {};
      setPayConfirm(c => c && { ...c, loading: false, preview, ...dup });
    } catch (e) {
      setPayConfirm(c => c && { ...c, loading: false, error: e.message });
    }
  }

  // Real post. force=true overrides the duplicate guard.
  async function confirmPay(force = false) {
    if (!payConfirm) return;
    const { person, salary, bonus, source, date, label } = payConfirm;
    setPayPosting(true);
    try {
      const res = await api('/payroll/pay', { method: 'POST', body: { name: person.name, salary: Number(salary) || 0, bonus: Number(bonus) || 0, paySourceKey: source, date, period: payRun.period, label: label || '', force } });
      if (res.ok === false && res.reason === 'duplicate') {
        setPayConfirm(c => c && { ...c, duplicate: res.duplicate, message: res.message });
      } else {
        setPayConfirm(null);
        loadPayRun();          // refresh paid status
        setPayLive(null);      // history will re-pull
      }
    } catch (e) {
      setPayConfirm(c => c && { ...c, error: e.message });
    } finally {
      setPayPosting(false);
    }
  }

  // ONE-OFF payment — Zoho "Record Expense" style (Adama 9 Jul): everything up
  // front in one form (person, what it is, amount, month, date, method), one
  // Save. For training pay, allowances, advances — anything that isn't the
  // standard monthly salary.
  const [oneOff, setOneOff] = useState(null); // { name, label, amount, period, date, source, busy, error }
  function openOneOff() {
    setOneOff({
      name: payRun?.people?.[0]?.name || '',
      label: '', amount: '',
      period: payPeriod, date: payDate,
      source: payRun?.paySources?.[0]?.key || 'wave',
      busy: false, error: '',
    });
  }
  async function submitOneOff() {
    const o = oneOff;
    if (!o.name) return setOneOff(c => ({ ...c, error: 'Pick a person' }));
    if (!o.label.trim()) return setOneOff(c => ({ ...c, error: 'Say what this payment is (e.g. Training pay)' }));
    if (!(Number(o.amount) > 0)) return setOneOff(c => ({ ...c, error: 'Enter an amount' }));
    setOneOff(c => ({ ...c, busy: true, error: '' }));
    try {
      const res = await api('/payroll/pay', { method: 'POST', body: { name: o.name, salary: Number(o.amount), bonus: 0, paySourceKey: o.source, date: o.date, period: o.period, label: o.label.trim() } });
      if (res.ok === false && res.reason === 'duplicate') {
        setOneOff(c => ({ ...c, busy: false, error: `${o.name} already has a payment for ${o.period} (${res.message}). One payment per person per month — edit that payment in the run instead, or pick a different month.` }));
        return;
      }
      if (res.ok === false) { setOneOff(c => ({ ...c, busy: false, error: res.message || 'Could not record' })); return; }
      setOneOff(null);
      if (o.period === payRun?.period) loadPayRun();
      setPayLive(null);
    } catch (e) {
      setOneOff(c => ({ ...c, busy: false, error: e.message }));
    }
  }

  // PAY ALL — the recurring run in one go: every unpaid row, the numbers as
  // typed, one confirmation. People whose month is already paid in Books are
  // skipped and reported, never double-paid.
  const [bulk, setBulk] = useState(null); // { people, busy, done, results }
  function openBulk() {
    const unpaid = (payRun?.people || []).filter(p => !p.paid);
    if (!unpaid.length) return;
    setBulk({ people: unpaid, busy: false, done: false, results: null });
  }
  async function runBulk() {
    setBulk(c => ({ ...c, busy: true }));
    const results = [];
    for (const p of bulk.people) {
      const d = payDraft[p.name] || {};
      try {
        const res = await api('/payroll/pay', { method: 'POST', body: { name: p.name, salary: Number(d.salary) || 0, bonus: Number(d.bonus) || 0, paySourceKey: d.source, date: payDate, period: payRun.period, label: (d.note || '').trim() } });
        if (res.ok === false) results.push({ name: p.name, status: res.reason === 'duplicate' ? 'skipped — already paid in Books' : (res.message || 'failed') });
        else results.push({ name: p.name, status: `paid D${(res.record?.total ?? ((Number(d.salary) || 0) + (Number(d.bonus) || 0))).toLocaleString()}` });
      } catch (e) {
        results.push({ name: p.name, status: e.message || 'failed' });
      }
    }
    setBulk(c => ({ ...c, busy: false, done: true, results }));
    loadPayRun();
    setPayLive(null);
  }

  // Adopt an expense that already exists in Books (pre-entered in Zoho) as this
  // month's record, then open it in the edit modal to fix amounts or backdate.
  async function adoptExisting() {
    if (!payConfirm) return;
    const { person } = payConfirm;
    setPayPosting(true);
    try {
      const res = await api('/payroll/adopt', { method: 'POST', body: { name: person.name, period: payRun.period } });
      setPayConfirm(null);
      loadPayRun(); setPayLive(null);
      const rec = res.record;
      setPayEdit({ rec, salary: rec.salary, bonus: rec.bonus, source: rec.paySourceKey || (payRun.paySources?.[0]?.key) || 'wave', date: rec.date });
    } catch (e) {
      setPayConfirm(c => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  // Save an edit to a recorded payment (updates the Zoho expense).
  async function saveEdit() {
    if (!payEdit) return;
    setPayPosting(true);
    try {
      await api(`/payroll/pay/${payEdit.rec.id}`, { method: 'PUT', body: { salary: Number(payEdit.salary) || 0, bonus: Number(payEdit.bonus) || 0, paySourceKey: payEdit.source, date: payEdit.date, label: payEdit.label || '' } });
      setPayEdit(null); loadPayRun(); setPayLive(null);
    } catch (e) {
      setPayEdit(c => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  // Undo a recorded payment (deletes the Zoho expense).
  async function confirmUndo() {
    if (!payUndo) return;
    setPayPosting(true);
    try {
      await api(`/payroll/pay/${payUndo.rec.id}`, { method: 'DELETE' });
      setPayUndo(null); loadPayRun(); setPayLive(null);
    } catch (e) {
      setPayUndo(c => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  const warningsByAgent = useMemo(() => {
    const map = {};
    allWarnings.forEach(w => {
      if (!map[w.agent]) map[w.agent] = [];
      map[w.agent].push(w);
    });
    return map;
  }, [allWarnings]);

  // 12 Jun 2026 (Adama's request): the `liveMetrics` map (per-person sales +
  // revenue from team.js) was removed here — its only consumers were the
  // sales-derived Revenue/Avg-Performance cards and the Cost-vs-Value panel,
  // all dropped when Pulse was narrowed to HR-only.

  useEffect(() => {
    if (only) return; // focused pages set their own tab; don't fight the URL
    const qp = new URLSearchParams(location.search).get('tab');
    if (qp && qp !== tab) setTab(qp);
  }, [location.search]);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'performance', label: 'Performance' },
    { id: 'kpi', label: 'KPI Settings' },
    { id: 'roster', label: 'Team Roster' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'past', label: 'Past Staff' },
    { id: 'warnings', label: `Records${allWarnings.length > 0 ? ` (${allWarnings.length})` : ''}` },
  ].filter((t) => !only || only.includes(t.id));

  // KPI Settings state
  const [kpiRules, setKpiRules] = useState([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiFilter, setKpiFilter] = useState({ scope: 'all', period: 'all', role: 'all', agent: 'all' });
  const blankRule = { id: null, scope: 'role', role: '', agent: '', period: 'default', unit: '', personalTarget: '', teamTarget: '', weeklyTarget: '', kpi: '', coreResponsibility: '', focus: '', active: true };
  const [kpiForm, setKpiForm] = useState(blankRule);
  const [kpiEditing, setKpiEditing] = useState(false);
  const [kpiSaving, setKpiSaving] = useState(false);

  useEffect(() => {
    if (tab !== 'kpi') return;
    setKpiLoading(true);
    api('/kpi-rules').then(d => setKpiRules(d.rules || [])).catch(() => setKpiRules([])).finally(() => setKpiLoading(false));
  }, [tab]);

  const allRoles = [...new Set(team.map(t => t.role))].sort();
  const allAgents = team.filter(t => t.status !== 'maternity').map(t => t.name);

  async function saveKpiRule() {
    setKpiSaving(true);
    try {
      const payload = {
        id: kpiForm.id || undefined,
        scope: kpiForm.scope,
        role: kpiForm.scope === 'role' ? kpiForm.role : null,
        agent: kpiForm.scope === 'agent' ? kpiForm.agent : null,
        period: kpiForm.period || 'default',
        personalTarget: kpiForm.personalTarget === '' ? null : Number(kpiForm.personalTarget),
        teamTarget: kpiForm.teamTarget === '' ? null : Number(kpiForm.teamTarget),
        weeklyTarget: kpiForm.weeklyTarget,
        kpi: kpiForm.kpi,
        coreResponsibility: kpiForm.coreResponsibility,
        focus: kpiForm.focus,
        active: kpiForm.active,
      };
      const res = await api('/kpi-rules', { method: 'POST', body: payload });
      if (res.rule) {
        const d = await api('/kpi-rules').catch(() => ({ rules: [] }));
        setKpiRules(d.rules || []);
        setKpiForm(blankRule);
        setKpiEditing(false);
      }
    } catch (e) { /* surfaced via empty state */ }
    setKpiSaving(false);
  }
  async function deleteKpiRule(id) {
    if (!confirm('Delete this KPI rule?')) return;
    try {
      await api(`/kpi-rules/${id}`, { method: 'DELETE' });
      setKpiRules(prev => prev.filter(r => r.id !== id));
    } catch (e) { /* no-op */ }
  }

  const filteredRules = kpiRules.filter(r => {
    if (kpiFilter.scope !== 'all' && r.scope !== kpiFilter.scope) return false;
    if (kpiFilter.period !== 'all' && r.period !== kpiFilter.period) return false;
    if (kpiFilter.role !== 'all' && r.role !== kpiFilter.role) return false;
    if (kpiFilter.agent !== 'all' && r.agent !== kpiFilter.agent) return false;
    return true;
  });
  const allPeriods = [...new Set(kpiRules.map(r => r.period))].sort();

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">{title}</h1>
          <p className="text-gray-500 mt-1">{subtitle}</p>
        </div>
      </div>

      {showOverview && weekOverview && weekOverview.length > 0 && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {weekOverview.map((w) => (
            <div key={w.lead.username} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-900">{w.lead.name}'s priorities today</p>
                <span className="text-[11px] font-semibold text-gray-400">{w.priorities.length === 0 ? 'all on track' : `${w.priorities.length} open`}</span>
              </div>
              <div className="space-y-1.5">
                {w.priorities.length === 0 && <p className="text-sm text-gray-400">Nothing is on fire.</p>}
                {w.priorities.map((p) => (
                  <div key={p.key} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5">{p.tier === 'high' ? '🔥' : p.tier === 'medium' ? '🟠' : '🟡'}</span>
                    <span className="flex-1 text-gray-700">{p.n}. {p.title} <span className="font-bold tabular-nums">{p.metric}</span></span>
                  </div>
                ))}
              </div>
              {w.health && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
                  {w.health.map((h) => <span key={h.area}>{h.status === 'green' ? '🟢' : h.status === 'amber' ? '🟡' : h.status === 'red' ? '🔴' : '⚪'} {h.area}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showOverview && alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide flex items-center gap-2"><AlertTriangle size={14} className="text-red-500" /> Attention Required</p>
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${a.type === 'danger' ? 'bg-red-50 border-red-200' : a.type === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
              <AlertTriangle size={14} className={a.type === 'danger' ? 'text-red-500' : a.type === 'warning' ? 'text-amber-500' : 'text-blue-500'} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${a.type === 'danger' ? 'text-red-800' : a.type === 'warning' ? 'text-amber-800' : 'text-blue-800'}`}>{a.msg}</p>
                {a.detail && <p className="text-xs text-gray-600">{a.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showOverview && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-blue-50"><Users size={16} className="text-blue-600" /></div><p className="text-gray-500 text-xs">Headcount</p></div>
          <h3 className="text-2xl font-bold text-gray-900">{team.length}</h3>
          <p className="text-[10px] text-gray-500 mt-1">{activeTeam.length} active, {probationTeam.length} probation, {trainingTeam.length} training</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-purple-50"><DollarSign size={16} className="text-purple-600" /></div><p className="text-gray-500 text-xs">Payroll</p></div>
          <h3 className="text-2xl font-bold text-gray-900">D{totalBase.toLocaleString()}</h3>
          <p className="text-[10px] text-gray-500 mt-1">Base only</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-amber-50"><Target size={16} className="text-amber-600" /></div><p className="text-gray-500 text-xs">In Evaluation</p></div>
          <h3 className="text-2xl font-bold text-amber-600">{probationTeam.length + trainingTeam.length}</h3>
          <p className="text-[10px] text-gray-500 mt-1">{probationTeam.length} probation, {trainingTeam.length} training</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-red-50"><Shield size={16} className="text-red-600" /></div><p className="text-gray-500 text-xs">Expiring</p></div>
          <h3 className="text-2xl font-bold text-red-600">{contractDeadlines.filter(c => c.daysLeft <= 90).length}</h3>
          <p className="text-[10px] text-gray-500 mt-1">Within 90 days</p>
        </div>
      </div>
      )}

      {tabs.length > 1 && (
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{t.label}</button>
        ))}
      </div>
      )}

      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* 12 Jun 2026 (Adama's request): the "Cost vs Value" panel (per-head
              revenue − salary profit, sales/finance data) was replaced with the
              HR-native "Headcount by department" breakdown below, as part of
              narrowing Pulse to HR-only and removing sales-dependent metrics. */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Headcount by department</h3>
            <p className="text-sm text-gray-500 mb-4">How the team is distributed today</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {(() => {
                const byType = {};
                team.forEach(t => { byType[t.type] = (byType[t.type] || 0) + 1; });
                return Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count], i) => (
                  <div key={i} className="p-4 rounded-lg border border-gray-200 text-center">
                    <p className="text-2xl font-bold text-gray-900">{count}</p>
                    <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${typeBadge(type)}`}>{type}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Probation &amp; Training</h3>
            <p className="text-sm text-gray-500 mb-4">Countdown to decision day</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {contractDeadlines.filter(c => c.status === 'probation' || c.status === 'training').map((c, i) => (
                <div key={i} onClick={() => openProfile(c.name)} className="p-4 border border-gray-200 rounded-lg cursor-pointer hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <div><p className="font-medium text-gray-900 text-sm">{c.name}</p><p className="text-xs text-gray-500">{c.role} — {c.contract}</p></div>
                    <div className={`text-center px-3 py-1 rounded-lg ${c.daysLeft <= 7 ? 'bg-red-100 text-red-700' : c.daysLeft <= 21 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                      <p className="text-lg font-bold">{c.daysLeft}</p><p className="text-[10px]">days left</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden"><div className={`h-full rounded-full ${perfBg(c.performance)}`} style={{ width: `${c.performance}%` }} /></div>
                    <span className={`text-xs font-bold ${perfColor(c.performance)}`}>{c.performance}%</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{c.nextActionNote}</p>
                  <div className="flex gap-2 mt-3">
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded">Pass</span>
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded">Extend</span>
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-medium rounded">Terminate</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'performance' && (
        <div>
          <div className="flex items-baseline justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Performance</h3>
              <p className="text-sm text-gray-500 mt-1">Who is delivering and who is not</p>
            </div>
            <p className="text-xs text-gray-400">{team.filter(t => t.status !== 'maternity').length} people</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {team.filter(t => t.status !== 'maternity').map((t, i) => {
              const initials = t.name.split(' ').map(w => w[0]).slice(0, 2).join('');
              return (
                <div key={i} onClick={() => openProfile(t.name)} className="bg-white rounded-3xl border border-gray-100 p-6 cursor-pointer hover:border-gray-300 hover:shadow-md transition-all">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{t.role}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${statusBadge(t.status)}`}>{t.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeBadge(t.type)}`}>{t.type}</span>
                        {(warningsByAgent[t.name]?.length || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 flex items-center gap-1"><AlertTriangle size={10} /> {warningsByAgent[t.name].length}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-baseline justify-between mb-2">
                      <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Performance</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-xl font-bold ${perfColor(t.performance)}`}>{t.performance}%</span>
                        <span className="text-[11px] text-gray-400">{perfLabel(t.performance)}</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${perfBg(t.performance)}`} style={{ width: `${Math.max(t.performance, 2)}%` }} />
                    </div>
                  </div>

                  {t.kpi && (
                    <div className="mt-4">
                      <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">KPI</p>
                      <p className="text-xs text-gray-700 line-clamp-2">{t.kpi}</p>
                    </div>
                  )}

                  {/* 12 Jun 2026 (Adama's request): per-person Revenue / Net (ROI)
                      block removed here — sales/finance data, dropped as part of
                      narrowing Pulse to HR-only. */}

                  {t.nextAction && t.nextAction !== 'none' && (
                    <div className="mt-4 flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${actionBadge(t.nextAction)}`}>{t.nextAction}</span>
                      {t.nextActionNote && <span className="text-[11px] text-gray-500 truncate">{t.nextActionNote}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'kpi' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Settings size={18} className="text-gray-400" />
                  <h3 className="text-lg font-semibold text-gray-900">KPI Settings</h3>
                </div>
                <p className="text-sm text-gray-500 max-w-2xl">
                  Single source of truth for what each person or role is expected to deliver.
                  Resolution priority: <span className="font-medium text-gray-700">agent + specific month → agent default → role + specific month → role default</span>.
                </p>
              </div>
              <button
                onClick={() => { setKpiForm(blankRule); setKpiEditing(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-full"
              >
                <Plus size={14} /> Add KPI rule
              </button>
            </div>
          </div>

          {kpiEditing && (
            <div className="bg-white rounded-3xl border-2 border-gray-900 p-6">
              <div className="flex items-center justify-between mb-5">
                <h4 className="font-semibold text-gray-900">{kpiForm.id ? 'Edit KPI rule' : 'New KPI rule'}</h4>
                <button onClick={() => { setKpiEditing(false); setKpiForm(blankRule); }} className="text-gray-400 hover:text-gray-900">
                  <span className="text-xs">Cancel</span>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-2 block">Applies to</label>
                  <div className="flex gap-2">
                    <button onClick={() => setKpiForm({ ...kpiForm, scope: 'role', agent: '' })}
                      className={`px-4 py-2 rounded-full text-sm font-medium ${kpiForm.scope === 'role' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'}`}>
                      A role (e.g. Sales Agent)
                    </button>
                    <button onClick={() => setKpiForm({ ...kpiForm, scope: 'agent', role: '' })}
                      className={`px-4 py-2 rounded-full text-sm font-medium ${kpiForm.scope === 'agent' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'}`}>
                      A specific person
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {kpiForm.scope === 'role' && (
                    <div>
                      <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Role</label>
                      <select value={kpiForm.role} onChange={e => setKpiForm({ ...kpiForm, role: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400">
                        <option value="">Select role…</option>
                        {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                  {kpiForm.scope === 'agent' && (
                    <div>
                      <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Agent</label>
                      <select value={kpiForm.agent} onChange={e => setKpiForm({ ...kpiForm, agent: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400">
                        <option value="">Select person…</option>
                        {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">
                      Period <span className="text-gray-400 normal-case font-normal tracking-normal">(YYYY-MM or "default")</span>
                    </label>
                    <input type="text" value={kpiForm.period} onChange={e => setKpiForm({ ...kpiForm, period: e.target.value })}
                      placeholder="default · or 2026-04"
                      list="periods-list"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                    <datalist id="periods-list">
                      <option value="default" />
                      <option value={`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`} />
                      <option value={`${today.getFullYear()}-${String(today.getMonth()+2).padStart(2,'0')}`} />
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Unit — what you're counting</label>
                  <input type="text" value={kpiForm.unit} onChange={e => setKpiForm({ ...kpiForm, unit: e.target.value })}
                    placeholder="e.g. sales, installs, tickets, posts, renewals"
                    list="kpi-units"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  <datalist id="kpi-units">
                    <option value="sales" /><option value="installs" /><option value="tickets" />
                    <option value="renewals" /><option value="posts" /><option value="calls" /><option value="visits" />
                  </datalist>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Personal target / month</label>
                    <input type="number" value={kpiForm.personalTarget} onChange={e => setKpiForm({ ...kpiForm, personalTarget: e.target.value })}
                      placeholder={kpiForm.unit ? `5 ${kpiForm.unit}` : '5'}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Team target / month</label>
                    <input type="number" value={kpiForm.teamTarget} onChange={e => setKpiForm({ ...kpiForm, teamTarget: e.target.value })}
                      placeholder="optional"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Weekly target (text)</label>
                    <input type="text" value={kpiForm.weeklyTarget} onChange={e => setKpiForm({ ...kpiForm, weeklyTarget: e.target.value })}
                      placeholder={kpiForm.unit ? `4 ${kpiForm.unit}/week` : 'e.g. 4 per week'}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                </div>

                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Monthly KPI (human-readable)</label>
                  <input type="text" value={kpiForm.kpi} onChange={e => setKpiForm({ ...kpiForm, kpi: e.target.value })}
                    placeholder="e.g. Complete 8 installs this month"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Core responsibility</label>
                  <input type="text" value={kpiForm.coreResponsibility} onChange={e => setKpiForm({ ...kpiForm, coreResponsibility: e.target.value })}
                    placeholder="e.g. Own renewals and keep customers retained"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Focus (optional theme)</label>
                  <input type="text" value={kpiForm.focus} onChange={e => setKpiForm({ ...kpiForm, focus: e.target.value })}
                    placeholder="e.g. Close high-value renewals"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="rule-active" checked={kpiForm.active} onChange={e => setKpiForm({ ...kpiForm, active: e.target.checked })} />
                  <label htmlFor="rule-active" className="text-sm text-gray-700">Active — apply this rule in performance resolution</label>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                  <button onClick={() => { setKpiEditing(false); setKpiForm(blankRule); }}
                    className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
                  <button disabled={kpiSaving || (kpiForm.scope === 'role' ? !kpiForm.role : !kpiForm.agent)}
                    onClick={saveKpiRule}
                    className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-full disabled:bg-gray-300">
                    {kpiSaving ? 'Saving…' : kpiForm.id ? 'Update rule' : 'Save rule'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-gray-100 p-5 flex flex-wrap items-center gap-3">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">Filter</p>
            <select value={kpiFilter.scope} onChange={e => setKpiFilter({ ...kpiFilter, scope: e.target.value })}
              className="px-3 py-1.5 border border-gray-200 rounded-full text-xs">
              <option value="all">All scopes</option>
              <option value="role">Role only</option>
              <option value="agent">Agent only</option>
            </select>
            <select value={kpiFilter.period} onChange={e => setKpiFilter({ ...kpiFilter, period: e.target.value })}
              className="px-3 py-1.5 border border-gray-200 rounded-full text-xs">
              <option value="all">All periods</option>
              {allPeriods.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={kpiFilter.role} onChange={e => setKpiFilter({ ...kpiFilter, role: e.target.value })}
              className="px-3 py-1.5 border border-gray-200 rounded-full text-xs">
              <option value="all">All roles</option>
              {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={kpiFilter.agent} onChange={e => setKpiFilter({ ...kpiFilter, agent: e.target.value })}
              className="px-3 py-1.5 border border-gray-200 rounded-full text-xs">
              <option value="all">All agents</option>
              {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-[11px] text-gray-400 ml-auto">{filteredRules.length} of {kpiRules.length} rules</span>
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden">
            {kpiLoading ? (
              <p className="p-6 text-sm text-gray-400">Loading…</p>
            ) : filteredRules.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm text-gray-500">{kpiRules.length === 0 ? 'No KPI rules yet. Click "Add KPI rule" above to set your first one.' : 'No rules match this filter.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Scope</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Target</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Period</th>
                      <th className="text-center py-3 px-4 text-gray-500 font-medium text-xs">Personal</th>
                      <th className="text-center py-3 px-4 text-gray-500 font-medium text-xs">Team</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">Weekly</th>
                      <th className="text-left py-3 px-4 text-gray-500 font-medium text-xs">KPI</th>
                      <th className="text-center py-3 px-4 text-gray-500 font-medium text-xs">Active</th>
                      <th className="text-right py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRules.map(r => {
                      const rPeriodLabel = /^\d{4}-\d{2}$/.test(r.period) ? new Date(r.period + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : r.period;
                      return (
                        <tr key={r.id} className={`border-b border-gray-100 ${!r.active ? 'opacity-50' : ''}`}>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${r.scope === 'role' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{r.scope}</span>
                          </td>
                          <td className="py-3 px-4 font-medium text-gray-900">{r.agent || r.role}</td>
                          <td className="py-3 px-4 text-gray-600">{rPeriodLabel}</td>
                          <td className="py-3 px-4 text-center text-gray-900">{r.personalTarget != null ? `${r.personalTarget}${r.unit ? ` ${r.unit}` : ''}` : '—'}</td>
                          <td className="py-3 px-4 text-center text-gray-900">{r.teamTarget != null ? `${r.teamTarget}${r.unit ? ` ${r.unit}` : ''}` : '—'}</td>
                          <td className="py-3 px-4 text-gray-600 max-w-[140px] truncate">{r.weeklyTarget || '—'}</td>
                          <td className="py-3 px-4 text-gray-700 max-w-[260px] truncate">{r.kpi || '—'}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`w-2 h-2 rounded-full inline-block ${r.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setKpiForm({ ...blankRule, ...r, personalTarget: r.personalTarget ?? '', teamTarget: r.teamTarget ?? '' }); setKpiEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className="p-2 text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => deleteKpiRule(r.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'roster' && (
        <div className="space-y-3">
          {team.map((p, i) => {
            const warns = (warningsByAgent[p.name] || []).length;
            const ends = p.contractEnd ? new Date(p.contractEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
            const daysLeft = p.contractEnd ? Math.ceil((new Date(p.contractEnd) - today) / 86400000) : null;
            return (
              <div key={i} onClick={() => openProfile(p.name)} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-sm font-semibold shrink-0">{p.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-900">{p.name}</p>
                      <p className="text-sm text-gray-500">{p.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${statusBadge(p.status)}`}>{p.status}</span>
                    <span className="text-sm text-gray-400 flex items-center gap-1">View profile <ChevronDown size={15} className="-rotate-90" /></span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4 border-t border-gray-100">
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Joined</p><p className="text-sm text-gray-900 mt-0.5">{p.joined || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Department</p><p className="text-sm text-gray-900 mt-0.5">{p.type || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Salary</p><p className="text-sm text-gray-900 mt-0.5">D{(p.base || 0).toLocaleString()}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Commission</p><p className="text-sm text-gray-900 mt-0.5">{p.commission > 0 ? `Up to D${p.commission.toLocaleString()}` : '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Contract ends</p><p className={`text-sm mt-0.5 ${daysLeft !== null && daysLeft <= 30 ? 'text-red-600' : daysLeft !== null && daysLeft <= 90 ? 'text-amber-600' : 'text-gray-900'}`}>{ends}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Warnings</p><p className={`text-sm mt-0.5 ${warns > 0 ? 'text-red-600 font-medium' : 'text-gray-900'}`}>{warns}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'payroll' && (
        <div className="space-y-6">
          <div className="flex items-center gap-1 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 w-fit">
            {payTabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPaySection(k)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${paySec === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
            ))}
          </div>
          {paySec === 'run' && canSeePayDetail && payRun && !payRun.error && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-lg font-semibold text-gray-900">Run Payroll — {payRun.period && new Date(Number(payRun.period.slice(0, 4)), Number(payRun.period.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                  <input
                    type="month"
                    value={payPeriod}
                    onChange={(e) => changePayPeriod(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
                    title="Pick which month this payroll applies to — go back to enter or correct a past month"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    Paid on
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => e.target.value && setPayDate(e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700"
                      title="The payment date recorded in Zoho Books for every Mark paid in this run — defaults to the month's end"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={openOneOff} className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:border-gray-500">+ Record a payment</button>
                  {(payRun.people || []).some(p => !p.paid) && (
                    <button type="button" onClick={openBulk} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800">Pay all ({(payRun.people || []).filter(p => !p.paid).length})</button>
                  )}
                  <span className="text-[11px] text-gray-400 flex items-center gap-1"><DollarSign size={11} /> Records to Zoho Books</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-4">Enter what each person receives, pick how you paid them, then mark paid. Nothing posts until you confirm.{payPeriod !== new Date().toISOString().slice(0, 7) && <span className="font-semibold text-amber-600"> You are paying into a past month — payments record under that month.</span>}</p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-right px-3 py-2">Salary</th>
                    <th className="text-right px-3 py-2">Bonus</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-left px-3 py-2">Paid via</th>
                    <th className="text-left px-3 py-2">Notes</th>
                    <th className="text-right px-3 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {payRun.people.map((p) => {
                      const d = payDraft[p.name] || { salary: 0, bonus: 0, source: 'wave' };
                      const total = (Number(d.salary) || 0) + (Number(d.bonus) || 0);
                      const setD = (patch) => setPayDraft(s => ({ ...s, [p.name]: { ...s[p.name], ...patch } }));
                      return (
                        <tr key={p.name} className="border-b border-gray-100">
                          <td className="px-3 py-2">
                            <p className="text-sm font-medium text-gray-900">{p.name}{p.past && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold uppercase tracking-wide">Past staff</span>}</p>
                            <p className="text-xs text-gray-500">{p.role}</p>
                          </td>
                          {p.paid ? (
                            <>
                              <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-700">D{(p.paid.salary || 0).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-700">{Number(p.paid.bonus) > 0 ? `D${p.paid.bonus.toLocaleString()}` : '—'}</td>
                              <td className="px-3 py-2 text-right text-sm font-bold whitespace-nowrap">D{p.paid.total.toLocaleString()}</td>
                              <td className="px-3 py-2 text-sm text-gray-700">{p.paid.paySource || '—'}</td>
                              <td className="px-3 py-2 text-sm text-emerald-700">{p.paid.label || <span className="text-gray-300">—</span>}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-right"><input type="number" value={d.salary} onChange={e => setD({ salary: e.target.value })} className="w-24 text-right border border-gray-200 rounded px-2 py-1 text-sm" /></td>
                              <td className="px-3 py-2 text-right"><input type="number" value={d.bonus} onChange={e => setD({ bonus: e.target.value })} className="w-24 text-right border border-gray-200 rounded px-2 py-1 text-sm" /></td>
                              <td className="px-3 py-2 text-right text-sm font-bold whitespace-nowrap">D{total.toLocaleString()}</td>
                              <td className="px-3 py-2">
                                <select value={d.source} onChange={e => setD({ source: e.target.value })} className="border border-gray-200 rounded px-2 py-1 text-sm">
                                  {(payRun.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2"><input value={d.note || ''} onChange={e => setD({ note: e.target.value })} placeholder="optional" className="w-36 border border-gray-200 rounded px-2 py-1 text-sm" title="What this payment is, if not plain salary — goes to Books and the payslip" /></td>
                            </>
                          )}
                          {!p.paid ? (
                            <td className="px-3 py-2 text-right">
                              <button type="button" onClick={() => startPay(p)} disabled={total <= 0} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${total > 0 ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>Mark paid</button>
                            </td>
                          ) : (
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700" title={p.paid.expenseId ? `Zoho Books #${String(p.paid.expenseId).slice(-6)}` : undefined}>✓ Paid {p.paid.date}</span>
                              {p.paid.editedInZoho && <span className="ml-1 text-[11px] text-amber-600" title="Total was changed directly in Zoho">⚠</span>}
                              <button type="button" title="Edit payment" onClick={() => setPayEdit({ rec: p.paid, salary: p.paid.salary, bonus: p.paid.bonus, source: p.paid.paySourceKey, date: p.paid.date, label: p.paid.label || '' })} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 ml-1"><Edit2 size={15} /></button>
                              <button type="button" title="Undo payment" onClick={() => setPayUndo({ rec: p.paid })} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 ml-1"><Trash2 size={15} /></button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  {(() => {
                    let sal = 0, bon = 0;
                    payRun.people.forEach((p) => {
                      const d = payDraft[p.name] || {};
                      sal += p.paid ? (p.paid.salary || 0) : (Number(d.salary) || 0);
                      bon += p.paid ? (p.paid.bonus || 0) : (Number(d.bonus) || 0);
                    });
                    return (
                      <tfoot>
                        <tr className="border-t-2 border-gray-300">
                          <td className="px-3 py-3 text-sm font-bold text-gray-900">Estimated total</td>
                          <td className="px-3 py-3 text-right text-sm font-bold text-gray-900">D{sal.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right text-sm font-bold text-gray-900">D{bon.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right text-sm font-bold text-gray-900">D{(sal + bon).toLocaleString()}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </div>
          )}
          {paySec === 'team' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Salaries</h3>
            <table className="w-full"><thead><tr className="border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs uppercase text-gray-500">Name</th><th className="text-left px-4 py-3 text-xs uppercase text-gray-500">Role</th>
              <th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Base</th><th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Commission</th>
              <th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Total</th>
            </tr></thead><tbody>
              {team.map((p, i) => <tr key={i} className="border-b border-gray-100"><td className="px-4 py-3 text-sm font-medium text-gray-900">{p.name}</td><td className="px-4 py-3 text-sm text-gray-600">{p.role}</td><td className="px-4 py-3 text-sm text-right">D{p.base.toLocaleString()}</td><td className="px-4 py-3 text-sm text-right">{p.commission > 0 ? <span className="text-green-600">Up to D{p.commission.toLocaleString()}</span> : '—'}</td><td className="px-4 py-3 text-sm font-bold text-right">D{p.total.toLocaleString()}</td></tr>)}
            </tbody><tfoot><tr className="border-t-2 border-gray-300"><td colSpan={4} className="px-4 py-3 font-bold">Total</td><td className="px-4 py-3 text-lg font-bold text-right">D{totalPayroll.toLocaleString()}</td></tr></tfoot></table>
          </div>
          )}
          {paySec === 'history' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-semibold text-gray-900">Payroll History</h3>
              {canSeePayDetail && payLive && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1 mt-1"><DollarSign size={11} /> Live from Zoho Books</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {!canSeePayDetail
                ? 'Monthly totals. Per-person detail is owner-only.'
                : payLoading ? 'Loading from Zoho Books…'
                : payError ? `Couldn't reach Zoho Books (${payError}). Showing the last known figures.`
                : 'Click a month to see the per-person breakdown. Salaries account only.'}
            </p>
            <div className="flex items-center gap-2 mb-4">
              <select value={payHistYear} onChange={(e) => setPayHistYear(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
                <option value="all">All years</option>
                {histYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {canSeePayDetail && (
                <input value={payHistSearch} onChange={(e) => setPayHistSearch(e.target.value)} placeholder="Search a person…" className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              )}
            </div>
            <div className="space-y-3">{(() => {
              const months = histMonths;
              const yearOf = histYearOf;
              const scoped = payHistYear === 'all' ? months : months.filter((m) => yearOf(m) === payHistYear);
              const q = payHistSearch.trim().toLowerCase();
              // Person search → flat results across the scoped months.
              if (q) {
                const hits = [];
                scoped.forEach((m) => (m.people || []).forEach((p) => {
                  if (String(p.name).toLowerCase().includes(q)) hits.push({ month: m.month, ym: m.ym || m.month, name: p.name, note: p.note, amount: p.amount });
                }));
                hits.sort((a, b) => (a.ym < b.ym ? 1 : -1));
                const total = hits.reduce((s, h) => s + (h.amount || 0), 0);
                if (!hits.length) return <p className="px-4 py-8 text-sm text-gray-400 text-center">No payments match “{payHistSearch}”.</p>;
                return (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead><tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-400"><th className="text-left px-4 py-2 font-semibold">Month</th><th className="text-left px-4 py-2 font-semibold">Person</th><th className="text-right px-4 py-2 font-semibold">Amount</th></tr></thead>
                      <tbody>{hits.map((h, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">{h.month}</td>
                          <td className="px-4 py-2 text-sm text-gray-900">{h.name}{h.note && <span className="block text-xs text-gray-400">{h.note}</span>}</td>
                          <td className="px-4 py-2 text-sm text-right font-medium whitespace-nowrap">D{(h.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr className="border-t-2 border-gray-200"><td className="px-4 py-2 text-sm font-bold" colSpan={2}>{hits.length} payment{hits.length === 1 ? '' : 's'}</td><td className="px-4 py-2 text-sm text-right font-bold">D{total.toLocaleString()}</td></tr></tfoot>
                    </table>
                  </div>
                );
              }
              const order = [];
              const byYear = {};
              scoped.forEach((m) => { const y = yearOf(m); if (!byYear[y]) { byYear[y] = []; order.push(y); } byYear[y].push(m); });
              order.sort((a, b) => b.localeCompare(a));
              const renderMonth = (m) => {
              const key = m.ym || m.month;
              const expandable = canSeePayDetail && Array.isArray(m.people) && m.people.length > 0;
              const isOpen = openPayMonth === key;
              // Reconcile: do the itemised lines add up to the recorded total?
              const itemised = (m.people || []).reduce((s, p) => s + (p.amount || 0), 0);
              const reconciles = itemised === m.total;
              return (
                <div key={key} className="border-b border-gray-100 last:border-b-0">
                  <button
                    type="button"
                    disabled={!expandable}
                    onClick={() => expandable && setOpenPayMonth(isOpen ? null : key)}
                    className={`w-full flex items-stretch text-left ${expandable ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap px-3 py-2">
                      {expandable
                        ? <ChevronDown size={13} className={`text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        : <span className="inline-block w-[13px]" />}
                      <span className="text-sm font-medium text-gray-900">{m.month}</span>
                      {m.confidence === 'in_progress' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">In progress</span>}
                      {m.confidence === 'low' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">May be incomplete</span>}
                      {m.breakdown
                        ? <span className="text-xs text-gray-400 truncate hidden md:inline">· {m.breakdown}</span>
                        : m.headcount != null && <span className="text-xs text-gray-400">· {m.headcount} {m.headcount === 1 ? 'person' : 'people'} paid</span>}
                    </div>
                    <div className="w-36 shrink-0 flex items-center justify-end border-l border-gray-100 px-3 py-2">
                      <span className="text-sm font-bold">D{m.total.toLocaleString()}</span>
                    </div>
                  </button>
                  {expandable && isOpen && (
                    <div className="border-t border-gray-100 bg-gray-50/50">
                      {m.people.map((p, j) => (
                        <div key={j} className="flex items-stretch border-b border-gray-100/70">
                          <div className="flex-1 min-w-0 px-3 py-2 pl-[34px]">
                            <span className={`text-sm ${p.unallocated ? 'italic text-gray-500' : 'text-gray-700'}`}>{p.name}</span>
                            {p.note && <span className="block text-xs text-gray-400">{p.note}</span>}
                          </div>
                          <div className="w-36 shrink-0 flex items-center justify-end border-l border-gray-100 px-3 py-2">
                            <span className="text-sm text-gray-700 whitespace-nowrap">D{(p.amount || 0).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-stretch border-t border-gray-200 border-b border-gray-100 bg-gray-100/50">
                        <div className="flex-1 min-w-0 px-3 py-2 pl-[34px]"><span className="text-sm font-bold text-gray-900">Total</span></div>
                        <div className="w-36 shrink-0 flex items-center justify-end border-l border-gray-100 px-3 py-2">
                          <span className="text-sm font-bold text-gray-900 whitespace-nowrap">D{itemised.toLocaleString()}</span>
                        </div>
                      </div>
                      {!reconciles && (
                        <p className="text-xs text-amber-600 px-3 py-2 pl-[34px] flex items-center gap-1">
                          <AlertTriangle size={12} /> Itemised lines (D{itemised.toLocaleString()}) don't match the recorded total (D{m.total.toLocaleString()}).
                        </p>
                      )}
                      {m.confidence === 'low' && (
                        <p className="text-xs text-amber-600 px-3 py-2 pl-[34px] flex items-center gap-1">
                          <AlertTriangle size={12} /> This month looks low vs. the others — likely incomplete bookkeeping. Verify before relying on it.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
              };
              // A specific year is picked → show its months directly (no accordion).
              if (payHistYear !== 'all') {
                return <div className="border border-gray-200 rounded-lg overflow-hidden">{(byYear[payHistYear] || []).map(renderMonth)}</div>;
              }
              // All years → collapsible year sections.
              return order.map((y) => {
                const yMonths = byYear[y];
                const yTotal = yMonths.reduce((s, m) => s + (m.total || 0), 0);
                const open = openYears.includes(y);
                return (
                  <div key={y} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button type="button" onClick={() => toggleYear(y)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                      <span className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <ChevronDown size={15} className={`text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} />{y}
                      </span>
                      <span className="text-xs text-gray-400">{yMonths.length} {yMonths.length === 1 ? 'month' : 'months'} · D{yTotal.toLocaleString()}</span>
                    </button>
                    {open && <div className="border-t border-gray-100">{yMonths.map(renderMonth)}</div>}
                  </div>
                );
              });
            })()}</div>
          </div>
          )}

          {/* Confirm modal — shows the exact Books payload before any real post */}
          {payConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayConfirm(null)}>
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Record payment in Zoho Books</h3>
                <p className="text-sm text-gray-500 mb-4">{payConfirm.person.name} — {payRun?.period}</p>
                {payConfirm.loading ? (
                  <p className="text-sm text-gray-500 py-6 text-center">Checking Zoho…</p>
                ) : payConfirm.error ? (
                  <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{payConfirm.error}</div>
                ) : payConfirm.preview && payConfirm.preview.ok === false ? (
                  <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{payConfirm.preview.message || 'Already recorded.'}</span>
                  </div>
                ) : payConfirm.preview ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Salary</span><span className="font-medium">D{Number(payConfirm.salary || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Bonus</span><span className="font-medium">D{Number(payConfirm.bonus || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between border-t border-gray-100 pt-2"><span className="text-gray-900 font-semibold">Total to Books</span><span className="font-bold">D{payConfirm.preview.total.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Paid via</span><span className="font-medium">{payConfirm.preview.paySource?.label}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{payConfirm.date}</span></div>
                    {payConfirm.label && <div className="flex justify-between"><span className="text-gray-500">Note</span><span className="font-medium text-right">{payConfirm.label}</span></div>}
                    <div className="flex justify-between"><span className="text-gray-500">Account</span><span className="font-medium">Salaries and Employee Wages</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="font-medium text-right">{payConfirm.preview.vendor?.name}{payConfirm.preview.createdVendor && ' (new)'}</span></div>
                    {payConfirm.preview.fuzzyVendor && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Matched by name — confirm this is the right person.</p>}
                    {payConfirm.preview.vendor && String(payConfirm.preview.vendor.id).startsWith('(') && <p className="text-xs text-blue-600">A new vendor "{payConfirm.preview.vendor.name}" will be created in Zoho.</p>}
                    {payConfirm.duplicate && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> {payConfirm.message}</p>}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setPayConfirm(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                  {payConfirm.preview && payConfirm.preview.ok !== false && !payConfirm.duplicate && (
                    <button type="button" onClick={() => confirmPay(false)} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">{payPosting ? 'Recording…' : 'Confirm & record'}</button>
                  )}
                  {payConfirm.duplicate && (
                    <button type="button" onClick={adoptExisting} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">{payPosting ? 'Linking…' : 'Use this payment — edit it'}</button>
                  )}
                  {payConfirm.duplicate && (
                    <button type="button" onClick={() => confirmPay(true)} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">{payPosting ? 'Recording…' : 'Pay again anyway'}</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Record a one-off payment — everything up front, one Save */}
          {oneOff && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !oneOff.busy && setOneOff(null)}>
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Record a payment</h3>
                <p className="text-sm text-gray-500 mb-4">A one-off — training pay, an allowance, an advance. Posts to Zoho Books and shows on their payslip under the month you pick.</p>
                <div className="space-y-3 text-sm">
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Person</span>
                    <select value={oneOff.name} onChange={e => setOneOff(c => ({ ...c, name: e.target.value }))} className="w-56 border border-gray-200 rounded px-2 py-1.5">
                      {(payRun?.people || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">What is it</span>
                    <input value={oneOff.label} onChange={e => setOneOff(c => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay, Transport allowance" className="w-56 border border-gray-200 rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Amount (D)</span>
                    <input type="number" value={oneOff.amount} onChange={e => setOneOff(c => ({ ...c, amount: e.target.value }))} className="w-32 text-right border border-gray-200 rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Counts to month</span>
                    <input type="month" value={oneOff.period} onChange={e => e.target.value && setOneOff(c => ({ ...c, period: e.target.value, date: (() => { const [y, m] = e.target.value.split('-').map(Number); const eom = `${e.target.value}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; return eom < todayISO ? eom : todayISO; })() }))} className="w-40 border border-gray-200 rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Paid on</span>
                    <input type="date" value={oneOff.date} onChange={e => e.target.value && setOneOff(c => ({ ...c, date: e.target.value }))} className="w-40 border border-gray-200 rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Paid via</span>
                    <select value={oneOff.source} onChange={e => setOneOff(c => ({ ...c, source: e.target.value }))} className="w-40 border border-gray-200 rounded px-2 py-1.5">
                      {(payRun?.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
                {oneOff.error && <p className="text-sm text-red-600 mt-3">{oneOff.error}</p>}
                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setOneOff(null)} disabled={oneOff.busy} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                  <button type="button" onClick={submitOneOff} disabled={oneOff.busy} className="px-4 py-2 rounded-lg text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60">{oneOff.busy ? 'Recording…' : 'Save'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Pay all — one confirmation for the whole run */}
          {bulk && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !bulk.busy && setBulk(null)}>
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{bulk.done ? 'Pay all — done' : `Pay ${bulk.people.length} people — ${payRun?.period}`}</h3>
                {!bulk.done ? (
                  <>
                    <p className="text-sm text-gray-500 mb-4">Each payment posts to Zoho Books with the numbers as entered, dated {payDate}. Anyone already paid in Books is skipped.</p>
                    <div className="space-y-1.5 text-sm max-h-56 overflow-y-auto">
                      {bulk.people.map(p => {
                        const d = payDraft[p.name] || {};
                        return <div key={p.name} className="flex justify-between"><span className="text-gray-700">{p.name}</span><span className="font-medium tabular-nums">D{(((Number(d.salary) || 0) + (Number(d.bonus) || 0))).toLocaleString()}</span></div>;
                      })}
                      <div className="flex justify-between border-t border-gray-100 pt-2 font-bold"><span>Total</span><span className="tabular-nums">D{bulk.people.reduce((s, p) => { const d = payDraft[p.name] || {}; return s + (Number(d.salary) || 0) + (Number(d.bonus) || 0); }, 0).toLocaleString()}</span></div>
                    </div>
                    <div className="flex justify-end gap-2 mt-5">
                      <button type="button" onClick={() => setBulk(null)} disabled={bulk.busy} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                      <button type="button" onClick={runBulk} disabled={bulk.busy} className="px-4 py-2 rounded-lg text-sm text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60">{bulk.busy ? 'Recording…' : 'Confirm — pay all'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5 text-sm mt-3 max-h-56 overflow-y-auto">
                      {(bulk.results || []).map(r => <div key={r.name} className="flex justify-between gap-3"><span className="text-gray-700">{r.name}</span><span className={`text-right ${r.status.startsWith('paid') ? 'text-emerald-700' : 'text-amber-600'}`}>{r.status}</span></div>)}
                    </div>
                    <div className="flex justify-end mt-5">
                      <button type="button" onClick={() => setBulk(null)} className="px-4 py-2 rounded-lg text-sm text-white bg-gray-900 hover:bg-gray-800">Done</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Edit a recorded payment */}
          {payEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayEdit(null)}>
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Edit payment — {payEdit.rec.name}</h3>
                <p className="text-sm text-gray-500 mb-4">Updates the record in Zoho Books.</p>
                <div className="space-y-3 text-sm">
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Label <span className="text-gray-400">(optional)</span></span><input value={payEdit.label || ''} onChange={e => setPayEdit(c => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay, Transport allowance" className="w-56 border border-gray-200 rounded px-2 py-1" /></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Salary</span><input type="number" value={payEdit.salary} onChange={e => setPayEdit(c => ({ ...c, salary: e.target.value }))} className="w-32 text-right border border-gray-200 rounded px-2 py-1" /></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Bonus</span><input type="number" value={payEdit.bonus} onChange={e => setPayEdit(c => ({ ...c, bonus: e.target.value }))} className="w-32 text-right border border-gray-200 rounded px-2 py-1" /></label>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-2"><span className="text-gray-900 font-semibold">New total</span><span className="font-bold">D{((Number(payEdit.salary) || 0) + (Number(payEdit.bonus) || 0)).toLocaleString()}</span></div>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Paid via</span>
                    <select value={payEdit.source} onChange={e => setPayEdit(c => ({ ...c, source: e.target.value }))} className="border border-gray-200 rounded px-2 py-1">
                      {(payRun?.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-gray-600">Date</span><input type="date" value={payEdit.date} onChange={e => setPayEdit(c => ({ ...c, date: e.target.value }))} className="border border-gray-200 rounded px-2 py-1" /></label>
                  {payEdit.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{payEdit.error}</div>}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setPayEdit(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                  <button type="button" onClick={saveEdit} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">{payPosting ? 'Saving…' : 'Save changes'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Undo a recorded payment */}
          {payUndo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayUndo(null)}>
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Undo payment?</h3>
                <p className="text-sm text-gray-600 mb-4">This deletes {payUndo.rec.name}'s D{payUndo.rec.total.toLocaleString()} payment ({payUndo.rec.paySource}, {payUndo.rec.date}) from Zoho Books. {payUndo.rec.name} will show as unpaid again.</p>
                {payUndo.error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{payUndo.error}</div>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPayUndo(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                  <button type="button" onClick={confirmUndo} disabled={payPosting} className="px-3 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">{payPosting ? 'Removing…' : 'Undo & delete'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'contracts' && <Contracts />}

      {tab === 'warnings' && (() => {
        const expiring = contractDeadlines.filter(c => c.daysLeft > 0 && c.daysLeft <= 90).length;
        const probationCount = team.filter(t => t.status === 'probation').length;
        const cards = [
          { label: 'Active employees', value: team.length },
          { label: 'Past employees', value: pastStaff.length },
          { label: 'Warnings', value: allWarnings.length, accent: allWarnings.length > 0 ? 'text-red-600' : 'text-gray-900' },
          { label: 'Probation', value: probationCount, accent: probationCount > 0 ? 'text-amber-600' : 'text-gray-900' },
          { label: 'Contracts expiring', value: expiring, sub: '≤ 90 days', accent: expiring > 0 ? 'text-amber-600' : 'text-gray-900' },
          { label: 'Leave requests', value: pendingLeave == null ? '—' : pendingLeave, sub: 'pending' },
        ];
        return (
        <div className="space-y-6">
          {/* HR archive dashboard — real counts only */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((c, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.accent || 'text-gray-900'}`}>{c.value}</p>
                {c.sub && <p className="text-[11px] text-gray-400 mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Warnings &amp; disciplinary</h3>
            <p className="text-sm text-gray-500 mb-4">{allWarnings.length === 0 ? 'No warnings on file across the team.' : `${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'} on record.`}</p>
            {allWarnings.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">No warnings recorded.</div>
            ) : (
              <div className="space-y-2">
                {allWarnings.map(w => {
                  const typeColor = w.type === 'final' ? 'bg-red-200 text-red-900' : w.type === 'formal' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
                  return (
                    <div key={w.id} className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-0.5 ${typeColor}`}>{w.type}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{w.agent}</p>
                        <p className="text-sm text-gray-700 mt-0.5">{w.reason}</p>
                        <p className="text-[11px] text-gray-500 mt-1">{w.date ? new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · issued by {w.issuedBy}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {tab === 'past' && (() => {
        const withCat = pastStaff.map(p => ({ ...p, cat: pastCategory(p.reason) }));
        const cats = ['all', 'Resigned', 'Terminated', 'Contract Ended', 'Training/Internship'];
        const counts = withCat.reduce((m, p) => { m[p.cat] = (m[p.cat] || 0) + 1; return m; }, {});
        const shown = pastFilter === 'all' ? withCat : withCat.filter(p => p.cat === pastFilter);
        return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Past Employees</h3>
          <p className="text-sm text-gray-500 mb-4">Company history — {pastStaff.length} former team member{pastStaff.length === 1 ? '' : 's'}.</p>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {cats.map(c => (
              <button key={c} type="button" onClick={() => setPastFilter(c)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${pastFilter === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {c === 'all' ? `All (${pastStaff.length})` : `${c}${counts[c] ? ` (${counts[c]})` : ''}`}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {shown.map((p, i) => (
              <div key={i} onClick={() => navigate(`/past/${p.name.toLowerCase().replace(/\s+/g, '-')}`)} className="p-4 border border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0"><UserX size={18} className="text-gray-400" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {restorableMap[p.name.toLowerCase().replace(/\s+/g, '')] && (
                      <button onClick={() => restorePast(restorableMap[p.name.toLowerCase().replace(/\s+/g, '')])} className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:border-emerald-500 hover:text-emerald-600"><RotateCcw size={12} /> Restore</button>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${PAST_CAT_COLOR[p.cat] || PAST_CAT_COLOR.Other}`}>{p.cat}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-gray-100">
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Left</p><p className="text-sm text-gray-900 mt-0.5">{p.date || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Monthly pay</p><p className="text-sm text-gray-900 mt-0.5">D{(p.pay || 0).toLocaleString()}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Final settlement</p><p className="text-sm text-gray-900 mt-0.5">{p.finalPay > 0 ? `D${p.finalPay.toLocaleString()}` : '—'}</p></div>
                  <div className="col-span-2 sm:col-span-1"><p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Reason</p><p className="text-sm text-gray-700 mt-0.5">{p.reason}</p></div>
                </div>
              </div>
            ))}
            {shown.length === 0 && <div className="p-10 text-center text-gray-400 text-sm">No one in this category.</div>}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
