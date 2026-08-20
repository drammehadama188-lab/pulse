import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, AlertTriangle, ChevronDown, ChevronUp,
  TrendingUp, DollarSign, Calendar, Target, MessageSquare, Trash2, Shield,
  Eye, Hand, Gavel, Briefcase, Award,
} from 'lucide-react';
import { team } from '../../data/team';
import { payByName } from '../../lib/pay.js';
import TimePeriodSelector from '../../components/TimePeriodSelector';
import AgentFiles from '../../components/AgentFiles';
import { getToken } from '../../lib/api.js';
import { teamTrackers } from '../../lib/teamTrackers.js';

// Pulse API is token-authenticated; wrap fetch to attach the bearer token.
const authFetch = (u, o = {}) => globalThis.fetch(u, { ...o, headers: { ...(o.headers || {}), Authorization: `Bearer ${getToken()}` } });

const AGENT_PERIODS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_year', label: 'Last Year' },
];

function rangeBounds(key, customFrom, customTo) {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start;
  if (key === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (key === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end.setTime(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime());
  } else if (key === 'last_year') {
    start = new Date(now.getFullYear() - 1, 0, 1);
    end.setTime(new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999).getTime());
  } else if (key === 'custom' && customFrom && customTo) {
    start = new Date(customFrom); start.setHours(0, 0, 0, 0);
    end.setTime(new Date(customTo).setHours(23, 59, 59, 999));
  } else {
    start = new Date(2020, 0, 1);
  }
  return { start, end };
}

const DECISIONS = [
  { value: 'keep_monitoring', label: 'Keep monitoring', icon: Eye, color: 'gray' },
  { value: 'coach', label: 'Coach this week', icon: Hand, color: 'blue' },
  { value: 'warning', label: 'Formal warning', icon: Gavel, color: 'red' },
  { value: 'review_role', label: 'Review role fit', icon: Briefcase, color: 'amber' },
  { value: 'reward', label: 'Reward / support', icon: Award, color: 'emerald' },
];

function matchesAgent(attrName, fullName) {
  if (!attrName || !fullName) return false;
  const a = attrName.toLowerCase().trim();
  const full = fullName.toLowerCase().trim();
  if (a === full) return true;
  const parts = full.split(/\s+/);
  if (a === parts[0]) return true;
  if (parts.length > 1 && a === parts.slice(0, 2).join(' ')) return true;
  return full.includes(a) || a.includes(full);
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

export default function SupervisorProfile({ supervisor }) {
  const navigate = useNavigate();
  // Adama-approved 15 Jul security fix: pay moved out of the public bundle to the
  // payroll-gated endpoint. Same figures for authorized viewers (Adama/payroll);
  // others get no pay, exactly as intended — cost was never meant to be public.
  const [pay, setPay] = useState(null);
  useEffect(() => { if (supervisor) payByName().then((m) => setPay(m[supervisor.name] || null)).catch(() => {}); }, [supervisor?.name]);
  const [crmTrackers, setCrmTrackers] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [decision, setDecision] = useState(null);
  const [decisionHistory, setDecisionHistory] = useState([]);
  const [pickedDecision, setPickedDecision] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionSaved, setDecisionSaved] = useState(false);
  const [allDecisions, setAllDecisions] = useState([]);
  const [rangeKey, setRangeKey] = useState('this_month');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });

  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector('main') || document.scrollingElement;
    if (main && main.scrollTo) main.scrollTo(0, 0);
  }, [supervisor?.name]);

  useEffect(() => {
    if (!supervisor) return;
    // Pulse has no live CRM — sales numbers come from the roster (team.js).
    setCrmTrackers(teamTrackers());
    authFetch(`/api/feedback?agent=${encodeURIComponent(supervisor.name)}`).then(r => r.json()).then(d => setFeedback(d.notes || [])).catch(() => setFeedback([]));
    authFetch(`/api/decisions?agent=${encodeURIComponent(supervisor.name)}`).then(r => r.json()).then(d => {
      if (d.current) {
        setDecision(d.current);
        setPickedDecision(d.current.decision);
        setDecisionReason(d.current.reason || '');
      } else {
        setDecision(null); setPickedDecision(''); setDecisionReason('');
      }
      setDecisionHistory(d.history || []);
    }).catch(() => {});
    authFetch('/api/decisions').then(r => r.json()).then(d => setAllDecisions(d.decisions || [])).catch(() => setAllDecisions([]));
  }, [supervisor?.name]);

  // Direct reports — for sales supervisor: all sales agents + trainees, non-supervisors, not on leave
  const directReports = useMemo(() => team.filter(t =>
    (t.type === 'Sales' || t.type === 'Training') &&
    t.name !== supervisor.name &&
    !(t.role || '').toLowerCase().includes('supervisor') &&
    t.status !== 'maternity'
  ), [supervisor.name]);

  // Selected period drives all team stats. "Previous period" is one period back of the same length.
  const { start: rangeStart, end: rangeEnd } = rangeBounds(rangeKey, customRange.from, customRange.to);
  const rangeMs = rangeEnd - rangeStart;
  const prevEnd = new Date(rangeStart.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - rangeMs);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const rangeLabel = AGENT_PERIODS.find(r => r.value === rangeKey)?.label || (rangeKey === 'custom' ? 'Custom' : 'Period');

  const reportStats = useMemo(() => directReports.map(rep => {
    const allSales = (crmTrackers || []).filter(tr => matchesAgent(tr.If_Agent_Name, rep.name));
    const sales = allSales.filter(tr => {
      const d = new Date(tr.Subscription_Start || tr.Created_Time);
      return d >= rangeStart && d <= rangeEnd;
    });
    const previousPeriodSales = allSales.filter(tr => {
      const d = new Date(tr.Subscription_Start || tr.Created_Time);
      return d >= prevStart && d <= prevEnd;
    });
    const revenue = sales.reduce((s, t) => s + (parseFloat(t.Amount_Paid) || 0), 0);
    const lastSaleDate = allSales.length
      ? allSales.reduce((latest, t) => {
          const d = new Date(t.Subscription_Start || t.Created_Time);
          return !latest || d > latest ? d : latest;
        }, null)
      : null;
    const daysSilent = lastSaleDate ? Math.floor((new Date() - lastSaleDate) / 86400000) : null;
    // Prorate target to range length (in 30-day units)
    const monthlyTarget = rep.target || (rep.status === 'training' ? 2 : 5);
    const rangeDays = Math.max(1, Math.ceil(rangeMs / 86400000));
    const target = rangeKey === 'last_year' ? monthlyTarget * 12 : Math.max(1, Math.round(monthlyTarget * (rangeDays / 30)));
    const perf = target > 0 ? Math.round((sales.length / target) * 100) : 0;
    const repDecisions = (allDecisions || []).filter(d => d.agent === rep.name);
    const recentDecisions = repDecisions.filter(d => new Date(d.setAt) >= thirtyDaysAgo);
    const checkedInRecently = rep.lastCheckIn ? (Math.floor((new Date() - new Date(rep.lastCheckIn)) / 86400000) <= 7) : false;
    return {
      ...rep, salesCount: sales.length, lastMonthSalesCount: previousPeriodSales.length,
      revenue, target, perf, lastSaleDate, daysSilent,
      coachedRecently: recentDecisions.length > 0,
      checkedInRecently,
    };
  }), [directReports, crmTrackers, allDecisions, rangeStart, rangeEnd, prevStart, prevEnd, rangeKey, rangeMs]);

  // Team totals
  const teamSize = directReports.length;
  const teamSales = reportStats.reduce((s, r) => s + r.salesCount, 0);
  const lastMonthTeamSales = reportStats.reduce((s, r) => s + r.lastMonthSalesCount, 0);
  const teamRevenue = reportStats.reduce((s, r) => s + r.revenue, 0);
  const teamTarget = reportStats.reduce((s, r) => s + r.target, 0);
  const teamPerf = teamTarget > 0 ? Math.round((teamSales / teamTarget) * 100) : 0;
  const zeroSalesReports = reportStats.filter(r => r.salesCount === 0);
  const goingSilent = reportStats.filter(r => r.daysSilent !== null && r.daysSilent > 14);
  const activeAgents = reportStats.filter(r => r.salesCount > 0);
  const checkInsDone = reportStats.filter(r => r.checkedInRecently).length;
  const coachedCount = reportStats.filter(r => r.coachedRecently).length;
  const zeroSalesCoached = zeroSalesReports.filter(r => r.coachedRecently).length;
  const teamDelta = teamSales - lastMonthTeamSales;

  // Supervisor effectiveness — judges her management
  const teamTargetHit = teamSales >= teamTarget && teamTarget > 0;
  const followUpDiscipline = zeroSalesReports.length === 0 ? 'good' : zeroSalesCoached === zeroSalesReports.length ? 'good' : zeroSalesCoached >= Math.ceil(zeroSalesReports.length / 2) ? 'partial' : 'poor';
  const trendDir = teamDelta > 0 ? 'up' : teamDelta < 0 ? 'down' : 'flat';

  // Effectiveness composite score (out of 100)
  const effPerfScore = Math.min(40, Math.round(teamPerf * 0.4));
  const effActiveScore = teamSize > 0 ? Math.round((activeAgents.length / teamSize) * 25) : 0;
  const effCoachScore = zeroSalesReports.length === 0 ? 20 : Math.round((zeroSalesCoached / zeroSalesReports.length) * 20);
  const effTrendScore = trendDir === 'up' ? 15 : trendDir === 'flat' ? 8 : 0;
  const effScore = effPerfScore + effActiveScore + effCoachScore + effTrendScore;
  const effRating = effScore >= 80 ? 'Excelling' : effScore >= 60 ? 'On track' : effScore >= 40 ? 'Underperforming' : 'Failing this month';
  const effColor = effScore >= 80 ? 'emerald' : effScore >= 60 ? 'blue' : effScore >= 40 ? 'amber' : 'red';

  // Team status pill
  const teamStatusLabel = teamPerf >= 80 ? 'Excellent' : teamPerf >= 50 ? 'On track' : teamPerf >= 20 ? 'At risk' : 'Critical';
  const teamStatusColor = teamPerf >= 80 ? 'bg-emerald-100 text-emerald-700' : teamPerf >= 50 ? 'bg-blue-100 text-blue-700' : teamPerf >= 20 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';

  // Supervisor's own sales — for selected period
  const supervisorPersonalSales = (crmTrackers || []).filter(tr => {
    if (!matchesAgent(tr.If_Agent_Name, supervisor.name)) return false;
    const d = new Date(tr.Subscription_Start || tr.Created_Time);
    return d >= rangeStart && d <= rangeEnd;
  });
  const personalRevenue = supervisorPersonalSales.reduce((s, t) => s + (parseFloat(t.Amount_Paid) || 0), 0);
  const personalMonthlyTarget = supervisor.target || 5;
  const personalRangeDays = Math.max(1, Math.ceil(rangeMs / 86400000));
  const personalTarget = rangeKey === 'last_year' ? personalMonthlyTarget * 12 : Math.max(1, Math.round(personalMonthlyTarget * (personalRangeDays / 30)));
  // Pay now comes from the payroll-gated `pay` fetch (Adama-approved 15 Jul fix);
  // identical base/commission figures, just no longer read from the public bundle.
  const cost = (pay?.base || 0) + (pay?.commission || 0);

  const initials = supervisor.name.split(' ').map(w => w[0]).slice(0, 2).join('');

  async function addFeedback() {
    const text = newNote.trim();
    if (!text) return;
    try {
      const res = await authFetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: supervisor.name, text }) }).then(r => r.json());
      if (res.note) setFeedback(prev => [res.note, ...prev]);
      setNewNote('');
    } catch(e) {}
  }
  async function removeFeedback(id) {
    try { await authFetch(`/api/feedback/${id}`, { method: 'DELETE' });
      setFeedback(prev => prev.filter(n => n.id !== id));
    } catch(e) {}
  }
  async function saveDecision() {
    if (!pickedDecision) return;
    try {
      const res = await authFetch('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: supervisor.name, decision: pickedDecision, reason: decisionReason }) }).then(r => r.json());
      if (res.decision) {
        if (decision) setDecisionHistory(prev => [decision, ...prev]);
        setDecision(res.decision);
        setDecisionSaved(true);
        setTimeout(() => setDecisionSaved(false), 2000);
      }
    } catch(e) {}
  }

  return (
    <div>
      <button onClick={() => navigate('/sales')} className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6">
        <ArrowLeft size={14} /> Back to Sales
      </button>

      {/* IDENTITY — minimal with status pills + contract row */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-lg font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-semibold text-[var(--color-ink)]">{supervisor.name}</h1>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-700">Supervisor</span>
                {(() => {
                  const isActive = !supervisor.contractEnd || new Date(supervisor.contractEnd) > new Date();
                  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{isActive ? 'Active' : 'Expired'}</span>;
                })()}
              </div>
              <p className="text-[var(--color-ink-soft)]">{supervisor.role}</p>
              <p className="text-[11px] text-[var(--color-ink-faint)] mt-1">Manages {teamSize} {teamSize === 1 ? 'person' : 'people'}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)] mb-0.5">Team status</p>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${teamStatusColor}`}>{teamStatusLabel}</span>
            </div>
            {decision && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)] mb-0.5">Last review</p>
                <p className="text-sm text-[var(--color-ink)] font-medium">{DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}</p>
              </div>
            )}
          </div>
        </div>

        {/* Slim HR row — same format as agent profile */}
        {(() => {
          const contractEnd = supervisor.contractEnd;
          const now = new Date();
          const daysToEndContract = contractEnd ? Math.ceil((new Date(contractEnd) - now) / 86400000) : null;
          return (
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--color-ink-soft)] mt-5 pt-5 border-t border-[var(--color-line-soft)]">
              <span>Started <span className="text-[var(--color-ink-soft)] font-medium">{supervisor.joined || '—'}</span></span>
              <span className="text-[var(--color-ink-faint)]">·</span>
              <span>{supervisor.contract || 'No contract'}</span>
              <span className="text-[var(--color-ink-faint)]">·</span>
              <span>
                Ends <span className={`font-medium ${daysToEndContract !== null && daysToEndContract <= 30 ? 'text-red-600' : daysToEndContract !== null && daysToEndContract <= 90 ? 'text-amber-600' : 'text-[var(--color-ink-soft)]'}`}>
                  {contractEnd ? formatDate(contractEnd) : '—'}
                </span>
                {daysToEndContract !== null && daysToEndContract > 0 && <span className="text-[var(--color-ink-faint)] ml-1">({daysToEndContract}d)</span>}
                {daysToEndContract !== null && daysToEndContract <= 0 && <span className="text-red-500 ml-1">(expired)</span>}
              </span>
              <span className="text-[var(--color-ink-faint)]">·</span>
              <span>Warnings: <span className={`font-medium ${(supervisor.warnings || 0) > 0 ? 'text-red-600' : 'text-[var(--color-ink-soft)]'}`}>{supervisor.warnings || 0}</span></span>
            </div>
          );
        })()}
      </div>

      {/* COMMAND PANEL — team metrics, big and clean */}
      <div className="bg-[var(--color-ink)] rounded-lg p-6 mb-4 text-white">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-white/50">Team Command · {rangeLabel}</p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {rangeStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' — '}
              {rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="bg-white/5 rounded-lg">
            <TimePeriodSelector
              selected={rangeKey}
              periods={AGENT_PERIODS}
              showExport={false}
              onChange={(v, custom) => {
                setRangeKey(v);
                if (v === 'custom' && custom) setCustomRange(custom);
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-1">Team Size</p>
            <p className="text-4xl font-bold">{teamSize}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-1">Team Sales</p>
            <p className="text-4xl font-bold">{teamSales}<span className="text-white/30 text-2xl font-normal"> / {teamTarget}</span></p>
            <p className={`text-xs mt-1 ${teamPerf >= 80 ? 'text-emerald-300' : teamPerf >= 50 ? 'text-amber-300' : 'text-red-300'}`}>{teamPerf}% of team target</p>
          </div>
          <div>
            <p className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-1">Team Revenue</p>
            <p className="text-4xl font-bold">D{(teamRevenue / 1000).toFixed(1)}k</p>
            <p className="text-xs text-white/40 mt-1">D{teamRevenue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/50 uppercase tracking-wider font-semibold mb-1">Need Attention</p>
            <p className={`text-4xl font-bold ${zeroSalesReports.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{zeroSalesReports.length + goingSilent.length}</p>
            <p className="text-xs text-white/40 mt-1">{zeroSalesReports.length} zero · {goingSilent.length} silent</p>
          </div>
        </div>
      </div>

      {/* SUPERVISOR EFFECTIVENESS — judges her management, not just team data */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-[var(--color-ink-faint)]" />
            <h2 className="text-[var(--color-ink)] font-semibold">Supervisor Effectiveness</h2>
          </div>
          <div className="flex items-baseline gap-2">
            <p className={`text-2xl font-bold ${effColor === 'emerald' ? 'text-emerald-600' : effColor === 'blue' ? 'text-blue-600' : effColor === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
              {effScore}<span className="text-[var(--color-ink-faint)] text-sm font-normal">/100</span>
            </p>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${effColor === 'emerald' ? 'bg-emerald-100 text-emerald-700' : effColor === 'blue' ? 'bg-blue-100 text-blue-700' : effColor === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              {effRating}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">Team target hit</p>
            <p className={`text-lg font-bold ${teamTargetHit ? 'text-emerald-600' : 'text-red-600'}`}>{teamTargetHit ? 'Yes' : 'No'}</p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">{teamSales}/{teamTarget} sales</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">Active agents</p>
            <p className={`text-lg font-bold ${activeAgents.length === teamSize ? 'text-emerald-600' : activeAgents.length > 0 ? 'text-amber-600' : 'text-red-600'}`}>
              {activeAgents.length}<span className="text-[var(--color-ink-faint)] text-sm font-normal">/{teamSize}</span>
            </p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">{zeroSalesReports.length} inactive</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">Check-ins (7d)</p>
            <p className={`text-lg font-bold ${checkInsDone === teamSize ? 'text-emerald-600' : checkInsDone > 0 ? 'text-amber-600' : 'text-red-600'}`}>
              {checkInsDone}<span className="text-[var(--color-ink-faint)] text-sm font-normal">/{teamSize}</span>
            </p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">recent contact</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">Coaching done</p>
            <p className={`text-lg font-bold ${followUpDiscipline === 'good' ? 'text-emerald-600' : followUpDiscipline === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
              {coachedCount}<span className="text-[var(--color-ink-faint)] text-sm font-normal">/{teamSize}</span>
            </p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">
              {zeroSalesReports.length > 0 ? `${zeroSalesCoached}/${zeroSalesReports.length} weak coached` : 'no weak agents'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">vs last month</p>
            <p className={`text-lg font-bold ${trendDir === 'up' ? 'text-emerald-600' : trendDir === 'flat' ? 'text-[var(--color-ink-soft)]' : 'text-red-600'}`}>
              {trendDir === 'up' ? '↑ Up' : trendDir === 'flat' ? '→ Flat' : '↓ Down'}
            </p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">{teamDelta >= 0 ? '+' : ''}{teamDelta} sales</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)] mb-1">Follow-up</p>
            <p className={`text-lg font-bold capitalize ${followUpDiscipline === 'good' ? 'text-emerald-600' : followUpDiscipline === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
              {followUpDiscipline}
            </p>
            <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">discipline</p>
          </div>
        </div>
      </div>

      {/* BUSINESS COST — same shape as agent profile, but revenue counts personal + team contribution */}
      {(() => {
        const totalRevenue = personalRevenue + teamRevenue;
        const totalSales = supervisorPersonalSales.length + teamSales;
        const profit = totalRevenue - cost;
        const roi = cost > 0 ? Math.round((totalRevenue / cost) * 100) : 0;
        const costPerSale = totalSales > 0 ? Math.round(cost / totalSales) : null;
        return (
          <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
            <div className="flex items-center gap-2 mb-5">
              <DollarSign size={18} className="text-[var(--color-ink-faint)]" />
              <h2 className="text-[var(--color-ink)] font-semibold">Business Cost</h2>
              <span className="text-[10px] text-[var(--color-ink-faint)] ml-2">revenue = personal + team contribution</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Monthly cost</p>
                <p className="text-2xl font-semibold text-[var(--color-ink)]">D{cost.toLocaleString()}</p>
                <p className="text-[var(--color-ink-soft)] text-xs mt-1 font-medium">D{Math.round(cost / 30).toLocaleString()}/day</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Revenue</p>
                <p className="text-2xl font-semibold text-[var(--color-ink)]">D{totalRevenue.toLocaleString()}</p>
                <p className="text-[var(--color-ink-faint)] text-xs mt-1">D{personalRevenue.toLocaleString()} personal · D{teamRevenue.toLocaleString()} team</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Revenue − Cost</p>
                <p className={`text-2xl font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {profit >= 0 ? '+' : '−'}D{Math.abs(profit).toLocaleString()}
                </p>
                <p className="text-[var(--color-ink-faint)] text-xs mt-1">{profit >= 0 ? 'net contribution' : 'short of cost'}</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">ROI</p>
                <p className={`text-2xl font-semibold ${roi >= 100 ? 'text-emerald-600' : roi >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                  {cost > 0 ? `${roi}%` : '—'}
                </p>
                <p className="text-[var(--color-ink-faint)] text-xs mt-1">revenue / cost</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Cost per sale</p>
                <p className="text-2xl font-semibold text-[var(--color-ink)]">{costPerSale !== null ? `D${costPerSale.toLocaleString()}` : '—'}</p>
                <p className="text-[var(--color-ink-faint)] text-xs mt-1">{costPerSale !== null ? `${totalSales} sales` : 'no sales'}</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Break-even</p>
                {profit >= 0 ? (
                  <>
                    <p className="text-2xl font-semibold text-emerald-600">✓</p>
                    <p className="text-emerald-600 text-xs mt-1 font-medium">+D{profit.toLocaleString()} above</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-semibold text-red-600">−D{Math.abs(profit).toLocaleString()}</p>
                    <p className="text-red-600 text-xs mt-1 font-medium">
                      {Math.ceil(Math.abs(profit) / 7500)} more sales needed
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* CRITICAL — only when there are issues, plain list */}
      {(zeroSalesReports.length > 0 || goingSilent.length > 0) && (
        <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)] mb-3">Team Priorities</p>
          <div className="space-y-2">
            {zeroSalesReports.length > 0 && (
              <div className="flex items-start gap-3 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                <p className="text-[var(--color-ink-soft)]">
                  <span className="font-semibold">{zeroSalesReports.length} zero-sales</span> this month —{' '}
                  {zeroSalesReports.slice(0, 5).map((r, i) => (
                    <span key={r.name}>
                      <button onClick={() => navigate(`/agents/${r.name.toLowerCase().replace(/\s+/g, '-')}`)}
                        className="text-blue-600 hover:underline">{r.name.split(' ')[0]}</button>
                      {i < Math.min(zeroSalesReports.length, 5) - 1 ? ', ' : ''}
                    </span>
                  ))}
                  {zeroSalesReports.length > 5 ? ` +${zeroSalesReports.length - 5} more` : ''}
                </p>
              </div>
            )}
            {goingSilent.length > 0 && (
              <div className="flex items-start gap-3 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <p className="text-[var(--color-ink-soft)]">
                  <span className="font-semibold">{goingSilent.length} going silent</span> (over 14 days) —{' '}
                  {goingSilent.slice(0, 5).map((r, i) => (
                    <span key={r.name}>
                      <button onClick={() => navigate(`/agents/${r.name.toLowerCase().replace(/\s+/g, '-')}`)}
                        className="text-blue-600 hover:underline">{r.name.split(' ')[0]} ({r.daysSilent}d)</button>
                      {i < Math.min(goingSilent.length, 5) - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TEAM GRID — clickable people */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-[var(--color-ink-faint)]" />
            <h2 className="text-[var(--color-ink)] font-semibold">Direct Reports</h2>
          </div>
          <p className="text-[11px] text-[var(--color-ink-faint)]">click any agent for full profile</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reportStats.map(r => {
            const slug = r.name.toLowerCase().replace(/\s+/g, '-');
            const repInitials = r.name.split(' ').map(w => w[0]).slice(0, 2).join('');
            return (
              <div key={r.name} onClick={() => navigate(`/agents/${slug}`)}
                className={`p-4 rounded-lg border cursor-pointer transition-all hover:border-[var(--color-line)] ${
                  r.salesCount === 0 ? 'bg-red-50/40 border-red-100' :
                  r.perf >= 80 ? 'bg-emerald-50/40 border-emerald-100' :
                  'bg-white border-[var(--color-line-soft)]'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                    {repInitials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--color-ink)] truncate">{r.name}</p>
                    <p className="text-[11px] text-[var(--color-ink-soft)] truncate">{r.role}</p>
                  </div>
                  {r.status === 'training' && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">Trainee</span>}
                </div>

                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)] font-semibold">Sales</p>
                  <p className={`text-2xl font-bold ${r.perf >= 80 ? 'text-emerald-600' : r.perf >= 50 ? 'text-amber-600' : r.salesCount > 0 ? 'text-red-600' : 'text-red-600'}`}>
                    {r.salesCount}<span className="text-[var(--color-ink-faint)] text-sm font-normal"> / {r.target}</span>
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[var(--color-fill)] rounded-full overflow-hidden mb-3">
                  <div className={`h-full ${r.perf >= 80 ? 'bg-emerald-500' : r.perf >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Math.max(2, r.perf))}%` }} />
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-ink-soft)]">
                    {r.daysSilent === null ? <span className="text-red-600 font-medium">Never sold</span>
                      : r.daysSilent > 30 ? <span className="text-red-600 font-medium">{r.daysSilent}d silent</span>
                      : r.daysSilent > 14 ? <span className="text-amber-600 font-medium">{r.daysSilent}d silent</span>
                      : <span className="text-emerald-600 font-medium">{r.daysSilent}d ago</span>}
                  </span>
                  <span className="text-[var(--color-ink-soft)] font-medium">D{(r.revenue / 1000).toFixed(1)}k</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* NOTES */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare size={16} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold text-sm">Coaching Notes</h2>
          <span className="text-[var(--color-ink-faint)] text-xs ml-auto">{feedback.length}</span>
        </div>
        <div className="flex gap-2 mb-4">
          <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFeedback()}
            placeholder={`Note about ${supervisor.name.split(' ')[0]}…`}
            className="flex-1 px-4 py-2.5 border border-[var(--color-line)] rounded-full text-sm focus:outline-none focus:border-[var(--color-ink-faint)]" />
          <button onClick={addFeedback} className="px-5 py-2.5 bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white text-sm font-medium rounded-full">Add</button>
        </div>
        {feedback.length === 0 ? (
          <p className="text-[var(--color-ink-faint)] text-xs">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {feedback.slice(0, 5).map(n => (
              <div key={n.id} className="flex items-start gap-3 p-3 bg-[var(--color-fill)] rounded-lg group">
                <div className="flex-1">
                  <p className="text-[var(--color-ink-soft)] text-sm">{n.text}</p>
                  <p className="text-[var(--color-ink-faint)] text-[11px] mt-0.5">{new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {n.createdBy || 'Damia'}</p>
                </div>
                <button onClick={() => removeFeedback(n.id)} className="text-[var(--color-ink-faint)] hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CEO DECISION */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold text-sm">CEO Decision · Supervisor Review</h2>
        </div>
        {decision && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-ink)] text-white flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-white/60">Current</p>
              <p className="text-sm font-medium">
                {DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}
                <span className="text-white/60 font-normal"> · {new Date(decision.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          {DECISIONS.map(d => {
            const Icon = d.icon;
            const active = pickedDecision === d.value;
            const colorMap = {
              gray: active ? 'bg-[var(--color-ink)] text-white border-[var(--color-ink)]' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:border-[var(--color-ink-faint)]',
              blue: active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:border-blue-400',
              red: active ? 'bg-red-600 text-white border-red-600' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:border-red-400',
              amber: active ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:border-amber-400',
              emerald: active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:border-emerald-400',
            };
            return (
              <button key={d.value} onClick={() => setPickedDecision(d.value)}
                className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border-2 text-[11px] font-medium transition-colors ${colorMap[d.color]}`}>
                <Icon size={12} />
                <span className="truncate">{d.label}</span>
              </button>
            );
          })}
        </div>
        <textarea value={decisionReason} onChange={e => setDecisionReason(e.target.value)}
          placeholder="Reason or next step (optional)…"
          className="w-full px-4 py-2.5 border border-[var(--color-line)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-ink-faint)] resize-none" rows={2} />
        <div className="flex justify-end mt-3">
          <button onClick={saveDecision} disabled={!pickedDecision}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${decisionSaved ? 'bg-emerald-600 text-white' : pickedDecision ? 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-faint)] cursor-not-allowed'}`}>
            {decisionSaved ? 'Saved ✓' : 'Save decision'}
          </button>
        </div>
        {decisionHistory.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--color-line-soft)]">
            <p className="text-[var(--color-ink-faint)] text-[10px] uppercase tracking-wider font-semibold mb-2">History</p>
            <div className="space-y-1.5">
              {decisionHistory.slice(0, 3).map((h, i) => (
                <div key={h.id || i} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-ink-soft)]">{DECISIONS.find(d => d.value === h.decision)?.label || h.decision}</span>
                  <span className="text-[var(--color-ink-faint)]">{new Date(h.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FILES & DOCUMENTS */}
      <AgentFiles
        agentName={supervisor.name}
        agentEmail={supervisor.email}
        generateReviewFn={() => {
          const totalRevenue = personalRevenue + teamRevenue;
          const totalSales = supervisorPersonalSales.length + teamSales;
          const profit = totalRevenue - cost;
          const text = `# Supervisor Review — ${supervisor.name}\n## Period: ${rangeLabel}\n## Role: ${supervisor.role}\n## Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n---\n\n## Team Performance\n- Team size: ${teamSize}\n- Team sales: ${teamSales} / ${teamTarget} target (${teamPerf}%)\n- Team revenue: D${teamRevenue.toLocaleString()}\n- Active agents: ${activeAgents.length} / ${teamSize}\n- Inactive agents: ${zeroSalesReports.length} (${zeroSalesReports.map(r => r.name.split(' ')[0]).join(', ') || 'none'})\n\n## Supervisor Effectiveness — ${effScore}/100 (${effRating})\n- Team target hit: ${teamTargetHit ? 'Yes' : 'No'}\n- Active agents: ${activeAgents.length}/${teamSize}\n- Check-ins (7d): ${checkInsDone}/${teamSize}\n- Coaching done: ${coachedCount}/${teamSize} (${zeroSalesCoached}/${zeroSalesReports.length} weak agents coached)\n- vs previous period: ${trendDir === 'up' ? '↑ Up' : trendDir === 'flat' ? '→ Flat' : '↓ Down'} (${teamDelta >= 0 ? '+' : ''}${teamDelta} sales)\n- Follow-up discipline: ${followUpDiscipline}\n\n## Personal Performance\n- Personal sales: ${supervisorPersonalSales.length} / ${personalTarget}\n- Personal revenue: D${personalRevenue.toLocaleString()}\n- Total contribution: D${totalRevenue.toLocaleString()} (personal + team)\n\n## Business Cost\n- Monthly cost: D${cost.toLocaleString()} (D${Math.round(cost/30).toLocaleString()}/day)\n- Revenue: D${totalRevenue.toLocaleString()}\n- Net: ${profit >= 0 ? '+' : '-'}D${Math.abs(profit).toLocaleString()}\n- ROI: ${cost > 0 ? Math.round((totalRevenue/cost)*100) + '%' : '—'}\n\n${decision ? `## Current CEO Decision\n${DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}${decision.reason ? ' — ' + decision.reason : ''}\n_Set ${new Date(decision.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}_\n` : ''}\n${feedback.length > 0 ? `\n## Recent Notes\n${feedback.slice(0, 5).map(n => `- ${n.text} _(${new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})_`).join('\n')}\n` : ''}`;
          return { period: rangeLabel, text };
        }}
        defaultCategory="general"
      />
    </div>
  );
}
