import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, AlertTriangle, Target, Shield,
  Plus, Edit2, Trash2, Settings, ChevronDown, ChevronLeft, ChevronRight, UserX, RotateCcw,
} from 'lucide-react';
// Pay data moved out of the bundle to permission-gated endpoints (Adama-approved
// 15 Jul 2026 security fix — salaries were readable in the public JS). team.js no
// longer carries pay; payrollHistory/totals/per-person pay come from lib/pay.js.
import { team, pastStaff } from '../../data/team';
import Contracts from '../Contracts.jsx';
import { api } from '../../lib/api.js';
import { rosterPay, rosterPrivate } from '../../lib/pay.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { LinesSkeleton } from '../../components/ui/Skeleton.jsx';

// HR & Team — migrated from the Founder Hub HR page into Pulse.
// Metrics read from team.js (Pulse's roster source of truth). KPI rules and
// warnings persist via Pulse's own API (/api/kpi-rules, /api/warnings).

const workingTeam = team.filter(t => t.status !== 'maternity');
const activeTeam = team.filter(t => t.status === 'active');
const probationTeam = team.filter(t => t.status === 'probation');
const trainingTeam = team.filter(t => t.status === 'training');
// Payroll totals are derived from the payroll-gated API inside the component
// (was module-level from team.js pay, which no longer ships in the bundle).
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

const perfColor = p => p >= 80 ? 'text-[var(--color-good)]' : p >= 50 ? 'text-[var(--color-warn)]' : p > 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink-faint)]';
const perfBg = p => p >= 80 ? 'bg-[var(--color-good)]' : p >= 50 ? 'bg-[var(--color-warn)]' : p > 0 ? 'bg-[var(--color-bad)]' : 'bg-[var(--color-ink-faint)]';
const perfLabel = p => p >= 80 ? 'On Track' : p >= 50 ? 'Needs Attention' : p > 0 ? 'Underperforming' : 'New';
const statusBadge = s => ({ active: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', maternity: 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]', probation: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]', training: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' })[s] || 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]';
const typeBadge = t => ({ Sales: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', Operations: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', Marketing: 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]', Technology: 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]', Training: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' })[t] || 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]';
const actionBadge = a => ({ review: 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]', warning: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]', training: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]', promotion: 'bg-[var(--color-good-bg)] text-[var(--color-good)]', 'let-go': 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]', monitor: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', none: 'bg-[var(--color-fill)] text-[var(--color-ink-faint)]' })[a] || 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]';

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
  Terminated: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]',
  'Contract Ended': 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]',
  'Training/Internship': 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]',
  Resigned: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]',
  Other: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]',
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
  // Workday card — every team lead's focus, checklist progress, latest
  // End-of-Day note, plus a composer to send them a task (9 Jul v3).
  // Terminated/archived people (server truth) — the static roster never
  // changes on termination, so the list must derive from /past-agents
  // (Adama 20 Jul: "terminated the contract and it still says active").
  const [archivedAgents, setArchivedAgents] = useState([]);
  useEffect(() => {
    api('/past-agents').then((d) => setArchivedAgents((d.pastAgents || []).filter((p) => p.restorable))).catch(() => {});
  }, []);
  const archivedNames = useMemo(() => new Set(archivedAgents.map((p) => p.name)), [archivedAgents]);

  const [weekOverview, setWeekOverview] = useState(null);
  const [assignDraft, setAssignDraft] = useState({}); // username -> { title, due }
  function loadWorkdayOverview() {
    api('/workday/overview').then((d) => setWeekOverview(d.leads || [])).catch(() => setWeekOverview([]));
  }
  useEffect(() => {
    if (!only || !only.includes('dashboard')) return;
    loadWorkdayOverview();
  }, []);
  async function sendAssignment(username) {
    const d = assignDraft[username] || {};
    if (!String(d.title || '').trim()) return;
    try {
      await api('/assignments', { method: 'POST', body: { username, title: d.title.trim(), due: d.due || null } });
      setAssignDraft((s) => ({ ...s, [username]: { title: '', due: '' } }));
      loadWorkdayOverview();
    } catch (e) { alert(e.message); }
  }
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
  // Pay from the payroll-gated endpoints, never the bundle (Adama-approved 15 Jul
  // security fix). payMap: name -> { base, commission, transport, total }.
  // priv: { pastStaff[], payrollHistory[], totalPayroll }. A non-payroll viewer
  // gets empty data → pay renders as 0 / "—".
  const [payMap, setPayMap] = useState({});
  const [priv, setPriv] = useState(null);
  useEffect(() => {
    rosterPay().then((people) => { const m = {}; for (const x of people) m[x.name] = x; setPayMap(m); }).catch(() => {});
    rosterPrivate().then(setPriv).catch(() => {});
  }, []);
  const pastPayMap = (priv?.pastStaff || []).reduce((m, x) => { m[x.name] = x; return m; }, {});
  const totalBase = Object.values(payMap).reduce((s, x) => s + (Number(x.base) || 0), 0);
  const totalPayroll = (priv?.totalPayroll ?? Object.values(payMap).reduce((s, x) => s + (Number(x.total) || 0), 0));
  // History data source + available years (used by the History sub-page filter).
  const histMonths = canSeePayDetail && payLive ? payLive : (priv?.payrollHistory || []);
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
          (d.people || []).forEach(p => { draft[p.name] = prev[p.name] || { salary: p.suggestedSalary, bonus: p.suggestedBonus, source: (d.paySources?.[0]?.key) || 'access_bank' }; });
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
  // ‹ › step the payroll month one at a time — no calendar needed for nearby
  // months (Adama 3 Aug). Forward stops at the current month: payroll can't
  // run into the future.
  const shiftPayPeriod = (delta) => {
    const [y, m] = payPeriod.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (next <= new Date().toISOString().slice(0, 7)) changePayPeriod(next);
  };
  const payPeriodIsCurrent = payPeriod >= new Date().toISOString().slice(0, 7);
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
      source: payRun?.paySources?.[0]?.key || 'access_bank',
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
      setPayEdit({ rec, salary: rec.salary, bonus: rec.bonus, source: rec.paySourceKey || (payRun.paySources?.[0]?.key) || 'access_bank', date: rec.date });
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
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-page">{title}</h1>
          <p className="text-[var(--color-ink-soft)] mt-1">{subtitle}</p>
        </div>
      </div>

      {showOverview && weekOverview && weekOverview.length > 0 && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {weekOverview.map((w) => {
            const d = assignDraft[w.lead.username] || { title: '', due: '' };
            return (
            <div key={w.lead.username} className="bg-white rounded-lg border border-[var(--color-line)] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">{w.lead.name}'s workday</p>
                <span className="text-[11px] font-semibold text-[var(--color-ink-faint)]">{w.doneCount}/{w.totalItems} ticked</span>
              </div>
              <div className="space-y-1.5">
                {w.focus.length === 0 && <p className="text-[13px] text-[var(--color-ink-faint)]">Nothing behind target.</p>}
                {w.focus.map((f, i) => (
                  <div key={f.key} className="text-[13px] text-[var(--color-ink-soft)]">
                    <span className="font-semibold">{i === 0 ? 'Primary' : 'Supporting'}:</span> {f.title} — {(f.metrics || []).map((m) => `${m.label.toLowerCase()} ${m.value}`).join(' · ')}
                    {f.progress && <span className="ml-1.5 font-semibold tabular-nums">today {f.progress.actual}/{f.progress.goal}</span>}
                    {f.note && <p className="mt-0.5 rounded bg-[var(--color-fill)] px-2 py-1 text-[11.5px] text-[var(--color-ink-soft)]"><span className="font-semibold">His comment:</span> {f.note}</p>}
                  </div>
                ))}
                {(w.adamaOverdue || []).length > 0 && (
                  <div className="rounded-lg bg-[var(--color-bad-bg)] px-2.5 py-2 text-[11.5px] font-semibold text-[var(--color-bad)]">
                    Your items he hasn't done: {w.adamaOverdue.map((o) => `“${o.title}” (${o.date})`).join(' · ')}
                  </div>
                )}
                {w.other && (w.other.title || w.other.note) && (
                  <div className="text-[13px] text-[var(--color-ink-soft)]">
                    <span className="font-semibold">Other:</span> {w.other.title || '—'}
                    {w.other.note && <p className="mt-0.5 rounded bg-[var(--color-fill)] px-2 py-1 text-[11.5px] text-[var(--color-ink-soft)]"><span className="font-semibold">His comment:</span> {w.other.note}</p>}
                  </div>
                )}
              </div>
              {w.assignments.length > 0 && (
                <div className="mt-2 space-y-0.5 text-[11.5px] text-[var(--color-ink-soft)]">
                  {w.assignments.map((a) => <div key={a.id}>{a.done ? '✓' : '○'} {a.title}{a.due ? ` · due ${a.due}` : ''}</div>)}
                </div>
              )}
              <div className="mt-3 flex gap-1.5 border-t border-[var(--color-line-soft)] pt-2">
                <input value={d.title} onChange={(e) => setAssignDraft((s) => ({ ...s, [w.lead.username]: { ...d, title: e.target.value } }))} onKeyDown={(e) => e.key === 'Enter' && sendAssignment(w.lead.username)} placeholder={`Send ${w.lead.name.split(' ')[0]} a task…`} className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[11.5px]" />
                <input type="date" value={d.due || ''} onChange={(e) => setAssignDraft((s) => ({ ...s, [w.lead.username]: { ...d, due: e.target.value } }))} className="rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-[11.5px] text-[var(--color-ink-soft)]" />
                <button onClick={() => sendAssignment(w.lead.username)} className="rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-[11.5px] font-semibold text-white">Send</button>
              </div>
            </div>
          );})}
        </div>
      )}

      {showOverview && alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-[11.5px] font-semibold text-[var(--color-ink-faint)] flex items-center gap-2"><AlertTriangle size={14} className="text-[var(--color-bad)]" /> Attention Required</p>
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${a.type === 'danger' ? 'bg-[var(--color-bad-bg)] border-[var(--color-bad-bg)]' : a.type === 'warning' ? 'bg-[var(--color-warn-bg)] border-[var(--color-warn-bg)]' : 'bg-[var(--color-brand-50)] border-[var(--color-brand-50)]'}`}>
              <AlertTriangle size={14} className={a.type === 'danger' ? 'text-[var(--color-bad)]' : a.type === 'warning' ? 'text-[var(--color-warn)]' : 'text-[var(--color-brand)]'} />
              <div className="flex-1">
                <p className={`text-[13px] font-medium ${a.type === 'danger' ? 'text-[var(--color-bad)]' : a.type === 'warning' ? 'text-[var(--color-warn)]' : 'text-[var(--color-brand-700)]'}`}>{a.msg}</p>
                {a.detail && <p className="text-[11.5px] text-[var(--color-ink-soft)]">{a.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showOverview && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[var(--color-line)] p-4">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-[var(--color-brand-50)]"><Users size={16} className="text-[var(--color-brand)]" /></div><p className="text-[var(--color-ink-soft)] text-[11.5px]">Headcount</p></div>
          <h3 className="text-[22px] font-semibold text-[var(--color-ink)]">{team.length}</h3>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1">{activeTeam.length} active, {probationTeam.length} probation, {trainingTeam.length} training</p>
        </div>
        <div className="bg-white rounded-lg border border-[var(--color-line)] p-4">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-[var(--color-rest-bg)]"><DollarSign size={16} className="text-[var(--color-rest)]" /></div><p className="text-[var(--color-ink-soft)] text-[11.5px]">Payroll</p></div>
          <h3 className="text-[22px] font-semibold text-[var(--color-ink)]">D{totalBase.toLocaleString()}</h3>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1">Base only</p>
        </div>
        <div className="bg-white rounded-lg border border-[var(--color-line)] p-4">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-[var(--color-warn-bg)]"><Target size={16} className="text-[var(--color-warn)]" /></div><p className="text-[var(--color-ink-soft)] text-[11.5px]">In Evaluation</p></div>
          <h3 className="text-[22px] font-semibold text-[var(--color-warn)]">{probationTeam.length + trainingTeam.length}</h3>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1">{probationTeam.length} probation, {trainingTeam.length} training</p>
        </div>
        <div className="bg-white rounded-lg border border-[var(--color-line)] p-4">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-[var(--color-bad-bg)]"><Shield size={16} className="text-[var(--color-bad)]" /></div><p className="text-[var(--color-ink-soft)] text-[11.5px]">Expiring</p></div>
          <h3 className="text-[22px] font-semibold text-[var(--color-bad)]">{contractDeadlines.filter(c => c.daysLeft <= 90).length}</h3>
          <p className="text-[10px] text-[var(--color-ink-soft)] mt-1">Within 90 days</p>
        </div>
      </div>
      )}

      {tabs.length > 1 && (
      <div className="flex gap-1 mb-6 bg-[var(--color-fill)] p-1 rounded-lg w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${tab === t.id ? 'bg-white text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>{t.label}</button>
        ))}
      </div>
      )}

      {tab === 'dashboard' && (
        <div className="space-y-4">
          {/* 12 Jun 2026 (Adama's request): the "Cost vs Value" panel (per-head
              revenue − salary profit, sales/finance data) was replaced with the
              HR-native "Headcount by department" breakdown below, as part of
              narrowing Pulse to HR-only and removing sales-dependent metrics. */}
          <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Headcount by department</h3>
            <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">How the team is distributed today</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {(() => {
                const byType = {};
                team.forEach(t => { byType[t.type] = (byType[t.type] || 0) + 1; });
                return Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count], i) => (
                  <div key={i} className="p-4 rounded-lg border border-[var(--color-line)] text-center">
                    <p className="text-[22px] font-semibold text-[var(--color-ink)]">{count}</p>
                    <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${typeBadge(type)}`}>{type}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Probation &amp; Training</h3>
            <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">Countdown to decision day</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {contractDeadlines.filter(c => c.status === 'probation' || c.status === 'training').map((c, i) => (
                <div key={i} onClick={() => openProfile(c.name)} className="p-4 border border-[var(--color-line)] rounded-lg cursor-pointer transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <div><p className="font-medium text-[var(--color-ink)] text-[13px]">{c.name}</p><p className="text-[11.5px] text-[var(--color-ink-soft)]">{c.role} — {c.contract}</p></div>
                    <div className={`text-center px-3 py-1 rounded-lg ${c.daysLeft <= 7 ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : c.daysLeft <= 21 ? 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' : 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'}`}>
                      <p className="text-[15px] font-semibold">{c.daysLeft}</p><p className="text-[10px]">days left</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-2 bg-[var(--color-line)] rounded-full overflow-hidden"><div className={`h-full rounded-full ${perfBg(c.performance)}`} style={{ width: `${c.performance}%` }} /></div>
                    <span className={`text-[11.5px] font-semibold ${perfColor(c.performance)}`}>{c.performance}%</span>
                  </div>
                  <p className="text-[11.5px] text-[var(--color-ink-soft)] mt-2">{c.nextActionNote}</p>
                  <div className="flex gap-2 mt-3">
                    <span className="px-2 py-0.5 bg-[var(--color-good-bg)] text-[var(--color-good)] text-[10px] font-medium rounded">Pass</span>
                    <span className="px-2 py-0.5 bg-[var(--color-warn-bg)] text-[var(--color-warn)] text-[10px] font-medium rounded">Extend</span>
                    <span className="px-2 py-0.5 bg-[var(--color-bad-bg)] text-[var(--color-bad)] text-[10px] font-medium rounded">Terminate</span>
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
              <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Performance</h3>
              <p className="text-[13px] text-[var(--color-ink-soft)] mt-1">Who is delivering and who is not</p>
            </div>
            <p className="text-[11.5px] text-[var(--color-ink-faint)]">{team.filter(t => t.status !== 'maternity' && !archivedNames.has(t.name)).length} people</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {team.filter(t => t.status !== 'maternity' && !archivedNames.has(t.name)).map((t, i) => {
              const initials = t.name.split(' ').map(w => w[0]).slice(0, 2).join('');
              return (
                <div key={i} onClick={() => openProfile(t.name)} className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 cursor-pointer hover:border-[var(--color-line)] transition-all">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white text-[13px] font-semibold shrink-0" style={{ background: 'var(--gradient-avatar)' }}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-[var(--color-ink)] truncate">{t.name}</p>
                      </div>
                      <p className="text-[11.5px] text-[var(--color-ink-soft)] truncate">{t.role}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${statusBadge(t.status)}`}>{t.status}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeBadge(t.type)}`}>{t.type}</span>
                        {(warningsByAgent[t.name]?.length || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-bad-bg)] text-[var(--color-bad)] flex items-center gap-1"><AlertTriangle size={10} /> {warningsByAgent[t.name].length}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[var(--color-line-soft)]">
                    <div className="flex items-baseline justify-between mb-2">
                      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)] font-semibold">Performance</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-[18px] font-semibold ${perfColor(t.performance)}`}>{t.performance}%</span>
                        <span className="text-[11px] text-[var(--color-ink-faint)]">{perfLabel(t.performance)}</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--color-fill)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${perfBg(t.performance)}`} style={{ width: `${Math.max(t.performance, 2)}%` }} />
                    </div>
                  </div>

                  {t.kpi && (
                    <div className="mt-4">
                      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)] font-semibold mb-1">KPI</p>
                      <p className="text-[11.5px] text-[var(--color-ink-soft)] line-clamp-2">{t.kpi}</p>
                    </div>
                  )}

                  {/* 12 Jun 2026 (Adama's request): per-person Revenue / Net (ROI)
                      block removed here — sales/finance data, dropped as part of
                      narrowing Pulse to HR-only. */}

                  {t.nextAction && t.nextAction !== 'none' && (
                    <div className="mt-4 flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${actionBadge(t.nextAction)}`}>{t.nextAction}</span>
                      {t.nextActionNote && <span className="text-[11px] text-[var(--color-ink-soft)] truncate">{t.nextActionNote}</span>}
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
          <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Settings size={18} className="text-[var(--color-ink-faint)]" />
                  <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">KPI Settings</h3>
                </div>
                <p className="text-[13px] text-[var(--color-ink-soft)] max-w-2xl">
                  Single source of truth for what each person or role is expected to deliver.
                  Resolution priority: <span className="font-medium text-[var(--color-ink-soft)]">agent + specific month → agent default → role + specific month → role default</span>.
                </p>
              </div>
              <button
                onClick={() => { setKpiForm(blankRule); setKpiEditing(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white text-[13px] font-medium rounded-full"
              >
                <Plus size={14} /> Add KPI rule
              </button>
            </div>
          </div>

          {kpiEditing && (
            <div className="bg-white rounded-lg border-2 border-[var(--color-ink)] p-5">
              <div className="flex items-center justify-between mb-5">
                <h4 className="font-semibold text-[var(--color-ink)]">{kpiForm.id ? 'Edit KPI rule' : 'New KPI rule'}</h4>
                <button onClick={() => { setKpiEditing(false); setKpiForm(blankRule); }} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                  <span className="text-[11.5px]">Cancel</span>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-2 block">Applies to</label>
                  <div className="flex gap-2">
                    <button onClick={() => setKpiForm({ ...kpiForm, scope: 'role', agent: '' })}
                      className={`px-4 py-2 rounded-full text-[13px] font-medium ${kpiForm.scope === 'role' ? 'bg-[var(--color-ink)] text-white' : 'bg-white text-[var(--color-ink-soft)] border border-[var(--color-line)] hover:border-[var(--color-ink-faint)]'}`}>
                      A role (e.g. Sales Agent)
                    </button>
                    <button onClick={() => setKpiForm({ ...kpiForm, scope: 'agent', role: '' })}
                      className={`px-4 py-2 rounded-full text-[13px] font-medium ${kpiForm.scope === 'agent' ? 'bg-[var(--color-ink)] text-white' : 'bg-white text-[var(--color-ink-soft)] border border-[var(--color-line)] hover:border-[var(--color-ink-faint)]'}`}>
                      A specific person
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {kpiForm.scope === 'role' && (
                    <div>
                      <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Role</label>
                      <select value={kpiForm.role} onChange={e => setKpiForm({ ...kpiForm, role: e.target.value })}
                        className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]">
                        <option value="">Select role…</option>
                        {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                  {kpiForm.scope === 'agent' && (
                    <div>
                      <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Agent</label>
                      <select value={kpiForm.agent} onChange={e => setKpiForm({ ...kpiForm, agent: e.target.value })}
                        className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]">
                        <option value="">Select person…</option>
                        {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">
                      Period <span className="text-[var(--color-ink-faint)] normal-case font-normal tracking-normal">(YYYY-MM or "default")</span>
                    </label>
                    <input type="text" value={kpiForm.period} onChange={e => setKpiForm({ ...kpiForm, period: e.target.value })}
                      placeholder="default · or 2026-04"
                      list="periods-list"
                      className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                    <datalist id="periods-list">
                      <option value="default" />
                      <option value={`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`} />
                      <option value={`${today.getFullYear()}-${String(today.getMonth()+2).padStart(2,'0')}`} />
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Unit — what you're counting</label>
                  <input type="text" value={kpiForm.unit} onChange={e => setKpiForm({ ...kpiForm, unit: e.target.value })}
                    placeholder="e.g. sales, installs, tickets, posts, renewals"
                    list="kpi-units"
                    className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                  <datalist id="kpi-units">
                    <option value="sales" /><option value="installs" /><option value="tickets" />
                    <option value="renewals" /><option value="posts" /><option value="calls" /><option value="visits" />
                  </datalist>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Personal target / month</label>
                    <input type="number" value={kpiForm.personalTarget} onChange={e => setKpiForm({ ...kpiForm, personalTarget: e.target.value })}
                      placeholder={kpiForm.unit ? `5 ${kpiForm.unit}` : '5'}
                      className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                  </div>
                  <div>
                    <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Team target / month</label>
                    <input type="number" value={kpiForm.teamTarget} onChange={e => setKpiForm({ ...kpiForm, teamTarget: e.target.value })}
                      placeholder="optional"
                      className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                  </div>
                  <div>
                    <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Weekly target (text)</label>
                    <input type="text" value={kpiForm.weeklyTarget} onChange={e => setKpiForm({ ...kpiForm, weeklyTarget: e.target.value })}
                      placeholder={kpiForm.unit ? `4 ${kpiForm.unit}/week` : 'e.g. 4 per week'}
                      className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                  </div>
                </div>

                <div>
                  <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Monthly KPI (human-readable)</label>
                  <input type="text" value={kpiForm.kpi} onChange={e => setKpiForm({ ...kpiForm, kpi: e.target.value })}
                    placeholder="e.g. Complete 8 installs this month"
                    className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                </div>
                <div>
                  <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Core responsibility</label>
                  <input type="text" value={kpiForm.coreResponsibility} onChange={e => setKpiForm({ ...kpiForm, coreResponsibility: e.target.value })}
                    placeholder="e.g. Own renewals and keep customers retained"
                    className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                </div>
                <div>
                  <label className="text-[var(--color-ink-soft)] text-[11.5px] font-medium mb-1 block">Focus (optional theme)</label>
                  <input type="text" value={kpiForm.focus} onChange={e => setKpiForm({ ...kpiForm, focus: e.target.value })}
                    placeholder="e.g. Close high-value renewals"
                    className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-[13px] focus:outline-none focus:border-[var(--color-ink-faint)]" />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="rule-active" checked={kpiForm.active} onChange={e => setKpiForm({ ...kpiForm, active: e.target.checked })} />
                  <label htmlFor="rule-active" className="text-[13px] text-[var(--color-ink-soft)]">Active — apply this rule in performance resolution</label>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-line-soft)]">
                  <button onClick={() => { setKpiEditing(false); setKpiForm(blankRule); }}
                    className="px-4 py-2.5 text-[13px] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">Cancel</button>
                  <button disabled={kpiSaving || (kpiForm.scope === 'role' ? !kpiForm.role : !kpiForm.agent)}
                    onClick={saveKpiRule}
                    className="px-5 py-2.5 bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white text-[13px] font-medium rounded-full disabled:bg-[var(--color-ink-faint)]">
                    {kpiSaving ? 'Saving…' : kpiForm.id ? 'Update rule' : 'Save rule'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 flex flex-wrap items-center gap-3">
            <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Filter</p>
            <select value={kpiFilter.scope} onChange={e => setKpiFilter({ ...kpiFilter, scope: e.target.value })}
              className="px-3 py-1.5 border border-[var(--color-line)] rounded-full text-[11.5px]">
              <option value="all">All scopes</option>
              <option value="role">Role only</option>
              <option value="agent">Agent only</option>
            </select>
            <select value={kpiFilter.period} onChange={e => setKpiFilter({ ...kpiFilter, period: e.target.value })}
              className="px-3 py-1.5 border border-[var(--color-line)] rounded-full text-[11.5px]">
              <option value="all">All periods</option>
              {allPeriods.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={kpiFilter.role} onChange={e => setKpiFilter({ ...kpiFilter, role: e.target.value })}
              className="px-3 py-1.5 border border-[var(--color-line)] rounded-full text-[11.5px]">
              <option value="all">All roles</option>
              {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={kpiFilter.agent} onChange={e => setKpiFilter({ ...kpiFilter, agent: e.target.value })}
              className="px-3 py-1.5 border border-[var(--color-line)] rounded-full text-[11.5px]">
              <option value="all">All agents</option>
              {allAgents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-[11px] text-[var(--color-ink-faint)] ml-auto">{filteredRules.length} of {kpiRules.length} rules</span>
          </div>

          <div className="bg-white rounded-lg border border-[var(--color-line-soft)] overflow-hidden">
            {kpiLoading ? (
              <LinesSkeleton lines={5} />
            ) : filteredRules.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-[13px] text-[var(--color-ink-soft)]">{kpiRules.length === 0 ? 'No KPI rules yet. Click "Add KPI rule" above to set your first one.' : 'No rules match this filter.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-line)] bg-[var(--color-fill)]">
                      <th className="text-left py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Scope</th>
                      <th className="text-left py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Target</th>
                      <th className="text-left py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Period</th>
                      <th className="text-center py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Personal</th>
                      <th className="text-center py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Team</th>
                      <th className="text-left py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Weekly</th>
                      <th className="text-left py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">KPI</th>
                      <th className="text-center py-3 px-4 text-[var(--color-ink-soft)] font-medium text-[11.5px]">Active</th>
                      <th className="text-right py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRules.map(r => {
                      const rPeriodLabel = /^\d{4}-\d{2}$/.test(r.period) ? new Date(r.period + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : r.period;
                      return (
                        <tr key={r.id} className={`border-b border-[var(--color-line-soft)] ${!r.active ? 'opacity-50' : ''}`}>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-medium ${r.scope === 'role' ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]' : 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]'}`}>{r.scope}</span>
                          </td>
                          <td className="py-3 px-4 font-medium text-[var(--color-ink)]">{r.agent || r.role}</td>
                          <td className="py-3 px-4 text-[var(--color-ink-soft)]">{rPeriodLabel}</td>
                          <td className="py-3 px-4 text-center text-[var(--color-ink)]">{r.personalTarget != null ? `${r.personalTarget}${r.unit ? ` ${r.unit}` : ''}` : '—'}</td>
                          <td className="py-3 px-4 text-center text-[var(--color-ink)]">{r.teamTarget != null ? `${r.teamTarget}${r.unit ? ` ${r.unit}` : ''}` : '—'}</td>
                          <td className="py-3 px-4 text-[var(--color-ink-soft)] max-w-[140px] truncate">{r.weeklyTarget || '—'}</td>
                          <td className="py-3 px-4 text-[var(--color-ink-soft)] max-w-[260px] truncate">{r.kpi || '—'}</td>
                          <td className="py-3 px-4 text-center">
                            <span className={`w-2 h-2 rounded-full inline-block ${r.active ? 'bg-[var(--color-good)]' : 'bg-[var(--color-ink-faint)]'}`} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setKpiForm({ ...blankRule, ...r, personalTarget: r.personalTarget ?? '', teamTarget: r.teamTarget ?? '' }); setKpiEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className="p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] rounded-full hover:bg-[var(--color-fill)]">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => deleteKpiRule(r.id)} className="p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)] rounded-full hover:bg-[var(--color-bad-bg)]">
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
          {team.filter((p) => !archivedNames.has(p.name)).map((p, i) => {
            const warns = (warningsByAgent[p.name] || []).length;
            const ends = p.contractEnd ? new Date(p.contractEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
            const daysLeft = p.contractEnd ? Math.ceil((new Date(p.contractEnd) - today) / 86400000) : null;
            return (
              <div key={i} onClick={() => openProfile(p.name)} className="bg-white rounded-lg border border-[var(--color-line)] p-5 hover:border-[var(--color-line)] transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--color-good)] to-[var(--color-good)] flex items-center justify-center text-white text-[13px] font-semibold shrink-0">{p.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[var(--color-ink)]">{p.name}</p>
                      <p className="text-[13px] text-[var(--color-ink-soft)]">{p.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-[11.5px] font-medium capitalize ${statusBadge(p.status)}`}>{p.status}</span>
                    <span className="text-[13px] text-[var(--color-ink-faint)] flex items-center gap-1">View profile <ChevronDown size={15} className="-rotate-90" /></span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4 border-t border-[var(--color-line-soft)]">
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Joined</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">{p.joined || '—'}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Department</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">{p.type || '—'}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Salary</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">D{(payMap[p.name]?.base || 0).toLocaleString()}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Commission</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">{payMap[p.name]?.commission > 0 ? `Up to D${payMap[p.name].commission.toLocaleString()}` : '—'}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Contract ends</p><p className={`text-[13px] mt-0.5 ${daysLeft !== null && daysLeft <= 30 ? 'text-[var(--color-bad)]' : daysLeft !== null && daysLeft <= 90 ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink)]'}`}>{ends}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Warnings</p><p className={`text-[13px] mt-0.5 ${warns > 0 ? 'text-[var(--color-bad)] font-medium' : 'text-[var(--color-ink)]'}`}>{warns}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'payroll' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 bg-white rounded-lg border border-[var(--color-line)] p-1.5 w-fit">
            {payTabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPaySection(k)} className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${paySec === k ? 'bg-[var(--color-ink)] text-white' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'}`}>{label}</button>
            ))}
          </div>
          {paySec === 'run' && canSeePayDetail && payRun && !payRun.error && (
            <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
              <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Run Payroll — {payRun.period && new Date(Number(payRun.period.slice(0, 4)), Number(payRun.period.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => shiftPayPeriod(-1)} className="p-1.5 rounded-lg border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]" title="Previous month"><ChevronLeft size={16} /></button>
                    <input
                      type="month"
                      value={payPeriod}
                      onChange={(e) => changePayPeriod(e.target.value)}
                      className="text-[13px] border border-[var(--color-line)] rounded-lg px-3 py-1.5 text-[var(--color-ink-soft)]"
                      title="Pick which month this payroll applies to — go back to enter or correct a past month"
                    />
                    <button type="button" onClick={() => shiftPayPeriod(1)} disabled={payPeriodIsCurrent} className="p-1.5 rounded-lg border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)] disabled:opacity-40 disabled:hover:border-[var(--color-line)]" title={payPeriodIsCurrent ? 'This is the current month' : 'Next month'}><ChevronRight size={16} /></button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-ink-soft)]">
                    Paid on
                    <input
                      type="date"
                      value={payDate}
                      onChange={(e) => e.target.value && setPayDate(e.target.value)}
                      className="text-[13px] border border-[var(--color-line)] rounded-lg px-3 py-1.5 text-[var(--color-ink-soft)]"
                      title="The payment date recorded in Zoho Books for every Mark paid in this run — defaults to the month's end"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={openOneOff} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-white border border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-line)]">+ Record a payment</button>
                  {(payRun.people || []).some(p => !p.paid) && (
                    <button type="button" onClick={openBulk} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]">Pay all ({(payRun.people || []).filter(p => !p.paid).length})</button>
                  )}
                  <span className="text-[11px] text-[var(--color-ink-faint)] flex items-center gap-1"><DollarSign size={11} /> Records to Zoho Books</span>
                </div>
              </div>
              <p className="text-[11.5px] text-[var(--color-ink-soft)] mb-4">Enter what each person receives, pick how you paid them, then mark paid. Nothing posts until you confirm.{payPeriod !== new Date().toISOString().slice(0, 7) && <span className="font-semibold text-[var(--color-warn)]"> You are paying into a past month — payments record under that month.</span>}</p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-[var(--color-line)] text-[11.5px] uppercase text-[var(--color-ink-soft)]">
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
                      const d = payDraft[p.name] || { salary: 0, bonus: 0, source: 'access_bank' };
                      const total = (Number(d.salary) || 0) + (Number(d.bonus) || 0);
                      const setD = (patch) => setPayDraft(s => ({ ...s, [p.name]: { ...s[p.name], ...patch } }));
                      return (
                        <tr key={p.name} className="border-b border-[var(--color-line-soft)]">
                          <td className="px-3 py-2">
                            <p className="text-[13px] font-medium text-[var(--color-ink)]">{p.name}{p.past && <span className="ml-2 px-1.5 py-0.5 rounded-full bg-[var(--color-fill)] text-[var(--color-ink-soft)] text-[11.5px] font-medium">Past staff</span>}</p>
                            <p className="text-[11.5px] text-[var(--color-ink-soft)]">{p.role}</p>
                            {/* A smaller suggestion is not a mistake — say why
                                it is smaller, in days, on the row itself. */}
                            {p.partMonth && (
                              <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                                Part month: {p.partMonth.workedDays} of {p.partMonth.monthDays} working days ({p.partMonth.from.slice(8)}–{p.partMonth.to.slice(8)})
                              </p>
                            )}
                          </td>
                          {p.paid ? (
                            <>
                              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-[var(--color-ink-soft)]">D{(p.paid.salary || 0).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-[13px] tabular-nums text-[var(--color-ink-soft)]">{Number(p.paid.bonus) > 0 ? `D${p.paid.bonus.toLocaleString()}` : '—'}</td>
                              <td className="px-3 py-2 text-right text-[13px] font-semibold whitespace-nowrap">D{p.paid.total.toLocaleString()}</td>
                              <td className="px-3 py-2 text-[13px] text-[var(--color-ink-soft)]">{p.paid.paySource || '—'}</td>
                              <td className="px-3 py-2 text-[13px] text-[var(--color-good)]">{p.paid.label || <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 text-right"><input type="number" value={d.salary} onChange={e => setD({ salary: e.target.value })} className="w-24 text-right border border-[var(--color-line)] rounded px-2 py-1 text-[13px]" /></td>
                              <td className="px-3 py-2 text-right"><input type="number" value={d.bonus} onChange={e => setD({ bonus: e.target.value })} className="w-24 text-right border border-[var(--color-line)] rounded px-2 py-1 text-[13px]" /></td>
                              <td className="px-3 py-2 text-right text-[13px] font-semibold whitespace-nowrap">D{total.toLocaleString()}</td>
                              <td className="px-3 py-2">
                                <select value={d.source} onChange={e => setD({ source: e.target.value })} className="border border-[var(--color-line)] rounded px-2 py-1 text-[13px]">
                                  {(payRun.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2"><input value={d.note || ''} onChange={e => setD({ note: e.target.value })} placeholder="optional" className="w-36 border border-[var(--color-line)] rounded px-2 py-1 text-[13px]" title="What this payment is, if not plain salary — goes to Books and the payslip" /></td>
                            </>
                          )}
                          {!p.paid ? (
                            <td className="px-3 py-2 text-right">
                              <button type="button" onClick={() => startPay(p)} disabled={total <= 0} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium ${total > 0 ? 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-faint)] cursor-not-allowed'}`}>Mark paid</button>
                            </td>
                          ) : (
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-bg)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-good)]" title={p.paid.expenseId ? `Zoho Books #${String(p.paid.expenseId).slice(-6)}` : undefined}>✓ Paid {p.paid.date}</span>
                              {p.paid.editedInZoho && <span className="ml-1 text-[11px] text-[var(--color-warn)]" title="Total was changed directly in Zoho">⚠</span>}
                              <button type="button" title="Edit payment" onClick={() => setPayEdit({ rec: p.paid, salary: p.paid.salary, bonus: p.paid.bonus, source: p.paid.paySourceKey, date: p.paid.date, label: p.paid.label || '' })} className="p-1.5 rounded-lg text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)] ml-1"><Edit2 size={15} /></button>
                              <button type="button" title="Undo payment" onClick={() => setPayUndo({ rec: p.paid })} className="p-1.5 rounded-lg text-[var(--color-bad)] hover:bg-[var(--color-bad-bg)] ml-1"><Trash2 size={15} /></button>
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
                        <tr className="border-t-2 border-[var(--color-line)]">
                          <td className="px-3 py-3 text-[13px] font-semibold text-[var(--color-ink)]">Estimated total</td>
                          <td className="px-3 py-3 text-right text-[13px] font-semibold text-[var(--color-ink)]">D{sal.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right text-[13px] font-semibold text-[var(--color-ink)]">D{bon.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right text-[13px] font-semibold text-[var(--color-ink)]">D{(sal + bon).toLocaleString()}</td>
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
          <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-4">Team Salaries</h3>
            <table className="w-full"><thead><tr className="border-b border-[var(--color-line)]">
              <th className="text-left px-4 py-3 text-[11.5px] uppercase text-[var(--color-ink-soft)]">Name</th><th className="text-left px-4 py-3 text-[11.5px] uppercase text-[var(--color-ink-soft)]">Role</th>
              <th className="text-right px-4 py-3 text-[11.5px] uppercase text-[var(--color-ink-soft)]">Base</th><th className="text-right px-4 py-3 text-[11.5px] uppercase text-[var(--color-ink-soft)]">Commission</th>
              <th className="text-right px-4 py-3 text-[11.5px] uppercase text-[var(--color-ink-soft)]">Total</th>
            </tr></thead><tbody>
              {team.filter((p) => !archivedNames.has(p.name)).map((p, i) => { const pay = payMap[p.name] || {}; return <tr key={i} className="border-b border-[var(--color-line-soft)]"><td className="px-4 py-3 text-[13px] font-medium text-[var(--color-ink)]">{p.name}</td><td className="px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">{p.role}</td><td className="px-4 py-3 text-[13px] text-right">D{(pay.base || 0).toLocaleString()}</td><td className="px-4 py-3 text-[13px] text-right">{pay.commission > 0 ? <span className="text-[var(--color-good)]">Up to D{pay.commission.toLocaleString()}</span> : '—'}</td><td className="px-4 py-3 text-[13px] font-semibold text-right">D{(pay.total || 0).toLocaleString()}</td></tr>; })}
            </tbody><tfoot><tr className="border-t-2 border-[var(--color-line)]"><td colSpan={4} className="px-4 py-3 font-semibold">Total</td><td className="px-4 py-3 text-[15px] font-semibold text-right">D{totalPayroll.toLocaleString()}</td></tr></tfoot></table>
          </div>
          )}
          {paySec === 'history' && (
          <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Payroll History</h3>
              {canSeePayDetail && payLive && (
                <span className="text-[11px] text-[var(--color-ink-faint)] flex items-center gap-1 mt-1"><DollarSign size={11} /> Live from Zoho Books</span>
              )}
            </div>
            <p className="text-[11.5px] text-[var(--color-ink-soft)] mb-4">
              {!canSeePayDetail
                ? 'Monthly totals. Per-person detail is owner-only.'
                : payLoading ? 'Loading from Zoho Books…'
                : payError ? `Couldn't reach Zoho Books (${payError}). Showing the last known figures.`
                : 'Click a month to see the per-person breakdown. Salaries account only.'}
            </p>
            <div className="flex items-center gap-2 mb-4">
              <select value={payHistYear} onChange={(e) => setPayHistYear(e.target.value)} className="border border-[var(--color-line)] rounded-lg px-3 py-1.5 text-[13px] bg-white">
                <option value="all">All years</option>
                {histYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {canSeePayDetail && (
                <input value={payHistSearch} onChange={(e) => setPayHistSearch(e.target.value)} placeholder="Search a person…" className="flex-1 max-w-xs border border-[var(--color-line)] rounded-lg px-3 py-1.5 text-[13px]" />
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
                if (!hits.length) return <p className="px-4 py-8 text-[13px] text-[var(--color-ink-faint)] text-center">No payments match “{payHistSearch}”.</p>;
                return (
                  <div className="border border-[var(--color-line)] rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead><tr className="border-b border-[var(--color-line-soft)] text-[11.5px] font-medium text-[var(--color-ink-faint)]"><th className="text-left px-4 py-2 font-semibold">Month</th><th className="text-left px-4 py-2 font-semibold">Person</th><th className="text-right px-4 py-2 font-semibold">Amount</th></tr></thead>
                      <tbody>{hits.map((h, i) => (
                        <tr key={i} className="border-b border-[var(--color-line-soft)] last:border-0">
                          <td className="px-4 py-2 text-[13px] text-[var(--color-ink-soft)] whitespace-nowrap">{h.month}</td>
                          <td className="px-4 py-2 text-[13px] text-[var(--color-ink)]">{h.name}{h.note && <span className="block text-[11.5px] text-[var(--color-ink-faint)]">{h.note}</span>}</td>
                          <td className="px-4 py-2 text-[13px] text-right font-medium whitespace-nowrap">D{(h.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}</tbody>
                      <tfoot><tr className="border-t-2 border-[var(--color-line)]"><td className="px-4 py-2 text-[13px] font-semibold" colSpan={2}>{hits.length} payment{hits.length === 1 ? '' : 's'}</td><td className="px-4 py-2 text-[13px] text-right font-semibold">D{total.toLocaleString()}</td></tr></tfoot>
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
                <div key={key} className="border-b border-[var(--color-line-soft)] last:border-b-0">
                  <button
                    type="button"
                    disabled={!expandable}
                    onClick={() => expandable && setOpenPayMonth(isOpen ? null : key)}
                    className={`w-full flex items-stretch text-left ${expandable ? 'hover:bg-[var(--color-fill)] cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap px-3 py-2">
                      {expandable
                        ? <ChevronDown size={13} className={`text-[var(--color-ink-faint)] transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        : <span className="inline-block w-[13px]" />}
                      <span className="text-[13px] font-medium text-[var(--color-ink)]">{m.month}</span>
                      {m.confidence === 'in_progress' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">In progress</span>}
                      {m.confidence === 'low' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-warn-bg)] text-[var(--color-warn)]">May be incomplete</span>}
                      {m.breakdown
                        ? <span className="text-[11.5px] text-[var(--color-ink-faint)] truncate hidden md:inline">· {m.breakdown}</span>
                        : m.headcount != null && <span className="text-[11.5px] text-[var(--color-ink-faint)]">· {m.headcount} {m.headcount === 1 ? 'person' : 'people'} paid</span>}
                    </div>
                    <div className="w-36 shrink-0 flex items-center justify-end border-l border-[var(--color-line-soft)] px-3 py-2">
                      <span className="text-[13px] font-semibold">D{m.total.toLocaleString()}</span>
                    </div>
                  </button>
                  {expandable && isOpen && (
                    <div className="border-t border-[var(--color-line-soft)] bg-[var(--color-fill)]">
                      {m.people.map((p, j) => (
                        <div key={j} className="flex items-stretch border-b border-[var(--color-line-soft)]/70">
                          <div className="flex-1 min-w-0 px-3 py-2 pl-[34px]">
                            <span className={`text-[13px] ${p.unallocated ? 'italic text-[var(--color-ink-soft)]' : 'text-[var(--color-ink-soft)]'}`}>{p.name}</span>
                            {p.note && <span className="block text-[11.5px] text-[var(--color-ink-faint)]">{p.note}</span>}
                          </div>
                          <div className="w-36 shrink-0 flex items-center justify-end border-l border-[var(--color-line-soft)] px-3 py-2">
                            <span className="text-[13px] text-[var(--color-ink-soft)] whitespace-nowrap">D{(p.amount || 0).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-stretch border-t border-[var(--color-line)] border-b border-[var(--color-line-soft)] bg-[var(--color-fill)]/50">
                        <div className="flex-1 min-w-0 px-3 py-2 pl-[34px]"><span className="text-[13px] font-semibold text-[var(--color-ink)]">Total</span></div>
                        <div className="w-36 shrink-0 flex items-center justify-end border-l border-[var(--color-line-soft)] px-3 py-2">
                          <span className="text-[13px] font-semibold text-[var(--color-ink)] whitespace-nowrap">D{itemised.toLocaleString()}</span>
                        </div>
                      </div>
                      {!reconciles && (
                        <p className="text-[11.5px] text-[var(--color-warn)] px-3 py-2 pl-[34px] flex items-center gap-1">
                          <AlertTriangle size={12} /> Itemised lines (D{itemised.toLocaleString()}) don't match the recorded total (D{m.total.toLocaleString()}).
                        </p>
                      )}
                      {m.confidence === 'low' && (
                        <p className="text-[11.5px] text-[var(--color-warn)] px-3 py-2 pl-[34px] flex items-center gap-1">
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
                return <div className="border border-[var(--color-line)] rounded-lg overflow-hidden">{(byYear[payHistYear] || []).map(renderMonth)}</div>;
              }
              // All years → collapsible year sections.
              return order.map((y) => {
                const yMonths = byYear[y];
                const yTotal = yMonths.reduce((s, m) => s + (m.total || 0), 0);
                const open = openYears.includes(y);
                return (
                  <div key={y} className="border border-[var(--color-line)] rounded-lg overflow-hidden">
                    <button type="button" onClick={() => toggleYear(y)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-fill)]">
                      <span className="text-[13px] font-semibold text-[var(--color-ink)] flex items-center gap-2">
                        <ChevronDown size={15} className={`text-[var(--color-ink-faint)] transition-transform ${open ? '' : '-rotate-90'}`} />{y}
                      </span>
                      <span className="text-[11.5px] text-[var(--color-ink-faint)]">{yMonths.length} {yMonths.length === 1 ? 'month' : 'months'} · D{yTotal.toLocaleString()}</span>
                    </button>
                    {open && <div className="border-t border-[var(--color-line-soft)]">{yMonths.map(renderMonth)}</div>}
                  </div>
                );
              });
            })()}</div>
          </div>
          )}

          {/* Confirm modal — shows the exact Books payload before any real post */}
          {payConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayConfirm(null)}>
              <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Record payment in Zoho Books</h3>
                <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">{payConfirm.person.name} — {payRun?.period}</p>
                {payConfirm.loading ? (
                  <p className="text-[13px] text-[var(--color-ink-soft)] py-5 text-center">Checking Zoho…</p>
                ) : payConfirm.error ? (
                  <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-3">{payConfirm.error}</div>
                ) : payConfirm.preview && payConfirm.preview.ok === false ? (
                  <div className="text-[13px] text-[var(--color-warn)] bg-[var(--color-warn-bg)] rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{payConfirm.preview.message || 'Already recorded.'}</span>
                  </div>
                ) : payConfirm.preview ? (
                  <div className="space-y-2 text-[13px]">
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Salary</span><span className="font-medium">D{Number(payConfirm.salary || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Bonus</span><span className="font-medium">D{Number(payConfirm.bonus || 0).toLocaleString()}</span></div>
                    <div className="flex justify-between border-t border-[var(--color-line-soft)] pt-2"><span className="text-[var(--color-ink)] font-semibold">Total to Books</span><span className="font-semibold">D{payConfirm.preview.total.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Paid via</span><span className="font-medium">{payConfirm.preview.paySource?.label}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Date</span><span className="font-medium">{payConfirm.date}</span></div>
                    {payConfirm.label && <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Note</span><span className="font-medium text-right">{payConfirm.label}</span></div>}
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Account</span><span className="font-medium">Salaries and Employee Wages</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-ink-soft)]">Vendor</span><span className="font-medium text-right">{payConfirm.preview.vendor?.name}{payConfirm.preview.createdVendor && ' (new)'}</span></div>
                    {payConfirm.preview.fuzzyVendor && <p className="text-[11.5px] text-[var(--color-warn)] flex items-center gap-1"><AlertTriangle size={12} /> Matched by name — confirm this is the right person.</p>}
                    {payConfirm.preview.vendor && String(payConfirm.preview.vendor.id).startsWith('(') && <p className="text-[11.5px] text-[var(--color-brand)]">A new vendor "{payConfirm.preview.vendor.name}" will be created in Zoho.</p>}
                    {payConfirm.duplicate && <p className="text-[11.5px] text-[var(--color-warn)] flex items-center gap-1"><AlertTriangle size={12} /> {payConfirm.message}</p>}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setPayConfirm(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
                  {payConfirm.preview && payConfirm.preview.ok !== false && !payConfirm.duplicate && (
                    <button type="button" onClick={() => confirmPay(false)} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-60">{payPosting ? 'Recording…' : 'Confirm & record'}</button>
                  )}
                  {payConfirm.duplicate && (
                    <button type="button" onClick={adoptExisting} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-60">{payPosting ? 'Linking…' : 'Use this payment — edit it'}</button>
                  )}
                  {payConfirm.duplicate && (
                    <button type="button" onClick={() => confirmPay(true)} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-warn)] text-white hover:bg-[var(--color-warn)] disabled:opacity-60">{payPosting ? 'Recording…' : 'Pay again anyway'}</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Record a one-off payment — everything up front, one Save */}
          {oneOff && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !oneOff.busy && setOneOff(null)}>
              <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Record a payment</h3>
                <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">A one-off — training pay, an allowance, an advance. Posts to Zoho Books and shows on their payslip under the month you pick.</p>
                <div className="space-y-3 text-[13px]">
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Person</span>
                    <select value={oneOff.name} onChange={e => setOneOff(c => ({ ...c, name: e.target.value }))} className="w-56 border border-[var(--color-line)] rounded px-2 py-1.5">
                      {(payRun?.people || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">What is it</span>
                    <input value={oneOff.label} onChange={e => setOneOff(c => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay, Transport allowance" className="w-56 border border-[var(--color-line)] rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Amount (D)</span>
                    <input type="number" value={oneOff.amount} onChange={e => setOneOff(c => ({ ...c, amount: e.target.value }))} className="w-32 text-right border border-[var(--color-line)] rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Counts to month</span>
                    <input type="month" value={oneOff.period} onChange={e => e.target.value && setOneOff(c => ({ ...c, period: e.target.value, date: (() => { const [y, m] = e.target.value.split('-').map(Number); const eom = `${e.target.value}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; return eom < todayISO ? eom : todayISO; })() }))} className="w-40 border border-[var(--color-line)] rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Paid on</span>
                    <input type="date" value={oneOff.date} onChange={e => e.target.value && setOneOff(c => ({ ...c, date: e.target.value }))} className="w-40 border border-[var(--color-line)] rounded px-2 py-1.5" />
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Paid via</span>
                    <select value={oneOff.source} onChange={e => setOneOff(c => ({ ...c, source: e.target.value }))} className="w-40 border border-[var(--color-line)] rounded px-2 py-1.5">
                      {(payRun?.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
                {oneOff.error && <p className="text-[13px] text-[var(--color-bad)] mt-3">{oneOff.error}</p>}
                <div className="flex justify-end gap-2 mt-5">
                  <button type="button" onClick={() => setOneOff(null)} disabled={oneOff.busy} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
                  <button type="button" onClick={submitOneOff} disabled={oneOff.busy} className="px-4 py-2 rounded-lg text-[13px] text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-600)] disabled:opacity-60">{oneOff.busy ? 'Recording…' : 'Save'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Pay all — one confirmation for the whole run */}
          {bulk && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !bulk.busy && setBulk(null)}>
              <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">{bulk.done ? 'Pay all — done' : `Pay ${bulk.people.length} people — ${payRun?.period}`}</h3>
                {!bulk.done ? (
                  <>
                    <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">Each payment posts to Zoho Books with the numbers as entered, dated {payDate}. Anyone already paid in Books is skipped.</p>
                    <div className="space-y-1.5 text-[13px] max-h-56 overflow-y-auto">
                      {bulk.people.map(p => {
                        const d = payDraft[p.name] || {};
                        return <div key={p.name} className="flex justify-between"><span className="text-[var(--color-ink-soft)]">{p.name}</span><span className="font-medium tabular-nums">D{(((Number(d.salary) || 0) + (Number(d.bonus) || 0))).toLocaleString()}</span></div>;
                      })}
                      <div className="flex justify-between border-t border-[var(--color-line-soft)] pt-2 font-semibold"><span>Total</span><span className="tabular-nums">D{bulk.people.reduce((s, p) => { const d = payDraft[p.name] || {}; return s + (Number(d.salary) || 0) + (Number(d.bonus) || 0); }, 0).toLocaleString()}</span></div>
                    </div>
                    <div className="flex justify-end gap-2 mt-5">
                      <button type="button" onClick={() => setBulk(null)} disabled={bulk.busy} className="px-4 py-2 rounded-lg text-[13px] bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
                      <button type="button" onClick={runBulk} disabled={bulk.busy} className="px-4 py-2 rounded-lg text-[13px] text-white bg-[var(--color-brand)] hover:bg-[var(--color-brand-600)] disabled:opacity-60">{bulk.busy ? 'Recording…' : 'Confirm — pay all'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5 text-[13px] mt-3 max-h-56 overflow-y-auto">
                      {(bulk.results || []).map(r => <div key={r.name} className="flex justify-between gap-3"><span className="text-[var(--color-ink-soft)]">{r.name}</span><span className={`text-right ${r.status.startsWith('paid') ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'}`}>{r.status}</span></div>)}
                    </div>
                    <div className="flex justify-end mt-5">
                      <button type="button" onClick={() => setBulk(null)} className="px-4 py-2 rounded-lg text-[13px] text-white bg-[var(--color-ink)] hover:bg-[var(--color-ink)]">Done</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Edit a recorded payment */}
          {payEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayEdit(null)}>
              <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Edit payment — {payEdit.rec.name}</h3>
                <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">Updates the record in Zoho Books.</p>
                <div className="space-y-3 text-[13px]">
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Label <span className="text-[var(--color-ink-faint)]">(optional)</span></span><input value={payEdit.label || ''} onChange={e => setPayEdit(c => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay, Transport allowance" className="w-56 border border-[var(--color-line)] rounded px-2 py-1" /></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Salary</span><input type="number" value={payEdit.salary} onChange={e => setPayEdit(c => ({ ...c, salary: e.target.value }))} className="w-32 text-right border border-[var(--color-line)] rounded px-2 py-1" /></label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Bonus</span><input type="number" value={payEdit.bonus} onChange={e => setPayEdit(c => ({ ...c, bonus: e.target.value }))} className="w-32 text-right border border-[var(--color-line)] rounded px-2 py-1" /></label>
                  <div className="flex items-center justify-between border-t border-[var(--color-line-soft)] pt-2"><span className="text-[var(--color-ink)] font-semibold">New total</span><span className="font-semibold">D{((Number(payEdit.salary) || 0) + (Number(payEdit.bonus) || 0)).toLocaleString()}</span></div>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Paid via</span>
                    <select value={payEdit.source} onChange={e => setPayEdit(c => ({ ...c, source: e.target.value }))} className="border border-[var(--color-line)] rounded px-2 py-1">
                      {(payRun?.paySources || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3"><span className="text-[var(--color-ink-soft)]">Date</span><input type="date" value={payEdit.date} onChange={e => setPayEdit(c => ({ ...c, date: e.target.value }))} className="border border-[var(--color-line)] rounded px-2 py-1" /></label>
                  {payEdit.error && <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-2">{payEdit.error}</div>}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setPayEdit(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
                  <button type="button" onClick={saveEdit} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-60">{payPosting ? 'Saving…' : 'Save changes'}</button>
                </div>
              </div>
            </div>
          )}

          {/* Undo a recorded payment */}
          {payUndo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !payPosting && setPayUndo(null)}>
              <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Undo payment?</h3>
                <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">This deletes {payUndo.rec.name}'s D{payUndo.rec.total.toLocaleString()} payment ({payUndo.rec.paySource}, {payUndo.rec.date}) from Zoho Books. {payUndo.rec.name} will show as unpaid again.</p>
                {payUndo.error && <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-2 mb-3">{payUndo.error}</div>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPayUndo(null)} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
                  <button type="button" onClick={confirmUndo} disabled={payPosting} className="px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--color-bad)] text-white hover:bg-[var(--color-bad)] disabled:opacity-60">{payPosting ? 'Removing…' : 'Undo & delete'}</button>
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
          { label: 'Active employees', value: team.filter(t => !archivedNames.has(t.name)).length },
          { label: 'Past employees', value: pastStaff.length + archivedAgents.length },
          { label: 'Warnings', value: allWarnings.length, accent: allWarnings.length > 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-ink)]' },
          { label: 'Probation', value: probationCount, accent: probationCount > 0 ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink)]' },
          { label: 'Contracts expiring', value: expiring, sub: '≤ 90 days', accent: expiring > 0 ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink)]' },
          { label: 'Leave requests', value: pendingLeave == null ? '—' : pendingLeave, sub: 'pending' },
        ];
        return (
        <div className="space-y-4">
          {/* HR archive dashboard — real counts only */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((c, i) => (
              <div key={i} className="bg-white rounded-lg border border-[var(--color-line)] p-4">
                <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{c.label}</p>
                <p className={`text-[22px] font-semibold mt-1 ${c.accent || 'text-[var(--color-ink)]'}`}>{c.value}</p>
                {c.sub && <p className="text-[11px] text-[var(--color-ink-faint)] mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Warnings &amp; disciplinary</h3>
            <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">{allWarnings.length === 0 ? 'No warnings on file across the team.' : `${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'} on record.`}</p>
            {allWarnings.length === 0 ? (
              <div className="p-12 text-center text-[var(--color-ink-faint)] text-[13px]">No warnings recorded.</div>
            ) : (
              <div className="space-y-2">
                {allWarnings.map(w => {
                  const typeColor = w.type === 'final' ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : w.type === 'formal' ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]';
                  return (
                    <div key={w.id} className="flex items-start gap-3 p-4 border border-[var(--color-line)] rounded-lg">
                      <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-medium shrink-0 mt-0.5 ${typeColor}`}>{w.type}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[var(--color-ink)]">{w.agent}</p>
                        <p className="text-[13px] text-[var(--color-ink-soft)] mt-0.5">{w.reason}</p>
                        <p className="text-[11px] text-[var(--color-ink-soft)] mt-1">{w.date ? new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · issued by {w.issuedBy}</p>
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
        const archivedAsPast = archivedAgents
          .filter(a => !pastStaff.some(p => p.name === a.name))
          .map(a => ({ name: a.name, role: a.role, reason: a.reason, date: a.date }));
        const withCat = [...archivedAsPast, ...pastStaff].map(p => ({ ...p, ...(pastPayMap[p.name] || {}), cat: pastCategory(p.reason) }));
        const cats = ['all', 'Resigned', 'Terminated', 'Contract Ended', 'Training/Internship'];
        const counts = withCat.reduce((m, p) => { m[p.cat] = (m[p.cat] || 0) + 1; return m; }, {});
        const shown = pastFilter === 'all' ? withCat : withCat.filter(p => p.cat === pastFilter);
        return (
        <div className="bg-white rounded-lg border border-[var(--color-line)] p-5">
          <h3 className="text-[15px] font-semibold text-[var(--color-ink)] mb-1">Past Employees</h3>
          <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">Company history — {withCat.length} former team member{withCat.length === 1 ? '' : 's'}.</p>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {cats.map(c => (
              <button key={c} type="button" onClick={() => setPastFilter(c)} className={`px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-colors ${pastFilter === c ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'}`}>
                {c === 'all' ? `All (${withCat.length})` : `${c}${counts[c] ? ` (${counts[c]})` : ''}`}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {shown.map((p, i) => (
              <div key={i} onClick={() => navigate(`/past/${p.name.toLowerCase().replace(/\s+/g, '-')}`)} className="p-4 border border-[var(--color-line)] rounded-lg cursor-pointer hover:border-[var(--color-line)] transition-all">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-fill)] flex items-center justify-center shrink-0"><UserX size={18} className="text-[var(--color-ink-faint)]" /></div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">{p.name}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-soft)]">{p.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {restorableMap[p.name.toLowerCase().replace(/\s+/g, '')] && (
                      <button onClick={() => restorePast(restorableMap[p.name.toLowerCase().replace(/\s+/g, '')])} className="flex items-center gap-1 rounded-full border border-[var(--color-line)] px-3 py-1 text-[11.5px] font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-good)] hover:text-[var(--color-good)]"><RotateCcw size={12} /> Restore</button>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${PAST_CAT_COLOR[p.cat] || PAST_CAT_COLOR.Other}`}>{p.cat}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-[var(--color-line-soft)]">
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Left</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">{p.date || '—'}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Monthly pay</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">D{(p.pay || 0).toLocaleString()}</p></div>
                  <div><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Final settlement</p><p className="text-[13px] text-[var(--color-ink)] mt-0.5">{p.finalPay > 0 ? `D${p.finalPay.toLocaleString()}` : '—'}</p></div>
                  <div className="col-span-2 sm:col-span-1"><p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Reason</p><p className="text-[13px] text-[var(--color-ink-soft)] mt-0.5">{p.reason}</p></div>
                </div>
              </div>
            ))}
            {shown.length === 0 && <div className="p-10 text-center text-[var(--color-ink-faint)] text-[13px]">No one in this category.</div>}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
