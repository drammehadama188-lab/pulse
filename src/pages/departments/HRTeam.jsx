import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, AlertTriangle, Target, Shield,
  Plus, Edit2, Trash2, Settings, ChevronDown, UserX, RotateCcw,
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
