import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, CheckCircle2, Clock, GraduationCap, UserX, Upload, Download, Plus,
  Search, MoreVertical, ChevronLeft, ChevronRight, Filter, AlertTriangle, FileClock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import Pager, { usePager } from '../components/ui/Pager.jsx';
import { PageSkeleton } from '../components/ui/Skeleton.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

// Employees — the roster in the design Adama sent (20 Aug): five tiles, a
// filter row, one row per person, and a footer that says what you are looking
// at. Same system as the HR dashboard, so the two pages read as one product.
//
// 🔒 This page never shows pay, so it is fed by an endpoint that never sends
// it. The salary-carrying roster stays behind the payroll screens.

const CARD = 'card';
const STATUS = {
  active: ['Active', 'var(--color-pill-active-bg)', 'var(--color-pill-active)'],
  probation: ['Probation', 'var(--color-pill-probation-bg)', 'var(--color-pill-probation)'],
  leave: ['On leave', 'var(--color-pill-leave-bg)', 'var(--color-pill-leave)'],
  inactive: ['Inactive', 'var(--color-pill-inactive-bg)', 'var(--color-pill-inactive)'],
};
const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const profileHref = (e) => `/people/${e.username}`;
const day = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const pctOf = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)}% of total` : '—');

function Tile({ icon: Icon, value, label, sub, tint, ink, onClick, on }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { onClick, type: 'button' } : {})}
      className={`${CARD} flex min-h-[122px] w-full items-start gap-4 p-5 text-left transition-colors ${onClick ? 'hover:border-[var(--color-line-control)]' : ''} ${on ? 'border-[var(--color-brand-soft)]' : ''}`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]" style={{ background: tint, color: ink }}>
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[28px] font-semibold leading-none tracking-[-0.4px] text-[var(--color-ink)]">{value}</span>
        <span className="mt-2.5 block text-[13.5px] font-medium text-[var(--color-ink-soft)]">{label}</span>
        <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">{sub}</span>
      </span>
    </Tag>
  );
}

export default function Employees() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [employment, setEmployment] = useState('');
  const [menu, setMenu] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [moreFilters, setMoreFilters] = useState(false);
  const [joinedFrom, setJoinedFrom] = useState('');
  const [joinedTo, setJoinedTo] = useState('');
  const [milestoneOnly, setMilestoneOnly] = useState('');
  const [view, setView] = useState('employees');

  useEffect(() => { api('/hr/employees').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { pager.reset(); }, [query, dept, status, employment, milestoneOnly, view]);

  const rows = useMemo(() => {
    const list = data?.employees || [];
    const q = query.trim().toLowerCase();
    return list.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (status && e.status !== status) return false;
      if (employment && e.employment !== employment) return false;
      if (q && !`${e.name} ${e.email} ${e.phone} ${e.title}`.toLowerCase().includes(q)) return false;
      if (joinedFrom && (!e.startDate || e.startDate < joinedFrom)) return false;
      if (joinedTo && (!e.startDate || e.startDate > joinedTo)) return false;
      if (milestoneOnly === 'due' && !(e.milestone && e.milestone.days <= 30 && e.milestone.label !== 'Annual review')) return false;
      if (milestoneOnly === 'contract' && !(e.milestone?.label === 'Contract ends' && e.milestone.days <= 60)) return false;
      return true;
    });
  }, [data, query, dept, status, employment, joinedFrom, joinedTo, milestoneOnly]);

  const pager = usePager(rows);
  const shown = pager.slice;

  // The tiles are five views of ONE list, so only one is ever on. They used to
  // stack — "HR action due" plus "On leave" left an empty table, and the
  // Employees tile could not undo it because all it did was clear the status
  // (which was already clear), so clicking it did nothing at all (Adama 27 Aug).
  const filtered = !!(status || milestoneOnly || dept || employment || query || joinedFrom || joinedTo);
  // Its number is the whole roster, so clicking it has to produce the whole
  // roster — every filter goes, not just the tile ones.
  const showEveryone = () => {
    setStatus('');
    setMilestoneOnly('');
    setDept('');
    setEmployment('');
    setQuery('');
    setJoinedFrom('');
    setJoinedTo('');
  };
  const pickStatus = (s0) => { setMilestoneOnly(''); setStatus(status === s0 ? '' : s0); };
  const pickMilestone = (m) => { setStatus(''); setMilestoneOnly(milestoneOnly === m ? '' : m); };

  const allShownPicked = shown.length > 0 && shown.every((e) => picked.has(e.username));
  const togglePage = () => setPicked((p) => {
    const n = new Set(p);
    shown.forEach((e) => (allShownPicked ? n.delete(e.username) : n.add(e.username)));
    return n;
  });
  const toggleOne = (u) => setPicked((p) => {
    const n = new Set(p);
    n.has(u) ? n.delete(u) : n.add(u);
    return n;
  });

  function exportCsv(only) {
    const head = ['Name', 'Role', 'Department', 'Status', 'Employment type', 'Start date', 'Email', 'Phone'];
    const list = only ? rows.filter((e) => picked.has(e.username)) : rows;
    const body = list.map((e) => [e.name, e.title, e.department, STATUS[e.status]?.[0] || e.status, e.employment, e.startDate || '', e.email, e.phone]);
    const csv = [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 🔒 Blue is rationed: the primary button, the live tab, the active nav row
  // and a real focus. A resting filter is grey.
  const field = 'field';
  const btn = 'inline-flex items-center gap-2 transition-colors';
  const light = `${btn} btn-secondary hover:bg-[var(--color-soft)]`;

  if (error) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>;
  if (!data) return <PageSkeleton tiles={4} rows={8} />;
  const c = data.counts;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page flex items-center gap-3 text-[var(--color-ink)]">
            Employees
            <span className="rounded-full bg-[var(--color-fill)] px-3 py-1 text-[15px] font-semibold text-[var(--color-ink-soft)]">{c.total}</span>
          </h1>
          <p className="t-support mt-2">Manage employee information, roles and employment status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Importing a roster is Pulse's own job elsewhere — this is the page
              where you add one person, so the other two buttons are the honest
              pair: take the list out, or add somebody. */}
          <button onClick={() => exportCsv(false)} className={light}><Download size={15} /> Export</button>
          <Link to="/people?tab=roster" className={`${btn} btn-primary hover:bg-[var(--color-brand-600)]`}>
            <Plus size={15} /> Add employee
          </Link>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-1 border-b border-[var(--color-line)]">
        {[['employees', 'Current'], ['contracts', 'Contracts'], ['past', `Past employees (${data.past.length})`]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${view === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Past employees is its own list — these five count who is still here,
          so on that tab they would filter nothing and read as broken. */}
      {view !== 'past' && (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Users} value={c.total} label="Employees" sub={`${c.active} active`}
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" on={!filtered} onClick={showEveryone} />
        <Tile icon={GraduationCap} value={c.probation} label="In probation" sub={c.probation ? 'Decision ahead' : 'Nobody on probation'}
          tint="var(--color-stage-screening-bg)" ink="var(--color-stage-screening)" on={status === 'probation'} onClick={() => pickStatus('probation')} />
        <Tile icon={Clock} value={c.leave} label="On leave" sub={c.leave ? 'Away today' : 'Everybody in'}
          tint="var(--color-stage-interview-bg)" ink="var(--color-stage-interview)" on={status === 'leave'} onClick={() => pickStatus('leave')} />
        <Tile icon={FileClock} value={c.contractSoon} label="Contract ending" sub={c.contractSoon ? 'Within 60 days' : 'None inside 60 days'}
          tint="var(--color-stage-offer-bg)" ink="var(--color-stage-offer)" on={milestoneOnly === 'contract'} onClick={() => pickMilestone('contract')} />
        {/* The operational one: what HR has to decide, and who is next. */}
        <Tile icon={AlertTriangle} value={c.actionDue} label="HR action due"
          sub={data.nextAction ? `${data.nextAction.name.split(' ')[0]} · ${data.nextAction.label.toLowerCase()} in ${data.nextAction.days} days` : 'Nothing inside 30 days'}
          tint="var(--color-stage-out-bg)" ink="var(--color-stage-out)" on={milestoneOnly === 'due'} onClick={() => pickMilestone('due')} />
      </div>
      )}

      {view !== 'past' && (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="relative min-w-[260px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or phone…"
            className={`${field} w-full pl-10`} />
        </span>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={field}>
          <option value="">All departments</option>
          {data.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={employment} onChange={(e) => setEmployment(e.target.value)} className={field}>
          <option value="">All employment types</option>
          {data.employmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setMoreFilters((v) => !v)}
          className={`${light} ${joinedFrom || joinedTo ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : ''}`}>
          <Filter size={15} /> Filters{joinedFrom || joinedTo ? ' · 1' : ''}
        </button>
      </div>
      )}

      {moreFilters && (
        <div className={`${CARD} mt-3 flex flex-wrap items-end gap-3 p-3.5`}>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-ink-faint)]">Started on or after</span>
            <input type="date" value={joinedFrom} onChange={(e) => setJoinedFrom(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-ink-faint)]">Started on or before</span>
            <input type="date" value={joinedTo} onChange={(e) => setJoinedTo(e.target.value)} className={field} />
          </label>
          {(joinedFrom || joinedTo) && (
            <button onClick={() => { setJoinedFrom(''); setJoinedTo(''); }} className="pb-2.5 text-[12.5px] font-semibold text-[var(--color-brand)]">Clear</button>
          )}
        </div>
      )}

      {view === 'employees' && (
      <div className={`${CARD} mt-5 overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
              <th className="h-[46px] w-12 rounded-tl-[10px] px-5">
                <input type="checkbox" checked={allShownPicked} onChange={togglePage} className="accent-[var(--color-brand)]" />
              </th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Employee</th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Role &amp; department</th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Employment</th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Started</th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Next HR milestone</th>
              <th className="h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Status</th>
              <th className="h-[46px] px-5 text-right text-[11.5px] font-medium text-[var(--color-ink-faint)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const [label, tint, ink] = STATUS[e.status] || [e.status, 'var(--color-fill)', 'var(--color-ink-soft)'];
              return (
                <tr key={e.username} className="border-b border-[var(--color-line-soft)] last:border-0 transition-colors hover:bg-[var(--color-row-hover)]">
                  <td className="h-[72px] px-5 py-4">
                    <input type="checkbox" checked={picked.has(e.username)} onChange={() => toggleOne(e.username)} className="accent-[var(--color-brand)]" />
                  </td>
                  <td className="h-[72px] px-5 py-4">
                    <Link to={profileHref(e)} className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[12.5px] font-semibold text-[var(--color-ink-soft)]">{initials(e.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{e.name}</span>
                        <span className="mt-1 block truncate text-[12px] text-[var(--color-ink-faint)]">{e.email || '—'}</span>
                        {e.phone && <span className="block truncate text-[12px] text-[var(--color-ink-faint)]">{e.phone}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="h-[72px] px-5 py-4">
                    <span className="block max-w-[200px] text-[13px] text-[var(--color-ink-soft)]">{e.title || '—'}</span>
                    <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">{e.department || '—'}</span>
                  </td>
                  <td className="h-[72px] px-5 py-4 text-[13px] text-[var(--color-ink-soft)]">
                    {e.employment}
                    {e.employmentNote && <span className="text-[var(--color-ink-faint)]"> · {e.employmentNote}</span>}
                  </td>
                  <td className="h-[72px] whitespace-nowrap px-5 py-4 text-[13px] text-[var(--color-ink-soft)]">{day(e.startDate)}</td>
                  {/* What HR has to do about this person next. */}
                  <td className="h-[72px] whitespace-nowrap px-5 py-4">
                    {e.milestone ? (
                      <>
                        <span className="block text-[13px] text-[var(--color-ink-soft)]">{e.milestone.label}</span>
                        <span className={`mt-0.5 block text-[12px] ${e.milestone.days <= 30 && e.milestone.label !== 'Annual review' ? 'font-semibold text-[var(--color-stage-out)]' : 'text-[var(--color-ink-faint)]'}`}>
                          {day(e.milestone.date)} · {e.milestone.days < 0 ? `${Math.abs(e.milestone.days)} days ago` : `${e.milestone.days} days`}
                        </span>
                      </>
                    ) : <span className="text-[var(--color-ink-faint)]">—</span>}
                  </td>
                  <td className="h-[72px] px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: tint, color: ink }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
                    </span>
                  </td>
                  <td className="relative px-4 py-2.5">
                    <button onClick={() => setMenu(menu === e.username ? null : e.username)}
                      className="rounded-[6px] p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">
                      <MoreVertical size={15} />
                    </button>
                    {menu === e.username && (
                      <div onMouseLeave={() => setMenu(null)}
                        className="absolute right-4 top-10 z-30 w-48 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-lift)]">
                        {[['Open profile', profileHref(e)],
                          ['Attendance', '/attendance'],
                          ['Performance', `/performance/${e.username}`],
                          ['Payslips', '/pay']].map(([label, to]) => (
                            <Link key={label} to={to} className="block rounded-[6px] px-3 py-2 text-[12.5px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">{label}</Link>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={8}>
                <EmptyState
                  title="Nobody matches those filters"
                  line="Try a different search, or widen the department and status filters."
                />
              </td></tr>
            )}
          </tbody>
        </table>

        <Pager {...pager.props} noun="employees" />
      </div>
      )}

      {view === 'contracts' && (
        <div className={`${CARD} mt-5 overflow-x-auto`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line-soft)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                {['Employee', 'Contract type', 'Started', 'Ends', 'Days remaining', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const [label, tint, ink] = STATUS[e.status] || [e.status, 'var(--color-fill)', 'var(--color-ink-soft)'];
                const left = e.contractEnd ? e.milestone?.label === 'Contract ends' ? e.milestone.days : null : null;
                return (
                  <tr key={e.username} className="border-b border-[var(--color-line-soft)] last:border-0 transition-colors hover:bg-[var(--color-row-hover)]">
                    <td className="h-[72px] px-5 py-4">
                      <Link to={profileHref(e)} className="font-semibold text-[var(--color-ink)] hover:underline">{e.name}</Link>
                      <span className="block text-[12px] text-[var(--color-ink-faint)]">{e.title || '—'}</span>
                    </td>
                    <td className="h-[72px] px-5 py-4 text-[var(--color-ink-soft)]">{e.employment}<span className="block text-[12px] text-[var(--color-ink-faint)]">{e.employmentNote}</span></td>
                    <td className="h-[72px] whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{day(e.startDate)}</td>
                    <td className="h-[72px] whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{e.contractEnd ? day(e.contractEnd) : 'No end date'}</td>
                    <td className="h-[72px] whitespace-nowrap px-5 py-4">
                      {left == null ? <span className="text-[var(--color-ink-faint)]">—</span>
                        : <span className={left <= 60 ? 'font-semibold text-[var(--color-stage-out)]' : 'text-[var(--color-ink-soft)]'}>{left} days</span>}
                    </td>
                    <td className="h-[72px] px-5 py-4">
                      <span className="inline-flex h-[25px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium" style={{ background: tint, color: ink }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-[var(--color-ink-soft)]">Nobody matches those filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'past' && (
        <div className={`${CARD} mt-5 overflow-x-auto`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line-soft)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                {['Employee', 'Former role', 'Joined', 'Left', 'Reason', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.past.map((p) => (
                <tr key={p.username || p.name} className="border-b border-[var(--color-line-soft)] last:border-0 transition-colors hover:bg-[var(--color-row-hover)]">
                  <td className="h-[72px] px-5 py-4 font-semibold text-[var(--color-ink)]">{p.name}</td>
                  <td className="h-[72px] px-5 py-4 text-[var(--color-ink-soft)]">{p.role || '—'}<span className="block text-[12px] text-[var(--color-ink-faint)]">{p.department || ''}</span></td>
                  <td className="h-[72px] whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{day(p.joined)}</td>
                  <td className="h-[72px] whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{day(p.left)}</td>
                  <td className="h-[72px] px-5 py-4 text-[var(--color-ink-soft)]">{p.reason}</td>
                  <td className="h-[72px] px-5 py-4 text-right">
                    <Link to={`/past/${String(p.name).toLowerCase().replace(/\s+/g, '-')}`} className="text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">Records</Link>
                  </td>
                </tr>
              ))}
              {data.past.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-[var(--color-ink-soft)]">Nobody has left.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur md:pl-[228px]">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-2.5 md:px-8">
            <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{picked.size} selected</span>
            <button onClick={() => setPicked(new Set())} className="text-[12.5px] font-semibold text-[var(--color-brand)]">Clear</button>
            <span className="flex-1" />
            <button onClick={() => exportCsv(true)} className={light}><Download size={15} /> Export selected</button>
          </div>
        </div>
      )}

      {/* Warnings are not a directory: a warning belongs to a person's record
          and to Reviews & Coaching, which is where it is written and read. */}
    </div>
  );
}
