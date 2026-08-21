import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, CheckCircle2, Clock, GraduationCap, UserX, Upload, Download, Plus,
  Search, MoreVertical, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api.js';

// Employees — the roster in the design Adama sent (20 Aug): five tiles, a
// filter row, one row per person, and a footer that says what you are looking
// at. Same system as the HR dashboard, so the two pages read as one product.
//
// 🔒 This page never shows pay, so it is fed by an endpoint that never sends
// it. The salary-carrying roster stays behind the payroll screens.

const CARD = 'bg-[var(--color-surface)] border border-[var(--color-line)] rounded-[8px]';
const STATUS = {
  active: ['Active', 'var(--color-good-bg)', 'var(--color-good)'],
  probation: ['Probation', 'var(--color-stage-screening-bg)', 'var(--color-stage-screening)'],
  leave: ['On leave', 'var(--color-stage-interview-bg)', 'var(--color-stage-interview)'],
  inactive: ['Inactive', 'var(--color-stage-out-bg)', 'var(--color-stage-out)'],
};
const PAGE_SIZES = [10, 25, 50];
const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const profileHref = (name) => `/agents/${String(name || '').toLowerCase().replace(/\s+/g, '-')}`;
const day = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const pctOf = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)}% of total` : '—');

function Tile({ icon: Icon, value, label, sub, tint, ink, onClick, on }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { onClick, type: 'button' } : {})}
      className={`${CARD} flex w-full items-start gap-2.5 p-3.5 text-left ${onClick ? 'hover:border-[var(--color-ink-faint)]' : ''} ${on ? 'border-[var(--color-brand)]' : ''}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" style={{ background: tint, color: ink }}>
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--color-ink)]">{value}</span>
        <span className="mt-1.5 block text-[12.5px] font-medium text-[var(--color-ink-soft)]">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink-faint)]">{sub}</span>
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menu, setMenu] = useState(null);

  useEffect(() => { api('/hr/employees').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { setPage(1); }, [query, dept, status, employment, pageSize]);

  const rows = useMemo(() => {
    const list = data?.employees || [];
    const q = query.trim().toLowerCase();
    return list.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (status && e.status !== status) return false;
      if (employment && e.employment !== employment) return false;
      if (q && !`${e.name} ${e.email} ${e.phone} ${e.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, query, dept, status, employment]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  function exportCsv() {
    const head = ['Name', 'Role', 'Department', 'Status', 'Employment type', 'Start date', 'Email', 'Phone'];
    const body = rows.map((e) => [e.name, e.title, e.department, STATUS[e.status]?.[0] || e.status, e.employment, e.startDate || '', e.email, e.phone]);
    const csv = [head, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const field = 'rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12.5px] text-[var(--color-ink-soft)]';
  const btn = 'inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors';
  const light = `${btn} border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-fill)]`;

  if (error) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>;
  if (!data) return <p className="text-[13px] text-[var(--color-ink-soft)]">Loading…</p>;
  const c = data.counts;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page text-[var(--color-ink)]">
            Employees <span className="ml-1 rounded-full bg-[var(--color-fill)] px-2.5 py-1 align-middle text-[14px] font-semibold text-[var(--color-ink-soft)]">{c.total}</span>
          </h1>
          <p className="t-support mt-1">Manage employee information, roles and employment status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Importing a roster is Pulse's own job elsewhere — this is the page
              where you add one person, so the other two buttons are the honest
              pair: take the list out, or add somebody. */}
          <button onClick={exportCsv} className={light}><Download size={15} /> Export</button>
          <Link to="/people?tab=roster" className={`${btn} bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)]`}>
            <Plus size={15} /> Add employee
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Users} value={c.total} label="Total employees" sub={`${c.active} active`}
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" on={!status} onClick={() => setStatus('')} />
        <Tile icon={CheckCircle2} value={c.active} label="Active" sub={pctOf(c.active, c.total)}
          tint="var(--color-good-bg)" ink="var(--color-good)" on={status === 'active'} onClick={() => setStatus(status === 'active' ? '' : 'active')} />
        <Tile icon={Clock} value={c.leave} label="On leave" sub={pctOf(c.leave, c.total)}
          tint="var(--color-stage-interview-bg)" ink="var(--color-stage-interview)" on={status === 'leave'} onClick={() => setStatus(status === 'leave' ? '' : 'leave')} />
        <Tile icon={GraduationCap} value={c.probation} label="In probation" sub={pctOf(c.probation, c.total)}
          tint="var(--color-stage-screening-bg)" ink="var(--color-stage-screening)" on={status === 'probation'} onClick={() => setStatus(status === 'probation' ? '' : 'probation')} />
        <Tile icon={UserX} value={c.inactive} label="Inactive" sub={pctOf(c.inactive, c.total)}
          tint="var(--color-stage-out-bg)" ink="var(--color-stage-out)" on={status === 'inactive'} onClick={() => setStatus(status === 'inactive' ? '' : 'inactive')} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="relative min-w-[240px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or phone…"
            className={`${field} w-full pl-9`} />
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
      </div>

      <div className={`${CARD} mt-4 overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line-soft)] text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
              <th className="px-4 py-2.5 font-semibold">Employee</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Department</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Employment type</th>
              <th className="px-4 py-2.5 font-semibold">Start date</th>
              <th className="w-10 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const [label, tint, ink] = STATUS[e.status] || [e.status, 'var(--color-fill)', 'var(--color-ink-soft)'];
              return (
                <tr key={e.username} className="border-b border-[var(--color-line-soft)] last:border-0 hover:bg-[var(--color-fill)]">
                  <td className="px-4 py-2.5">
                    <Link to={profileHref(e.name)} className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[11px] font-semibold text-[var(--color-ink-soft)]">{initials(e.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--color-ink)]">{e.name}</span>
                        <span className="block truncate text-[11.5px] text-[var(--color-ink-faint)]">{e.email || '—'}</span>
                        {e.phone && <span className="block truncate text-[11.5px] text-[var(--color-ink-faint)]">{e.phone}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-soft)]">{e.title || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-soft)]">{e.department || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: tint, color: ink }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-soft)]">{e.employment}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-ink-soft)]">{day(e.startDate)}</td>
                  <td className="relative px-4 py-2.5">
                    <button onClick={() => setMenu(menu === e.username ? null : e.username)}
                      className="rounded-[6px] p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">
                      <MoreVertical size={15} />
                    </button>
                    {menu === e.username && (
                      <div onMouseLeave={() => setMenu(null)}
                        className="absolute right-4 top-10 z-30 w-48 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-lift)]">
                        {[['Open profile', profileHref(e.name)],
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
              <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-[var(--color-ink-soft)]">Nobody matches those filters.</td></tr>
            )}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] px-4 py-3">
          <span className="text-[12px] text-[var(--color-ink-soft)]">
            {rows.length === 0 ? 'No employees to show'
              : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, rows.length)} of ${rows.length} employees`}
          </span>
          <span className="flex items-center gap-1.5">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="rounded-[8px] border border-[var(--color-line)] p-1.5 text-[var(--color-ink-soft)] disabled:opacity-40"><ChevronLeft size={15} /></button>
            <span className="px-2 text-[12.5px] text-[var(--color-ink-soft)]">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="rounded-[8px] border border-[var(--color-line)] p-1.5 text-[var(--color-ink-soft)] disabled:opacity-40"><ChevronRight size={15} /></button>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={`${field} ml-2`}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
          </span>
        </div>
      </div>

      {/* The rest of the employee record — contracts, past staff, warnings —
          is still the page it always was; this is the roster in front of it. */}
      <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
        {[['Contracts', '/people?tab=contracts'], ['Past staff', '/people?tab=past'], ['Warnings & records', '/people?tab=warnings']].map(([label, to]) => (
          <Link key={label} to={to} className="font-semibold text-[var(--color-brand)] hover:underline">{label}</Link>
        ))}
      </div>
    </div>
  );
}
