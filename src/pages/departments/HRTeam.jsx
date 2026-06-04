import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, AlertTriangle, Target, Shield, TrendingUp,
  Plus, Edit2, Trash2, Settings, ChevronDown, UserX,
} from 'lucide-react';
import { team, pastStaff, payrollHistory } from '../../data/team';
import TimePeriodSelector from '../../components/TimePeriodSelector';
import { api } from '../../lib/api.js';

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

function periodRange(mode, custom, ref = new Date()) {
  const r = new Date(ref);
  if (mode === 'this_month') {
    const start = new Date(r.getFullYear(), r.getMonth(), 1);
    const end = new Date(r.getFullYear(), r.getMonth() + 1, 0, 23, 59, 59);
    return { start, end, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (mode === 'last_month') {
    const start = new Date(r.getFullYear(), r.getMonth() - 1, 1);
    const end = new Date(r.getFullYear(), r.getMonth(), 0, 23, 59, 59);
    return { start, end, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  if (mode === 'this_quarter') {
    const q = Math.floor(r.getMonth() / 3);
    const start = new Date(r.getFullYear(), q * 3, 1);
    const end = new Date(r.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
    return { start, end, label: `Q${q + 1} ${r.getFullYear()}` };
  }
  if (mode === 'this_year') {
    const start = new Date(r.getFullYear(), 0, 1);
    const end = new Date(r.getFullYear(), 11, 31, 23, 59, 59);
    return { start, end, label: String(r.getFullYear()) };
  }
  if (mode === 'all_time') {
    return { start: new Date(2000, 0, 1), end: new Date(r.getFullYear() + 10, 11, 31), label: 'All Time' };
  }
  if (mode === 'custom' && custom?.from && custom?.to) {
    const start = new Date(custom.from);
    const end = new Date(custom.to + 'T23:59:59');
    return { start, end, label: `${start.toLocaleDateString('en-GB')} – ${end.toLocaleDateString('en-GB')}` };
  }
  const start = new Date(r.getFullYear(), r.getMonth(), 1);
  const end = new Date(r.getFullYear(), r.getMonth() + 1, 0, 23, 59, 59);
  return { start, end, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

const perfColor = p => p >= 80 ? 'text-emerald-600' : p >= 50 ? 'text-amber-600' : p > 0 ? 'text-red-600' : 'text-gray-400';
const perfBg = p => p >= 80 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : p > 0 ? 'bg-red-500' : 'bg-gray-300';
const perfLabel = p => p >= 80 ? 'On Track' : p >= 50 ? 'Needs Attention' : p > 0 ? 'Underperforming' : 'New';
const statusBadge = s => ({ active: 'bg-emerald-100 text-emerald-700', maternity: 'bg-purple-100 text-purple-700', probation: 'bg-amber-100 text-amber-700', training: 'bg-orange-100 text-orange-700' })[s] || 'bg-gray-100 text-gray-700';
const typeBadge = t => ({ Sales: 'bg-green-100 text-green-700', Operations: 'bg-gray-100 text-gray-700', Marketing: 'bg-pink-100 text-pink-700', Technology: 'bg-blue-100 text-blue-700', Training: 'bg-amber-100 text-amber-700' })[t] || 'bg-gray-100 text-gray-700';
const actionBadge = a => ({ review: 'bg-blue-100 text-blue-700', warning: 'bg-red-100 text-red-700', training: 'bg-orange-100 text-orange-700', promotion: 'bg-green-100 text-green-700', 'let-go': 'bg-red-200 text-red-800', monitor: 'bg-gray-100 text-gray-600', none: 'bg-gray-50 text-gray-400' })[a] || 'bg-gray-100 text-gray-600';

export default function HRTeam() {
  const location = useLocation();
  const navigate = useNavigate();
  const openProfile = (name) => navigate(`/agents/${name.toLowerCase().replace(/\s+/g, '-')}`);
  const initialTab = new URLSearchParams(location.search).get('tab') || 'dashboard';
  const [tab, setTab] = useState(initialTab);
  const [expandedRow] = useState(null);
  const [periodMode, setPeriodMode] = useState('last_month');
  const [customRange, setCustomRange] = useState(null);
  const [allWarnings, setAllWarnings] = useState([]);

  useEffect(() => {
    api('/warnings').then(d => setAllWarnings(d.warnings || [])).catch(() => setAllWarnings([]));
  }, [tab]);

  const warningsByAgent = useMemo(() => {
    const map = {};
    allWarnings.forEach(w => {
      if (!map[w.agent]) map[w.agent] = [];
      map[w.agent].push(w);
    });
    return map;
  }, [allWarnings]);

  const { label: periodLabel } = periodRange(periodMode, customRange);

  // Metrics from the roster (team.js) — Pulse's source of truth.
  const liveMetrics = useMemo(() => {
    const map = {};
    team.forEach(t => { map[t.name] = { sales: t.sales || 0, revenue: t.revenueGenerated || 0 }; });
    return map;
  }, []);

  useEffect(() => {
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
    { id: 'warnings', label: `Warnings${allWarnings.length > 0 ? ` (${allWarnings.length})` : ''}` },
    { id: 'past', label: 'Past Staff' },
  ];

  // KPI Settings state
  const [kpiRules, setKpiRules] = useState([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiFilter, setKpiFilter] = useState({ scope: 'all', period: 'all', role: 'all', agent: 'all' });
  const blankRule = { id: null, scope: 'role', role: '', agent: '', period: 'default', personalTarget: '', teamTarget: '', weeklyTarget: '', kpi: '', coreResponsibility: '', focus: '', active: true };
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
          <h1 className="text-3xl font-semibold text-gray-900">HR &amp; Team</h1>
          <p className="text-gray-500 mt-1">Who is performing, who is costing money, and what to do next</p>
        </div>
        <TimePeriodSelector
          selected={periodMode}
          onChange={(value, custom) => { setPeriodMode(value); if (value === 'custom') setCustomRange(custom); }}
          showExport={false}
        />
      </div>

      {alerts.length > 0 && (
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
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
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-green-50"><TrendingUp size={16} className="text-green-600" /></div><p className="text-gray-500 text-xs">Revenue</p></div>
          {(() => { const live = Object.values(liveMetrics).reduce((s, m) => s + m.revenue, 0); return <h3 className="text-2xl font-bold text-emerald-600">D{live.toLocaleString()}</h3>; })()}
          <p className="text-[10px] text-gray-500 mt-1">Roster total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-amber-50"><Target size={16} className="text-amber-600" /></div><p className="text-gray-500 text-xs">Avg Performance</p></div>
          {(() => {
            const sales = workingTeam.filter(t => t.target > 0);
            if (!sales.length) return <h3 className="text-2xl font-bold text-gray-400">—</h3>;
            const perfs = sales.map(t => Math.min(200, Math.round(((liveMetrics[t.name]?.sales || 0) / t.target) * 100)));
            const avg = Math.round(perfs.reduce((s, p) => s + p, 0) / perfs.length);
            return <h3 className={`text-2xl font-bold ${perfColor(avg)}`}>{avg}%</h3>;
          })()}
          <p className="text-[10px] text-gray-500 mt-1">vs target</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2"><div className="p-1.5 rounded-lg bg-red-50"><Shield size={16} className="text-red-600" /></div><p className="text-gray-500 text-xs">Expiring</p></div>
          <h3 className="text-2xl font-bold text-red-600">{contractDeadlines.filter(c => c.daysLeft <= 90).length}</h3>
          <p className="text-[10px] text-gray-500 mt-1">Within 90 days</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Cost vs Value</h3>
            <p className="text-sm text-gray-500 mb-4">From the roster · {periodLabel}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {team.filter(t => t.status !== 'maternity' && (t.type === 'Sales' || (liveMetrics[t.name]?.revenue || 0) > 0)).map((t, i) => {
                const revenue = liveMetrics[t.name]?.revenue || 0;
                const sales = liveMetrics[t.name]?.sales || 0;
                const profit = revenue - t.base;
                return (
                  <div key={i} onClick={() => openProfile(t.name)} className={`p-4 rounded-lg border cursor-pointer ${profit > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 text-sm">{t.name}</span>
                      <span className={`text-sm font-bold ${profit > 0 ? 'text-green-700' : 'text-red-700'}`}>{profit > 0 ? '+' : ''}D{profit.toLocaleString()}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-600"><span>Cost: D{t.base.toLocaleString()}</span><span>Revenue: D{revenue.toLocaleString()}</span><span>{sales} sale{sales === 1 ? '' : 's'}</span></div>
                  </div>
                );
              })}
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
              const rev = t.revenueGenerated || 0;
              const cost = t.base || 0;
              const profit = rev - cost;
              const showROI = t.type === 'Sales' || rev > 0;
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

                  {showROI && (
                    <div className="mt-4 grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-0.5">Revenue</p>
                        <p className="text-sm font-semibold text-gray-900">D{rev.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-0.5">Net</p>
                        <p className={`text-sm font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {profit >= 0 ? '+' : '−'}D{Math.abs(profit).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )}

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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Personal target (# sales/month)</label>
                    <input type="number" value={kpiForm.personalTarget} onChange={e => setKpiForm({ ...kpiForm, personalTarget: e.target.value })}
                      placeholder="5"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Team target (# sales/month)</label>
                    <input type="number" value={kpiForm.teamTarget} onChange={e => setKpiForm({ ...kpiForm, teamTarget: e.target.value })}
                      placeholder="15 (optional)"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Weekly target (text)</label>
                    <input type="text" value={kpiForm.weeklyTarget} onChange={e => setKpiForm({ ...kpiForm, weeklyTarget: e.target.value })}
                      placeholder="4 sales/week"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                </div>

                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Monthly KPI (human-readable)</label>
                  <input type="text" value={kpiForm.kpi} onChange={e => setKpiForm({ ...kpiForm, kpi: e.target.value })}
                    placeholder="e.g. Close 5 trackers per month"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-gray-500 text-[11px] uppercase tracking-wider font-semibold mb-1 block">Core responsibility</label>
                  <input type="text" value={kpiForm.coreResponsibility} onChange={e => setKpiForm({ ...kpiForm, coreResponsibility: e.target.value })}
                    placeholder="e.g. Lead sales team and drive revenue"
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
                          <td className="py-3 px-4 text-center text-gray-900">{r.personalTarget ?? '—'}</td>
                          <td className="py-3 px-4 text-center text-gray-900">{r.teamTarget ?? '—'}</td>
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-gray-200">
                <th className="text-left px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Name</th>
                <th className="text-left px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Role</th>
                <th className="text-left px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Type</th>
                <th className="text-left px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Status</th>
                <th className="text-right px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Base (D)</th>
                <th className="text-left px-6 py-4 text-xs uppercase tracking-wider text-gray-500 font-semibold">Ends</th>
              </tr></thead>
              <tbody>
                {team.map((p, i) => (
                  <tr key={i} onClick={() => openProfile(p.name)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-700">{p.name.charAt(0)}</div><div><p className="text-sm font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-500">Since {p.joined}</p></div></div></td>
                    <td className="px-6 py-4 text-sm text-gray-900">{p.role}</td>
                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${typeBadge(p.type)}`}>{p.type}</span></td>
                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${statusBadge(p.status)}`}>{p.status}</span></td>
                    <td className="px-6 py-4 text-sm text-gray-900 text-right font-medium">D{p.base.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{p.contractEnd ? new Date(p.contractEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {expandedRow !== null && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-[10px] uppercase text-gray-400 mb-1">Core Responsibility</p><p className="text-gray-900">{team[expandedRow].coreResponsibility}</p></div>
                <div><p className="text-[10px] uppercase text-gray-400 mb-1">KPI</p><p className="text-gray-900">{team[expandedRow].kpi}</p></div>
                <div><p className="text-[10px] uppercase text-gray-400 mb-1">Next Action</p><span className={`px-2 py-0.5 rounded text-xs font-medium ${actionBadge(team[expandedRow].nextAction)}`}>{team[expandedRow].nextAction}</span><p className="text-xs text-gray-500 mt-1">{team[expandedRow].nextActionNote}</p></div>
                <div><p className="text-[10px] uppercase text-gray-400 mb-1">Notes</p><p className="text-gray-900 text-xs">{team[expandedRow].notes}</p></div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'payroll' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Payroll</h3>
            <table className="w-full"><thead><tr className="border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs uppercase text-gray-500">Name</th><th className="text-left px-4 py-3 text-xs uppercase text-gray-500">Role</th>
              <th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Base</th><th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Commission</th>
              <th className="text-right px-4 py-3 text-xs uppercase text-gray-500">Total</th>
            </tr></thead><tbody>
              {team.map((p, i) => <tr key={i} className="border-b border-gray-100"><td className="px-4 py-3 text-sm font-medium text-gray-900">{p.name}</td><td className="px-4 py-3 text-sm text-gray-600">{p.role}</td><td className="px-4 py-3 text-sm text-right">D{p.base.toLocaleString()}</td><td className="px-4 py-3 text-sm text-right">{p.commission > 0 ? <span className="text-green-600">Up to D{p.commission.toLocaleString()}</span> : '—'}</td><td className="px-4 py-3 text-sm font-bold text-right">D{p.total.toLocaleString()}</td></tr>)}
            </tbody><tfoot><tr className="border-t-2 border-gray-300"><td colSpan={4} className="px-4 py-3 font-bold">Total</td><td className="px-4 py-3 text-lg font-bold text-right">D{totalPayroll.toLocaleString()}</td></tr></tfoot></table>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Payroll History</h3>
            <div className="space-y-3">{payrollHistory.map((m, i) => <div key={i} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg"><div><p className="text-sm font-medium text-gray-900">{m.month}</p><p className="text-xs text-gray-500 mt-1">{m.breakdown}</p></div><p className="text-lg font-bold">D{m.total.toLocaleString()}</p></div>)}</div>
          </div>
        </div>
      )}

      {tab === 'contracts' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Contract Timeline</h3>
          <p className="text-sm text-gray-500 mb-4">Sorted by urgency</p>
          <div className="space-y-2">
            {contractDeadlines.map((c, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:bg-gray-50">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold ${c.daysLeft <= 21 ? 'bg-red-100 text-red-700' : c.daysLeft <= 60 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{c.daysLeft}d</div>
                <div className="flex-1"><p className="text-sm font-medium text-gray-900">{c.name}</p><p className="text-xs text-gray-500">{c.role} — {c.contract}</p></div>
                <div className="text-right"><p className="text-sm font-bold">{new Date(c.contractEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${actionBadge(c.nextAction)}`}>{c.nextAction}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'warnings' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Warnings — all team</h3>
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
      )}

      {tab === 'past' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Past Team Members</h3>
          <div className="space-y-4">
            {pastStaff.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"><UserX size={18} className="text-gray-400" /></div><div><p className="text-sm font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-500">{p.role} — D{p.pay.toLocaleString()}/mo</p></div></div>
                <div className="text-right"><p className="text-sm text-gray-600">{p.reason}</p><p className="text-xs text-gray-400">{p.date} — Final: D{p.finalPay.toLocaleString()}</p></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
