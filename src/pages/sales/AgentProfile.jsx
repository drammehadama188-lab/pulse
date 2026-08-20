import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Target, TrendingUp, TrendingDown, DollarSign,
  AlertTriangle, CheckCircle, MessageSquare, Trash2, ChevronDown, ChevronUp,
  Award, Shield, Hand, Eye, Gavel, Briefcase, Clock, Settings, X,
} from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { team } from '../../data/team';
import { payByName } from '../../lib/pay.js';
import TimePeriodSelector from '../../components/TimePeriodSelector';
import SupervisorProfile from './SupervisorProfile';
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

const DECISIONS = [
  { value: 'keep_monitoring', label: 'Keep monitoring', icon: Eye, color: 'gray' },
  { value: 'coach', label: 'Coach this week', icon: Hand, color: 'blue' },
  { value: 'warning', label: 'Formal warning', icon: Gavel, color: 'red' },
  { value: 'review_role', label: 'Review role fit', icon: Briefcase, color: 'amber' },
  { value: 'reward', label: 'Reward / support', icon: Award, color: 'emerald' },
];

const NOTE_CATEGORIES = [
  { value: 'coaching', label: 'Coaching note', color: 'blue' },
  { value: 'issue', label: 'Issue observed', color: 'red' },
  { value: 'followup', label: 'Follow-up', color: 'amber' },
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

function matchesAgent(attrName, fullName) {
  if (!attrName || !fullName) return false;
  const a = attrName.toLowerCase().trim();
  const full = fullName.toLowerCase().trim();
  if (a === full) return true;
  const parts = full.split(/\s+/);
  if (a === parts[0]) return true;
  if (parts.length > 1 && a === parts.slice(0, 2).join(' ')) return true;
  if (full.includes(a) || a.includes(full)) return true;
  return false;
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// Clean transparent scoring: 40 sales + 20 check-ins + 30 revenue − up to 30 warnings
function computeScore(salesCount, revenue, agent) {
  const target = agent.target || 0;
  const salesScore = target > 0 ? Math.min(40, Math.round((salesCount / target) * 40)) : (salesCount > 0 ? 25 : 0);

  let activityScore = 0;
  if (agent.lastCheckIn) {
    const daysSince = Math.floor((new Date() - new Date(agent.lastCheckIn)) / 86400000);
    if (daysSince <= 7) activityScore = 20;
    else if (daysSince <= 14) activityScore = 15;
    else if (daysSince <= 30) activityScore = 10;
    else activityScore = 5;
  }

  const revBenchmark = 30000;
  const revScore = Math.min(30, Math.round((revenue / revBenchmark) * 30));
  const warningPenalty = Math.min(30, (agent.warnings || 0) * 10);
  const total = Math.max(0, Math.min(100, salesScore + activityScore + revScore - warningPenalty));

  let rating;
  if (total >= 80) rating = 'Top performer';
  else if (total >= 60) rating = 'On track';
  else if (total >= 40) rating = 'Needs attention';
  else rating = 'At risk';

  return { score: total, rating, salesScore, activityScore, revScore, warningPenalty };
}

// Narrative helpers — turn numbers into meaning
function salesNarrative(salesCount, target) {
  if (target === 0) return 'No sales target set';
  if (salesCount === 0) return 'Missed target completely';
  const pct = (salesCount / target) * 100;
  if (pct >= 100) return 'Target hit or exceeded';
  if (pct >= 80) return 'On track to hit';
  if (pct >= 50) return 'Partial progress';
  return 'Significantly behind';
}
function checkinNarrative(activityScore, salesCount) {
  if (activityScore >= 20 && salesCount === 0) return 'Active but not converting';
  if (activityScore >= 20) return 'Engaged and delivering';
  if (activityScore >= 15) return 'Recent contact';
  if (activityScore >= 10) return 'Intermittent check-ins';
  if (activityScore >= 5) return 'Out of touch';
  return 'No check-ins on record';
}
function revenueNarrative(revenue, cost) {
  if (revenue === 0) return 'Not yet earning';
  if (revenue >= cost && cost > 0) return `Covering cost + D${(revenue - cost).toLocaleString()}`;
  if (cost > 0) return `D${(cost - revenue).toLocaleString()} below break-even`;
  return `D${revenue.toLocaleString()} contributed`;
}
function warningNarrative(warnings) {
  if (warnings === 0) return 'Clean record — no warnings';
  if (warnings === 1) return 'One active warning';
  return `${warnings} active warnings`;
}

function trendInterpretation(months) {
  const counts = months.map(m => m.sales);
  if (counts.every(c => c === 0)) return { type: 'critical', text: 'No activity for 4 consecutive months', sub: 'No improvement trend detected' };
  const zeros = counts.filter(c => c === 0).length;
  const last = counts[counts.length - 1];
  const prev = counts[counts.length - 2];
  if (zeros >= 3) return { type: 'warning', text: `Silent ${zeros} of last 4 months`, sub: 'No consistent pattern of recovery' };
  if (last === 0 && prev > 0) return { type: 'warning', text: 'Just went silent — no sales this month', sub: 'Momentum has stopped' };
  const isDecreasing = counts.every((c, i) => i === 0 || c <= counts[i-1]) && counts[0] > counts[counts.length-1];
  const isIncreasing = counts.every((c, i) => i === 0 || c >= counts[i-1]) && counts[counts.length-1] > counts[0];
  if (isDecreasing) return { type: 'warning', text: 'Declining over 4 months', sub: 'Getting worse, not better' };
  if (isIncreasing) return { type: 'good', text: 'Improving over 4 months', sub: 'Building momentum' };
  const best = Math.max(...counts);
  const worst = Math.min(...counts);
  if (best === worst) return { type: 'neutral', text: `Stable at ${best} sales/month`, sub: null };
  return { type: 'neutral', text: 'Inconsistent — no clear pattern', sub: null };
}

function recommendationFor(salesCount, target, warnings, status, activityScore = 0) {
  if (salesCount === 0 && status === 'training') {
    return { type: 'critical', action: 'Likely let go', reason: 'Zero sales during training. Review end of training week.' };
  }
  if (salesCount === 0 && activityScore < 10) {
    return { type: 'critical', action: 'Performance critical — act now', reason: 'Zero sales AND minimal activity. This is urgent. Show-up problem, not just a sales problem.' };
  }
  if (salesCount === 0) {
    return { type: 'critical', action: 'Immediate intervention required', reason: 'Zero sales despite being active. Schedule 1:1 immediately — skill or approach problem.' };
  }
  const perf = target > 0 ? (salesCount / target) * 100 : 0;
  if (perf < 50) return { type: 'review', action: 'Push harder — review pipeline', reason: `At ${Math.round(perf)}% of target. ${Math.max(0, target - salesCount)} more to go.` };
  if (perf >= 100 && warnings === 0) return { type: 'praise', action: 'Recognize + consider bonus', reason: 'Hit or exceeded target. Recognize publicly.' };
  if (perf >= 80) return { type: 'encourage', action: 'Keep pushing', reason: 'On track. Stay close.' };
  return { type: 'monitor', action: 'Monitor closely', reason: 'Mid-range. Check in weekly.' };
}

function patternInsight(salesCount, target, activityScore, rangeKey) {
  if (target === 0) return null;
  if (salesCount === 0 && activityScore >= 15) return { tone: 'warning', text: 'No conversion despite activity — likely skill or approach issue.' };
  if (salesCount === 0 && activityScore >= 5) return { tone: 'warning', text: 'Low activity with zero sales — motivation or engagement issue.' };
  if (salesCount === 0) return { tone: 'critical', text: 'Inactive AND underperforming — show-up and performance concern.' };
  if (salesCount >= target) return { tone: 'good', text: 'Meeting or exceeding target — maintain momentum.' };
  const perf = (salesCount / target) * 100;
  if (perf < 50) return { tone: 'warning', text: 'Significantly behind target — review pipeline and conversion.' };
  return null;
}

function autoReviewFor(agent, salesCount, target, revenue, score, rec, periodLabel) {
  const parts = [];
  parts.push(`${agent.name} — ${agent.role}`);
  parts.push(`${periodLabel} review`);
  parts.push('');

  if (target === 0) {
    parts.push(`Non-sales role. Evaluated on: ${agent.coreResponsibility || 'core responsibility'}.`);
  } else if (salesCount === 0) {
    if (score.activityScore >= 15) {
      parts.push(`Zero sales against a target of ${target}. Active on check-ins but no conversion.`);
      parts.push(`This is a performance issue, not an effort issue.`);
    } else if (score.activityScore >= 5) {
      parts.push(`Zero sales against a target of ${target}. Patchy check-ins suggest motivation or engagement problem.`);
      parts.push(`This is both a performance and an activity issue.`);
    } else {
      parts.push(`Zero sales and no recent activity. ${agent.status === 'training' ? 'Training period — immediate evaluation required.' : 'Not showing up. Serious concern.'}`);
    }
  } else if (salesCount >= target) {
    parts.push(`Hit target — ${salesCount} sales against a goal of ${target}. Revenue D${revenue.toLocaleString()}. Strong period.`);
  } else {
    const pct = Math.round((salesCount/target)*100);
    parts.push(`${salesCount} sale${salesCount === 1 ? '' : 's'} against a target of ${target} (${pct}%). Revenue D${revenue.toLocaleString()}.`);
    if (pct < 50) parts.push('Significantly behind. Review pipeline and conversion process.');
  }

  if (agent.warnings > 0) parts.push(`${agent.warnings} active warning${agent.warnings > 1 ? 's' : ''}.`);
  parts.push('');
  parts.push(`Scorecard: ${score.score}/100 — ${score.rating}.`);
  parts.push(`Recommendation: ${rec.action}. ${rec.reason}`);
  return parts.join('\n');
}

function parseNote(n) {
  // Notes are stored as "[category] text" — parse out category for display
  const m = (n.text || '').match(/^\[(coaching|issue|followup)\]\s*(.*)$/i);
  if (m) return { category: m[1].toLowerCase(), text: m[2], raw: n };
  return { category: null, text: n.text, raw: n };
}

export default function AgentProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const agent = team.find(t => t.name.toLowerCase().replace(/\s+/g, '-') === slug);

  // Supervisors get a different layout — team-first, command-style
  if (agent && (agent.role || '').toLowerCase().includes('supervisor')) {
    return <SupervisorProfile supervisor={agent} />;
  }

  // Pay from the payroll-gated endpoint, never the bundle → cost/ROI show 0 for
  // viewers without payroll power.
  const [pay, setPay] = useState(null);
  useEffect(() => { if (agent) payByName().then((m) => setPay(m[agent.name] || null)).catch(() => {}); }, [agent?.name]);
  const [feedback, setFeedback] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [noteCategory, setNoteCategory] = useState('coaching');
  const [crmTrackers, setCrmTrackers] = useState([]);
  const [rangeKey, setRangeKey] = useState('this_month');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [loadingCrm, setLoadingCrm] = useState(false);
  const [decision, setDecision] = useState(null);
  const [decisionHistory, setDecisionHistory] = useState([]);
  const [pickedDecision, setPickedDecision] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionSaved, setDecisionSaved] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [resolvedKpi, setResolvedKpi] = useState(null);
  const [allRules, setAllRules] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [warningOpen, setWarningOpen] = useState(false);
  const [newWarning, setNewWarning] = useState({ type: 'verbal', reason: '', date: new Date().toISOString().slice(0, 10) });
  const [savingWarning, setSavingWarning] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector('main') || document.scrollingElement;
    if (main && main.scrollTo) main.scrollTo(0, 0);
  }, [slug]);

  useEffect(() => {
    if (!agent) return;
    authFetch(`/api/feedback?agent=${encodeURIComponent(agent.name)}`).then(r => r.json()).then(d => setFeedback(d.notes || [])).catch(() => setFeedback([]));
    authFetch(`/api/warnings?agent=${encodeURIComponent(agent.name)}`).then(r => r.json()).then(d => setWarnings(d.warnings || [])).catch(() => setWarnings([]));
    authFetch(`/api/decisions?agent=${encodeURIComponent(agent.name)}`).then(r => r.json()).then(d => {
      if (d.current) {
        setDecision(d.current);
        setPickedDecision(d.current.decision);
        setDecisionReason(d.current.reason || '');
      } else {
        setDecision(null);
        setPickedDecision('');
        setDecisionReason('');
      }
      setDecisionHistory(d.history || []);
    }).catch(() => {});
    authFetch('/api/kpi-rules').then(r => r.json()).then(d => setAllRules(d.rules || [])).catch(() => setAllRules([]));
  }, [agent?.name]);

  useEffect(() => {
    // Pulse has no live CRM — sales numbers come from the roster (team.js).
    setCrmTrackers(teamTrackers());
  }, []);

  const { start: rangeStart, end: rangeEnd } = rangeBounds(rangeKey, customRange.from, customRange.to);

  // All sales ever attributed to this agent (for last-sale + trend)
  const allAgentSales = useMemo(() => {
    if (!agent) return [];
    return (crmTrackers || [])
      .filter(t => matchesAgent(t.If_Agent_Name, agent.name) && (t.Subscription_Start || t.Created_Time))
      .sort((a, b) => new Date(b.Subscription_Start || b.Created_Time) - new Date(a.Subscription_Start || a.Created_Time));
  }, [crmTrackers, agent?.name]);

  // Sales within selected period
  const periodSales = useMemo(() => {
    if (!agent) return [];
    return allAgentSales.filter(t => {
      const d = new Date(t.Subscription_Start || t.Created_Time);
      return d >= rangeStart && d <= rangeEnd;
    });
  }, [allAgentSales, rangeStart, rangeEnd]);

  // Sales last month (for score comparison)
  const lastMonthSales = useMemo(() => {
    if (!agent) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return allAgentSales.filter(t => {
      const d = new Date(t.Subscription_Start || t.Created_Time);
      return d >= start && d <= end;
    });
  }, [allAgentSales]);

  // Last 4 months trend (including current)
  const last4Months = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 3; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const salesInMonth = allAgentSales.filter(t => {
        const d = new Date(t.Subscription_Start || t.Created_Time);
        return d >= mStart && d <= mEnd;
      });
      months.push({
        label: MONTHS_SHORT[mStart.getMonth()],
        sales: salesInMonth.length,
        revenue: salesInMonth.reduce((s, t) => s + (parseFloat(t.Amount_Paid) || 0), 0),
        isCurrent: i === 0,
      });
    }
    return months;
  }, [allAgentSales]);

  if (!agent) return (
    <div>
      <button onClick={() => navigate('/sales')} className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6"><ArrowLeft size={14} /> Back to Sales</button>
      <p className="text-[var(--color-ink-soft)]">Agent not found.</p>
    </div>
  );

  // Determine which period key to use for KPI display, based on selected range
  function periodKeyFromRange(key) {
    const now = new Date();
    if (key === 'this_month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (key === 'last_month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (key === 'last_year') return `${now.getFullYear() - 1}`;
    return 'default';
  }
  const selectedPeriod = periodKeyFromRange(rangeKey);
  const periodLabelForKpi = /^\d{4}-\d{2}$/.test(selectedPeriod)
    ? new Date(selectedPeriod + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : selectedPeriod;

  // Resolve KPI from rules: agent+period > agent+default > role+period > role+default > team.js
  function resolveLocal(rules) {
    const active = (rules || []).filter(r => r.active !== false);
    const layers = [
      active.find(r => r.scope === 'role' && r.role === agent.role && r.period === 'default'),
      active.find(r => r.scope === 'role' && r.role === agent.role && r.period === selectedPeriod),
      active.find(r => r.scope === 'agent' && r.agent === agent.name && r.period === 'default'),
      active.find(r => r.scope === 'agent' && r.agent === agent.name && r.period === selectedPeriod),
    ].filter(Boolean);
    const merged = {};
    const sources = [];
    for (const layer of layers) {
      ['personalTarget', 'teamTarget', 'weeklyTarget', 'kpi', 'coreResponsibility', 'focus'].forEach(k => {
        if (layer[k] !== undefined && layer[k] !== null && layer[k] !== '') merged[k] = layer[k];
      });
      sources.push(layer);
    }
    return { merged, sources };
  }
  const { merged: resolved, sources: ruleSources } = resolveLocal(allRules);

  const effectiveKpi = resolved.kpi ?? agent.kpi;
  const effectiveWeekly = resolved.weeklyTarget ?? agent.weeklyTarget;
  const effectiveResp = resolved.coreResponsibility ?? agent.coreResponsibility;
  const effectiveTarget = resolved.personalTarget ?? agent.target;
  const effectiveTeamTarget = resolved.teamTarget ?? null;
  const effectiveFocus = resolved.focus ?? null;
  const topSource = ruleSources[ruleSources.length - 1];
  const sourceLabel = topSource
    ? topSource.scope === 'agent' && topSource.period !== 'default'
      ? `Set for ${agent.name.split(' ')[0]} · ${periodLabelForKpi}`
      : topSource.scope === 'agent'
      ? `${agent.name.split(' ')[0]} default`
      : topSource.scope === 'role' && topSource.period !== 'default'
      ? `${topSource.role} · ${periodLabelForKpi}`
      : `${topSource.role} default`
    : 'Using code fallback';

  const salesCount = periodSales.length;
  const revenue = periodSales.reduce((s, t) => s + (parseFloat(t.Amount_Paid) || 0), 0);
  const rangeDays = Math.max(1, Math.ceil((rangeEnd - rangeStart) / 86400000));
  const monthlyTarget = effectiveTarget || 0;
  const proratedTarget = rangeKey === 'last_year' ? null : Math.max(1, Math.round(monthlyTarget * (rangeDays / 30)));
  const perf = proratedTarget ? Math.round((salesCount / proratedTarget) * 100) : 0;
  const rangeLabel = AGENT_PERIODS.find(r => r.value === rangeKey)?.label || (rangeKey === 'custom' ? 'Custom Range' : '');

  const cost = (pay?.base || 0) + (pay?.commission || 0);
  const profit = revenue - cost;
  const roi = cost > 0 ? Math.round((revenue / cost) * 100) : 0;
  const costPerSale = salesCount > 0 ? Math.round(cost / salesCount) : null;

  const joinedDate = agent.joined ? new Date(agent.joined) : null;
  const validJoined = joinedDate && !isNaN(joinedDate.getTime());
  const daysSinceJoined = validJoined ? Math.max(1, Math.floor((new Date() - joinedDate) / 86400000)) : null;
  const lifetimeCost = daysSinceJoined ? Math.round((cost / 30) * daysSinceJoined) : null;
  const lifetimeLabel = (() => {
    if (!daysSinceJoined) return '';
    if (daysSinceJoined < 30) return `${daysSinceJoined} day${daysSinceJoined === 1 ? '' : 's'}`;
    const months = daysSinceJoined / 30;
    if (months < 12) return `${months.toFixed(1)} months`;
    const years = months / 12;
    return `${years.toFixed(1)} years`;
  })();

  const warningsCount = warnings.length;
  const score = computeScore(salesCount, revenue, { ...agent, target: effectiveTarget, warnings: warningsCount });
  const lastMonthScore = computeScore(
    lastMonthSales.length,
    lastMonthSales.reduce((s, t) => s + (parseFloat(t.Amount_Paid) || 0), 0),
    { ...agent, target: effectiveTarget, warnings: warningsCount }
  );
  const scoreDelta = score.score - lastMonthScore.score;

  // Team comparison: rank against comparable agents only (sales staff with targets)
  // Use last-completed-month data so rank is based on a real period, not 5 days of the current month
  const teamScores = useMemo(() => {
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return team.filter(t => t.status !== 'maternity' && (t.target || 0) > 0).map(t => {
      const agentSales = (crmTrackers || []).filter(tr => matchesAgent(tr.If_Agent_Name, t.name) && new Date(tr.Subscription_Start || tr.Created_Time) >= lastMonthStart && new Date(tr.Subscription_Start || tr.Created_Time) <= lastMonthEnd);
      const agentRevenue = agentSales.reduce((s, tr) => s + (parseFloat(tr.Amount_Paid) || 0), 0);
      return { name: t.name, score: computeScore(agentSales.length, agentRevenue, t).score, revenue: agentRevenue };
    }).sort((a, b) => b.score - a.score || b.revenue - a.revenue || a.name.localeCompare(b.name));
  }, [crmTrackers]);

  const teamAvg = teamScores.length ? Math.round(teamScores.reduce((s, t) => s + t.score, 0) / teamScores.length) : 0;
  const rank = teamScores.findIndex(t => t.name === agent.name) + 1;
  const totalRanked = teamScores.length;

  const rec = recommendationFor(salesCount, proratedTarget || monthlyTarget, warningsCount, agent.status, score.activityScore);
  const pattern = patternInsight(salesCount, proratedTarget || monthlyTarget, score.activityScore, rangeKey);
  const review = autoReviewFor(agent, salesCount, proratedTarget || monthlyTarget, revenue, score, rec, rangeLabel);

  const lastSale = allAgentSales[0];
  const lastSaleDate = lastSale ? (lastSale.Subscription_Start || lastSale.Created_Time) : null;
  const daysSinceLastSale = lastSaleDate ? Math.floor((new Date() - new Date(lastSaleDate)) / 86400000) : null;

  const contractEnd = agent.contractEnd;
  const now = new Date();
  const daysToEndContract = contractEnd ? Math.ceil((new Date(contractEnd) - now) / 86400000) : null;
  const isOnLeave = agent.status === 'maternity' || agent.onLeave;

  const statusBadge = isOnLeave
    ? { text: 'On Leave', color: 'bg-amber-100 text-amber-700' }
    : agent.status === 'active' || agent.status === 'probation'
      ? { text: 'Active', color: 'bg-emerald-100 text-emerald-700' }
      : agent.status === 'training'
        ? { text: 'In Training', color: 'bg-blue-100 text-blue-700' }
        : { text: agent.status || 'Inactive', color: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]' };

  const scoreColor = (s) => s >= 80 ? 'text-emerald-600' : s >= 60 ? 'text-blue-600' : s >= 40 ? 'text-amber-600' : 'text-red-600';

  async function addFeedback() {
    const text = newNote.trim();
    if (!text) return;
    try {
      const res = await authFetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, text: `[${noteCategory}] ${text}` }),
      }).then(r => r.json());
      if (res.note) setFeedback(prev => [res.note, ...prev]);
      setNewNote('');
    } catch(e) {}
  }
  async function removeFeedback(id) {
    try {
      await authFetch(`/api/feedback/${id}`, { method: 'DELETE' });
      setFeedback(prev => prev.filter(n => n.id !== id));
    } catch(e) {}
  }
  async function saveDecision() {
    if (!pickedDecision) return;
    try {
      const res = await authFetch('/api/decisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, decision: pickedDecision, reason: decisionReason }),
      }).then(r => r.json());
      if (res.decision) {
        // Push previous current to history, set new current
        if (decision) setDecisionHistory(prev => [decision, ...prev]);
        setDecision(res.decision);
        setDecisionSaved(true);
        setTimeout(() => setDecisionSaved(false), 2000);
      }
    } catch(e) {}
  }

  async function issueWarning() {
    if (!newWarning.reason.trim()) return;
    setSavingWarning(true);
    try {
      const res = await authFetch('/api/warnings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.name, type: newWarning.type, reason: newWarning.reason, date: newWarning.date }),
      }).then(r => r.json());
      if (res.warning) {
        setWarnings(prev => [res.warning, ...prev]);
        setNewWarning({ type: 'verbal', reason: '', date: new Date().toISOString().slice(0, 10) });
        setWarningOpen(false);
      }
    } catch(e) {}
    setSavingWarning(false);
  }

  async function deleteWarning(id) {
    if (!confirm('Delete this warning?')) return;
    try {
      const res = await authFetch(`/api/warnings/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.success) setWarnings(prev => prev.filter(w => w.id !== id));
    } catch(e) {}
  }

  const maxTrendSales = Math.max(1, ...last4Months.map(m => m.sales));

  return (
    <div>
      <button onClick={() => navigate('/sales')} className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6">
        <ArrowLeft size={14} /> Back to Sales
      </button>

      {/* BLOCK 1 — Identity + Score with comparison */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-6">
          <div className="flex items-start gap-5 min-w-0">
            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xl font-semibold shrink-0">
              {agent.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-semibold text-[var(--color-ink)]">{agent.name}</h1>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${statusBadge.color}`}>{statusBadge.text}</span>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-fill)] text-[var(--color-ink-soft)]">{agent.type || 'Sales'}</span>
              </div>
              <p className="text-[var(--color-ink-soft)]">{agent.role}</p>
            </div>
          </div>

          <div className="flex items-stretch gap-6">
            <div className="text-right">
              <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold">Score</p>
              <p className={`text-5xl font-bold mt-1 ${scoreColor(score.score)}`}>
                {score.score}<span className="text-2xl text-[var(--color-ink-faint)] font-normal">/100</span>
              </p>
              <p className={`text-xs mt-1 font-medium ${scoreColor(score.score)}`}>{score.rating}</p>
            </div>
            <div className="border-l border-[var(--color-line)] pl-6 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-6">
                <span className="text-[var(--color-ink-soft)]">Team avg</span>
                <span className="text-[var(--color-ink)] font-semibold">{teamAvg}</span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-[var(--color-ink-soft)]">Rank</span>
                <span className="flex items-center gap-2">
                  {rank > 0 ? (
                    <>
                      <span className="text-[var(--color-ink)] font-semibold">{rank} / {totalRanked}</span>
                      {(() => {
                        // Position is always directional. Color reflects absolute score severity.
                        const pillColor = score.score >= 80 ? 'bg-emerald-100 text-emerald-700'
                          : score.score >= 60 ? 'bg-blue-100 text-blue-700'
                          : score.score >= 40 ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700';
                        let label;
                        if (totalRanked === 1) label = 'Only member';
                        else if (rank === 1) label = 'Top of team';
                        else if (rank === totalRanked) label = 'Bottom of team';
                        else if (rank <= 3) label = `Top ${rank}`;
                        else if (rank >= totalRanked - 2) label = `Bottom ${totalRanked - rank + 1}`;
                        else if (rank <= Math.ceil(totalRanked / 2)) label = 'Upper half';
                        else label = 'Lower half';
                        return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${pillColor}`}>{label}</span>;
                      })()}
                    </>
                  ) : <span className="text-[var(--color-ink-faint)]">—</span>}
                </span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-[var(--color-ink-soft)]">Last month</span>
                <span className="text-[var(--color-ink)] font-semibold flex items-center gap-1">
                  {lastMonthScore.score}
                  {scoreDelta !== 0 && rangeKey === 'this_month' && (
                    scoreDelta > 0
                      ? <span className="text-emerald-600 text-[11px] flex items-center"><TrendingUp size={11} /> +{scoreDelta}</span>
                      : <span className="text-red-600 text-[11px] flex items-center"><TrendingDown size={11} /> {scoreDelta}</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Slim HR info row */}
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--color-ink-soft)] mt-5 pt-5 border-t border-[var(--color-line-soft)]">
          <span>Started <span className="text-[var(--color-ink-soft)] font-medium">{(() => {
            const j = agent.joined;
            if (!j) return '—';
            // Try parsing ISO date first
            const d = new Date(j);
            if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(j)) {
              return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            }
            return j;
          })()}</span></span>
          <span className="text-[var(--color-ink-faint)]">·</span>
          <span>{agent.contract || 'No contract'}</span>
          <span className="text-[var(--color-ink-faint)]">·</span>
          <span>
            Ends <span className={`font-medium ${daysToEndContract !== null && daysToEndContract <= 30 ? 'text-red-600' : daysToEndContract !== null && daysToEndContract <= 90 ? 'text-amber-600' : 'text-[var(--color-ink-soft)]'}`}>
              {contractEnd ? formatDate(contractEnd) : '—'}
            </span>
            {daysToEndContract !== null && daysToEndContract > 0 && <span className="text-[var(--color-ink-faint)] ml-1">({daysToEndContract}d)</span>}
            {daysToEndContract !== null && daysToEndContract <= 0 && <span className="text-red-500 ml-1">(expired)</span>}
          </span>
          <span className="text-[var(--color-ink-faint)]">·</span>
          <span>Warnings: <span className={`font-medium ${warningsCount > 0 ? 'text-red-600' : 'text-[var(--color-ink-soft)]'}`}>{warningsCount}</span></span>
        </div>
      </div>

      {/* BLOCK 3 — Performance summary + period selector (HERO) */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-[var(--color-ink-faint)]" />
            <h2 className="text-[var(--color-ink)] font-semibold">Performance Summary</h2>
            {loadingCrm && <span className="text-[11px] text-[var(--color-ink-faint)] ml-2">Loading CRM…</span>}
          </div>
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
        <p className="text-[11px] text-[var(--color-ink-faint)] mb-4">
          {rangeStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' — '}
          {rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-5">
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Sales</p>
            <p className="text-[27px] font-semibold text-[var(--color-ink)]">{salesCount}</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">{proratedTarget !== null ? `of ${proratedTarget} target` : 'all-time'}</p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Revenue</p>
            <p className="text-[27px] font-semibold text-[var(--color-ink)]">D{(revenue / 1000).toFixed(1)}k</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">D{revenue.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">% to target</p>
            <p className={`text-[27px] font-semibold ${perf >= 80 ? 'text-emerald-600' : perf >= 50 ? 'text-amber-600' : perf > 0 ? 'text-red-600' : 'text-[var(--color-ink-faint)]'}`}>{proratedTarget !== null ? `${perf}%` : '—'}</p>
            {proratedTarget !== null && (
              <div className="w-full h-1.5 bg-[var(--color-fill)] rounded-full overflow-hidden mt-2">
                <div className={`h-full rounded-full ${perf >= 80 ? 'bg-emerald-500' : perf >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, perf)}%` }} />
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-5 border-t border-[var(--color-line-soft)]">
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Last sale</p>
            <p className="text-lg font-semibold text-[var(--color-ink)] leading-tight">{lastSaleDate ? formatDate(lastSaleDate) : 'No recorded sales'}</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">{lastSaleDate ? `${daysSinceLastSale} day${daysSinceLastSale === 1 ? '' : 's'} ago` : (agent.joined ? `since joining (${agent.joined})` : 'ever')}</p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Days silent</p>
            <p className={`text-[27px] font-semibold ${daysSinceLastSale === null ? 'text-red-600' : daysSinceLastSale > 30 ? 'text-red-600' : daysSinceLastSale > 14 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {daysSinceLastSale !== null ? daysSinceLastSale : '∞'}
            </p>
            <p className={`text-xs mt-1 font-medium ${daysSinceLastSale === null ? 'text-red-600' : daysSinceLastSale > 30 ? 'text-red-600' : daysSinceLastSale > 14 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {daysSinceLastSale === null
                ? (rangeKey === 'this_month' ? 'Entire month inactive' : 'No sales ever recorded')
                : daysSinceLastSale > 30 ? 'Cold — needs action'
                : daysSinceLastSale > 14 ? 'Going cold'
                : 'Recently active'}
            </p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Last check-in</p>
            <p className="text-lg font-semibold text-[var(--color-ink)] leading-tight">{formatDate(agent.lastCheckIn)}</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">
              {agent.lastCheckIn ? `${Math.floor((now - new Date(agent.lastCheckIn)) / 86400000)} days ago` : 'never'}
            </p>
          </div>
        </div>

        {periodSales.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[var(--color-line-soft)]">
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-3">Sales in this period</p>
            <div className="space-y-2">
              {periodSales.slice(0, 6).map((t, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-[var(--color-line-soft)] last:border-0">
                  <div>
                    <p className="text-[var(--color-ink)] font-medium">{t.Account_Name?.name || t.User_Name || 'Customer'}</p>
                    <p className="text-[var(--color-ink-faint)] text-[11px]">{t.Number_Plate || '—'} · {formatDate(t.Subscription_Start || t.Created_Time)}</p>
                  </div>
                  <p className="text-[var(--color-ink)] font-semibold">D{(parseFloat(t.Amount_Paid) || 0).toLocaleString()}</p>
                </div>
              ))}
              {periodSales.length > 6 && <p className="text-[11px] text-[var(--color-ink-faint)] pt-2">+{periodSales.length - 6} more</p>}
            </div>
          </div>
        )}
      </div>

      {/* BLOCK 4 — Business Cost */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center gap-2 mb-5">
          <DollarSign size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Business Cost</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-5">
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Monthly cost</p>
            <p className="text-2xl font-semibold text-[var(--color-ink)]">D{cost.toLocaleString()}</p>
            <p className="text-[var(--color-ink-soft)] text-xs mt-1 font-medium">D{Math.round(cost / 30).toLocaleString()}/day</p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Lifetime cost</p>
            <p className="text-2xl font-semibold text-[var(--color-ink)]">{lifetimeCost !== null ? `D${lifetimeCost.toLocaleString()}` : '—'}</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">{lifetimeLabel ? `over ${lifetimeLabel}` : 'no start date'}</p>
          </div>
          <div>
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Revenue</p>
            <p className="text-2xl font-semibold text-[var(--color-ink)]">D{revenue.toLocaleString()}</p>
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">{rangeLabel.toLowerCase()}</p>
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
            <p className="text-[var(--color-ink-faint)] text-xs mt-1">{costPerSale !== null ? 'effective cost' : 'no sales'}</p>
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

      {/* BLOCK 5 — Trend (last 4 months) */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
        <div className="flex items-center gap-2 mb-5">
          <Clock size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Trend — Last 4 Months</h2>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {last4Months.map((m, i) => {
            const isZero = m.sales === 0;
            return (
              <div key={i} className={`p-4 rounded-lg ${m.isCurrent ? 'bg-blue-50 border-2 border-blue-300' : isZero ? 'bg-[var(--color-fill)] border border-[var(--color-line)]' : 'bg-[var(--color-fill)] border border-[var(--color-line-soft)]'}`}>
                <p className={`text-[11px] uppercase tracking-wider font-semibold mb-1 ${m.isCurrent ? 'text-blue-600' : isZero ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-soft)]'}`}>
                  {m.label}{m.isCurrent ? ' · now' : ''}
                </p>
                <p className={`text-2xl font-semibold ${isZero ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>
                  {isZero ? '—' : m.sales}
                </p>
                <div className={`w-full h-1.5 rounded-full overflow-hidden mt-2 ${m.isCurrent ? 'bg-white' : 'bg-white'}`}>
                  <div className={`h-full rounded-full ${m.isCurrent ? 'bg-blue-500' : isZero ? 'bg-[var(--color-ink-faint)]' : 'bg-[var(--color-ink-faint)]'}`} style={{ width: `${Math.max(isZero ? 0 : 4, (m.sales / maxTrendSales) * 100)}%` }} />
                </div>
                <p className={`text-xs mt-2 ${isZero ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-soft)]'}`}>
                  {isZero ? 'no activity' : `D${(m.revenue / 1000).toFixed(1)}k`}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* BLOCK 6 — Scorecard breakdown (transparent math) */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-7 mb-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-[var(--color-ink-faint)]" />
            <h2 className="text-[var(--color-ink)] font-semibold">Scorecard Breakdown</h2>
          </div>
          <p className={`text-2xl font-bold ${scoreColor(score.score)}`}>{score.score}<span className="text-[var(--color-ink-faint)] text-base font-normal">/100</span></p>
        </div>

        <div className="space-y-3">
          <ScoreBar label="Sales achievement" weight="40%" value={score.salesScore} max={40} detail={`${salesCount} of ${proratedTarget || monthlyTarget || '?'} target — ${salesNarrative(salesCount, proratedTarget || monthlyTarget)}`} />
          <ScoreBar label="Check-ins completed" weight="20%" value={score.activityScore} max={20} detail={`${agent.lastCheckIn ? `Last: ${formatDate(agent.lastCheckIn)}` : 'No check-ins on record'} — ${checkinNarrative(score.activityScore, salesCount)}`} />
          <ScoreBar label="Revenue contribution" weight="30%" value={score.revScore} max={30} detail={`D${revenue.toLocaleString()} / D30k benchmark — ${revenueNarrative(revenue, cost)}`} />
          <ScoreBar label="Warnings penalty" weight="−10% each" value={-score.warningPenalty} max={30} neg detail={warningNarrative(warningsCount)} />
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--color-line-soft)]">
          <p className="text-[var(--color-ink-soft)] text-sm">Total</p>
          <p className={`text-xl font-bold ${scoreColor(score.score)}`}>{score.score}/100 · <span className="text-sm font-medium">{score.rating}</span></p>
        </div>
      </div>

      {/* BLOCK 7 — Role expectations (read-only — configure in HR → KPI Settings) */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] mb-6 overflow-hidden">
        <div className="flex items-center justify-between p-5 flex-wrap gap-3">
          <button onClick={() => setRoleOpen(!roleOpen)} className="flex items-center gap-2 text-left">
            <Briefcase size={16} className="text-[var(--color-ink-faint)]" />
            <p className="text-sm font-medium text-[var(--color-ink-soft)]">KPI · Role expectations</p>
            <span className="text-[11px] text-[var(--color-ink-faint)]">{periodLabelForKpi}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-fill)] text-[var(--color-ink-soft)]">{sourceLabel}</span>
            {roleOpen ? <ChevronUp size={14} className="text-[var(--color-ink-faint)] ml-1" /> : <ChevronDown size={14} className="text-[var(--color-ink-faint)] ml-1" />}
          </button>
          <RouterLink to="/dept/hr?tab=kpi" className="flex items-center gap-1.5 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] px-3 py-1.5 rounded-full hover:bg-[var(--color-fill)]">
            <Settings size={12} /> Configure in HR
          </RouterLink>
        </div>

        {roleOpen && (
          <div className="px-5 pb-5 space-y-3 text-sm">
            <div>
              <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Core responsibility</p>
              <p className="text-[var(--color-ink-soft)]">{effectiveResp || <span className="text-[var(--color-ink-faint)] italic">Not set</span>}</p>
            </div>
            <div>
              <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">KPI for {periodLabelForKpi}</p>
              <p className="text-[var(--color-ink-soft)]">{effectiveKpi || <span className="text-[var(--color-ink-faint)] italic">Not set — configure in HR → KPI Settings</span>}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Monthly target</p>
                <p className="text-[var(--color-ink-soft)] font-medium">{effectiveTarget ?? <span className="text-[var(--color-ink-faint)] italic font-normal">Not set</span>}</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Weekly target</p>
                <p className="text-[var(--color-ink-soft)] font-medium">{effectiveWeekly || <span className="text-[var(--color-ink-faint)] italic font-normal">Not set</span>}</p>
              </div>
              <div>
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Team target</p>
                <p className="text-[var(--color-ink-soft)] font-medium">{effectiveTeamTarget ?? <span className="text-[var(--color-ink-faint)] italic font-normal">Not set</span>}</p>
              </div>
            </div>
            {effectiveFocus && (
              <div className="pt-2">
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-1">Focus</p>
                <p className="text-[var(--color-ink-soft)]">{effectiveFocus}</p>
              </div>
            )}

            {/* Rules chain — most specific to most general */}
            {ruleSources.length > 0 && (
              <div className="pt-3 border-t border-[var(--color-line-soft)]">
                <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-2">Resolution chain</p>
                <div className="space-y-1">
                  {[...ruleSources].reverse().map((s, i) => {
                    const label = /^\d{4}-\d{2}$/.test(s.period) ? new Date(s.period + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : s.period;
                    return (
                      <div key={s.id || i} className="flex items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${i === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
                          {i === 0 ? 'USING' : 'BEHIND'}
                        </span>
                        <span className="text-[var(--color-ink-soft)]">{s.scope === 'agent' ? `Agent: ${s.agent}` : `Role: ${s.role}`}</span>
                        <span className="text-[var(--color-ink-faint)]">· {label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BLOCK 8 — Structured notes */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-7 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <MessageSquare size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Coaching Notes</h2>
          <span className="text-[var(--color-ink-faint)] text-xs ml-auto">{feedback.length} entries</span>
        </div>

        <div className="flex gap-2 flex-wrap mb-3">
          {NOTE_CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setNoteCategory(c.value)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${noteCategory === c.value ? (c.color === 'blue' ? 'bg-blue-600 text-white' : c.color === 'red' ? 'bg-red-600 text-white' : 'bg-amber-600 text-white') : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-5">
          <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFeedback()}
            placeholder={noteCategory === 'followup' ? `e.g. Review pipeline ${formatDate(new Date(Date.now() + 7*86400000).toISOString())}` : `${NOTE_CATEGORIES.find(c => c.value === noteCategory)?.label} about ${agent.name.split(' ')[0]}…`}
            className="flex-1 px-4 py-2.5 border border-[var(--color-line)] rounded-full text-sm focus:outline-none focus:border-[var(--color-ink-faint)]" />
          <button onClick={addFeedback} className="px-5 py-2.5 bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white text-sm font-medium rounded-full">Add</button>
        </div>

        {feedback.length === 0 ? (
          <p className="text-[var(--color-ink-faint)] text-sm">No notes yet. Every note rolls into the monthly review below.</p>
        ) : (
          <div className="space-y-3">
            {feedback.map(n => {
              const parsed = parseNote(n);
              const catDef = NOTE_CATEGORIES.find(c => c.value === parsed.category);
              return (
                <div key={n.id} className="flex items-start gap-3 p-4 bg-[var(--color-fill)] rounded-lg group">
                  {catDef && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 ${catDef.color === 'blue' ? 'bg-blue-100 text-blue-700' : catDef.color === 'red' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {catDef.label.split(' ')[0]}
                    </span>
                  )}
                  <div className="flex-1">
                    <p className="text-[var(--color-ink-soft)] text-sm">{parsed.text}</p>
                    <p className="text-[var(--color-ink-faint)] text-[11px] mt-1">{new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {n.createdBy || 'Damia'}</p>
                  </div>
                  <button onClick={() => removeFeedback(n.id)} className="text-[var(--color-ink-faint)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BLOCK 9 — Auto review */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-7 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Auto-generated Review</h2>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-[var(--color-ink-soft)] leading-relaxed font-sans">{review}</pre>
      </div>

      {/* BLOCK 9b — Files & documents */}
      <AgentFiles
        agentName={agent.name}
        agentEmail={agent.email}
        generateReviewFn={() => ({
          period: rangeLabel,
          text: `# Performance Review — ${agent.name}\n## Period: ${rangeLabel}\n## Role: ${agent.role}\n## Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n---\n\n${review}\n\n---\n\n## Scorecard Detail\n- Sales achievement: ${score.salesScore}/40 — ${salesCount} of ${proratedTarget || monthlyTarget || '?'} target\n- Check-ins completed: ${score.activityScore}/20 — ${agent.lastCheckIn ? 'Last: ' + formatDate(agent.lastCheckIn) : 'No check-ins'}\n- Revenue contribution: ${score.revScore}/30 — D${revenue.toLocaleString()} of D30k benchmark\n- Warnings penalty: -${score.warningPenalty}/30 — ${agent.warnings || 0} active\n- **Total: ${score.score}/100 — ${score.rating}**\n\n## Cost vs Revenue\n- Monthly cost: D${cost.toLocaleString()}\n- Revenue this period: D${revenue.toLocaleString()}\n- Net: ${profit >= 0 ? '+' : '-'}D${Math.abs(profit).toLocaleString()}\n- ROI: ${cost > 0 ? roi + '%' : '—'}\n\n${decision ? `## Current Management Decision\n${DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}${decision.reason ? ' — ' + decision.reason : ''}\n_Set ${formatDate(decision.setAt)}_\n` : ''}\n${feedback.length > 0 ? `\n## Recent Notes\n${feedback.slice(0, 5).map(n => `- ${parseNote(n).text} _(${formatDate(n.createdAt)})_`).join('\n')}\n` : ''}`,
        })}
        defaultCategory="general"
      />

      {/* BLOCK 10 — Management Decision */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-7 mb-8">
        <div className="flex items-center gap-2 mb-5">
          <Shield size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Management Decision</h2>
          {decision && (
            <span className="text-[11px] text-[var(--color-ink-faint)] ml-auto">
              Last set: {new Date(decision.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>

        {/* Current status — prominent */}
        {decision ? (
          <div className="mb-4 p-4 rounded-lg bg-[var(--color-ink)] text-white flex items-center gap-3">
            <CheckCircle size={18} className="text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-white/60 mb-0.5">Current status</p>
              <p className="text-sm font-medium">
                {DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}
                <span className="text-white/60 font-normal"> · set {new Date(decision.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </p>
              {decision.reason && <p className="text-[11px] text-white/70 mt-0.5 truncate">{decision.reason}</p>}
            </div>
          </div>
        ) : (
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-100 flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">No decision on record</p>
              <p className="text-sm text-amber-900 font-medium">Pick one below — this is how you track accountability.</p>
            </div>
          </div>
        )}

        <p className="text-sm text-[var(--color-ink-soft)] mb-4">What are you doing with {agent.name.split(' ')[0]}?{pickedDecision && (!decision || pickedDecision !== decision.decision) && <span className="text-[var(--color-ink)] font-medium"> · Ready to save: {DECISIONS.find(d => d.value === pickedDecision)?.label}</span>}</p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
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
                className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 text-xs font-medium transition-colors ${colorMap[d.color]}`}>
                <Icon size={14} />
                <span className="truncate">{d.label}</span>
              </button>
            );
          })}
        </div>

        <textarea value={decisionReason} onChange={e => setDecisionReason(e.target.value)}
          placeholder="Reason, next step, or context (optional)…"
          className="w-full px-4 py-3 border border-[var(--color-line)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-ink-faint)] resize-none" rows={2} />

        <div className="flex items-center justify-end mt-4">
          <button onClick={saveDecision} disabled={!pickedDecision}
            className={`px-6 py-2.5 rounded-full text-sm font-medium transition-colors ${decisionSaved ? 'bg-emerald-600 text-white' : pickedDecision ? 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-faint)] cursor-not-allowed'}`}>
            {decisionSaved ? 'Saved ✓' : 'Save decision'}
          </button>
        </div>

        {/* Decision history */}
        {(decision || decisionHistory.length > 0) && (
          <div className="mt-6 pt-5 border-t border-[var(--color-line-soft)]">
            <p className="text-[var(--color-ink-faint)] text-[11px] uppercase tracking-wider font-semibold mb-3">Decision history</p>
            <div className="space-y-2">
              {decision && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-ink)] text-white">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/20 uppercase tracking-wider shrink-0 mt-0.5">Current</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{DECISIONS.find(d => d.value === decision.decision)?.label || decision.decision}</p>
                    {decision.reason && <p className="text-[11px] text-white/70 mt-0.5">{decision.reason}</p>}
                  </div>
                  <p className="text-[11px] text-white/60 shrink-0">{new Date(decision.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                </div>
              )}
              {decisionHistory.map((h, i) => (
                <div key={h.id || i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-fill)]">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--color-line)] text-[var(--color-ink-soft)] uppercase tracking-wider shrink-0 mt-0.5">Prev</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-ink-soft)]">{DECISIONS.find(d => d.value === h.decision)?.label || h.decision}</p>
                    {h.reason && <p className="text-[11px] text-[var(--color-ink-soft)] mt-0.5">{h.reason}</p>}
                  </div>
                  <p className="text-[11px] text-[var(--color-ink-faint)] shrink-0">{new Date(h.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
              ))}
            </div>
            {decisionHistory.length >= 2 && (
              <p className="text-[11px] text-[var(--color-ink-faint)] mt-3 italic">
                {decisionHistory.filter(h => h.decision === decision?.decision).length >= 1
                  ? `Pattern: ${DECISIONS.find(d => d.value === decision?.decision)?.label || ''} repeated — is the intervention working?`
                  : 'Interventions tried — review what changed and what didn\'t.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* BLOCK 10b — Warnings (moved here from top per Adama's preference) */}
      <div className={`rounded-lg border p-6 mb-4 ${warningsCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-[var(--color-line-soft)]'}`}>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Gavel size={18} className={warningsCount > 0 ? 'text-red-600' : 'text-[var(--color-ink-faint)]'} />
            <h2 className={`font-semibold ${warningsCount > 0 ? 'text-red-900' : 'text-[var(--color-ink)]'}`}>
              {warningsCount > 0 ? `${warningsCount} active warning${warningsCount === 1 ? '' : 's'}` : 'No warnings on file'}
            </h2>
          </div>
          <button onClick={() => setWarningOpen(o => !o)}
            className={`px-4 py-2 rounded-full text-xs font-medium transition-colors ${warningOpen ? 'bg-[var(--color-line)] text-[var(--color-ink-soft)]' : 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]'}`}>
            {warningOpen ? 'Cancel' : '+ Issue warning'}
          </button>
        </div>

        {warningOpen && (
          <div className="bg-white rounded-lg border border-[var(--color-line)] p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[var(--color-ink-soft)] text-[11px] uppercase tracking-wider font-semibold mb-1 block">Type</label>
                <select value={newWarning.type} onChange={e => setNewWarning(w => ({ ...w, type: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-line)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-ink-faint)]">
                  <option value="verbal">Verbal</option>
                  <option value="formal">Formal</option>
                  <option value="final">Final</option>
                </select>
              </div>
              <div>
                <label className="text-[var(--color-ink-soft)] text-[11px] uppercase tracking-wider font-semibold mb-1 block">Date</label>
                <input type="date" value={newWarning.date} onChange={e => setNewWarning(w => ({ ...w, date: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-line)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-ink-faint)]" />
              </div>
            </div>
            <div>
              <label className="text-[var(--color-ink-soft)] text-[11px] uppercase tracking-wider font-semibold mb-1 block">Reason</label>
              <textarea value={newWarning.reason} onChange={e => setNewWarning(w => ({ ...w, reason: e.target.value }))}
                placeholder="What did they do? Be specific."
                className="w-full px-3 py-2 border border-[var(--color-line)] rounded-lg text-sm focus:outline-none focus:border-[var(--color-ink-faint)] resize-none" rows={2} />
            </div>
            <div className="flex justify-end">
              <button onClick={issueWarning} disabled={savingWarning || !newWarning.reason.trim()}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-full disabled:bg-[var(--color-ink-faint)] disabled:cursor-not-allowed">
                {savingWarning ? 'Saving…' : 'Issue warning'}
              </button>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map(w => {
              const typeColor = w.type === 'final' ? 'bg-red-200 text-red-900' : w.type === 'formal' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
              return (
                <div key={w.id} className="bg-white rounded-lg border border-[var(--color-line)] p-4 flex items-start gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 ${typeColor}`}>{w.type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-ink)]">{w.reason}</p>
                    <p className="text-[11px] text-[var(--color-ink-soft)] mt-1">{new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · issued by {w.issuedBy}</p>
                  </div>
                  <button onClick={() => deleteWarning(w.id)} className="text-[var(--color-ink-faint)] hover:text-red-600 p-1" title="Remove warning">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BLOCK 11 — Staff history (from team.js) */}
      {agent.history && agent.history.length > 0 && (
        <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-6 mb-4">
          <h2 className="text-[var(--color-ink)] font-semibold mb-4">History</h2>
          <div>
            {[...agent.history].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((h, i, arr) => (
              <div key={i} className="flex gap-4 pb-4 last:pb-0">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === 0 ? 'bg-blue-600' : 'bg-[var(--color-ink-faint)]'}`} />
                  {i < arr.length - 1 && <div className="w-px flex-1 bg-[var(--color-line)] mt-1" />}
                </div>
                <div className="flex-1 pb-1">
                  <p className="text-xs text-[var(--color-ink-faint)] font-medium">
                    {h.dateApproximate ? '~ ' : ''}
                    {h.date ? new Date(h.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                  <p className="text-sm text-[var(--color-ink)] mt-0.5">{h.event}</p>
                  {h.note && <p className="text-xs text-[var(--color-ink-faint)] mt-1">{h.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, weight, value, max, detail, neg }) {
  const pct = max > 0 ? Math.abs(value) / max * 100 : 0;
  const isPositive = !neg && value > 0;
  const isNegative = neg || value < 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-baseline gap-2">
          <p className="text-sm text-[var(--color-ink-soft)] font-medium">{label}</p>
          {weight && <span className="text-[10px] text-[var(--color-ink-faint)] uppercase tracking-wider font-semibold">{weight}</span>}
        </div>
        <p className={`text-sm font-semibold ${isNegative ? 'text-red-600' : isPositive ? 'text-emerald-600' : 'text-[var(--color-ink-faint)]'}`}>
          {value >= 0 ? '+' : ''}{value}<span className="text-[var(--color-ink-faint)] font-normal">/{neg ? `-${max}` : max}</span>
        </p>
      </div>
      <div className="w-full h-2 bg-[var(--color-fill)] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${isNegative ? 'bg-red-500' : isPositive ? 'bg-emerald-500' : 'bg-[var(--color-ink-faint)]'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {detail && <p className="text-[11px] text-[var(--color-ink-faint)] mt-1">{detail}</p>}
    </div>
  );
}
