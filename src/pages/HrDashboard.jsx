import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Clock, DollarSign, AlertTriangle, ShieldCheck, Download, ArrowRight,
  TrendingUp, ClipboardCheck, FileText, CalendarDays, UserPlus, Star,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

// HR Dashboard — the landing page in the design Adama sent (20 Aug): five
// tiles, what needs a decision, who is in today, then performance, the people
// being developed, and what just happened.
//
// Every figure comes from one call to /api/hr/dashboard, which reads the same
// stores the detail pages read — so a number here and the page it links to
// cannot disagree. 🔒 The payroll tile only exists if the server sent it; pay
// is decided there, never hidden here.

const CARD = 'bg-[var(--color-surface)] border border-[var(--color-line)] rounded-[8px]';
const time = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return time(iso);
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
};
const D = (n) => 'D' + Number(n || 0).toLocaleString('en-US');

// One colour per bar, in the order the departments come back.
const BAR = ['var(--color-stage-screening)', 'var(--color-good)', 'var(--color-stage-new)', 'var(--color-stage-interview)'];
const KIND = {
  Attendance: [Clock, 'var(--color-stage-interview-bg)', 'var(--color-stage-interview)'],
  Performance: [TrendingUp, 'var(--color-stage-screening-bg)', 'var(--color-stage-screening)'],
  Probation: [ShieldCheck, 'var(--color-stage-new-bg)', 'var(--color-stage-new)'],
  Request: [FileText, 'var(--color-stage-short-bg)', 'var(--color-stage-short)'],
  Contract: [CalendarDays, 'var(--color-stage-offer-bg)', 'var(--color-stage-offer)'],
};

function Tile({ icon: Icon, label, value, sub, dot, tint, ink, to }) {
  const Tag = to ? Link : 'div';
  return (
    <Tag {...(to ? { to } : {})} className={`${CARD} flex items-start gap-2.5 p-3.5 ${to ? 'hover:border-[var(--color-ink-faint)]' : ''}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" style={{ background: tint, color: ink }}>
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-[var(--color-ink-soft)]">{label}</span>
        <span className="mt-1 block text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--color-ink)]">{value}</span>
        {sub && (
          <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--color-ink-faint)]">
            {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />}
            {sub}
          </span>
        )}
      </span>
    </Tag>
  );
}
const CardHead = ({ title, count, action }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
      {title}
      {count > 0 && <span className="rounded-full bg-[var(--color-stage-out-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-stage-out)]">{count}</span>}
    </h2>
    {action}
  </div>
);
const viewAll = (to) => (
  <Link to={to} className="text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">View all</Link>
);

export default function HrDashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/hr/dashboard').then(setD).catch((e) => setError(e.message));
  }, []);

  // The list of everyone, as a CSV, for whoever asks "send me the team".
  function exportReport() {
    if (!d) return;
    const head = ['Name', 'Role', 'Department', 'In today', 'Started'];
    const rows = d.today.people.map((p) => [p.name, p.title, p.department, p.present ? 'Yes' : 'No', p.startTime ? time(p.startTime) : '']);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-team-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>;
  if (!d) return <p className="text-[13px] text-[var(--color-ink-soft)]">Loading…</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page text-[var(--color-ink)]">HR Dashboard</h1>
          <p className="t-support mt-1">Your team, performance and people actions at a glance.</p>
        </div>
        <button onClick={exportReport}
          className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">
          <Download size={15} /> Export report
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Users} label="Employees" value={d.headcount.total} sub={`${d.headcount.active} active`} dot="var(--color-good)"
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" to="/people" />
        <Tile icon={Clock} label="Present today" value={d.today.present} sub={d.today.absent ? `${d.today.absent} absent` : 'Everybody in'}
          dot={d.today.absent ? 'var(--color-bad)' : 'var(--color-good)'}
          tint="var(--color-stage-short-bg)" ink="var(--color-stage-short)" to="/attendance" />
        {/* 🔒 Rendered only when the server sent it — pay is gated there. */}
        {d.payroll && (
          <Tile icon={DollarSign} label="Payroll" value={D(d.payroll.base)} sub="Current month (base)"
            tint="var(--color-stage-screening-bg)" ink="var(--color-stage-screening)" to="/payroll" />
        )}
        <Tile icon={AlertTriangle} label="Needs attention" value={d.attentionCount} sub={d.attentionCount ? 'See what needs your action' : 'Nothing waiting'}
          tint="var(--color-stage-interview-bg)" ink="var(--color-stage-interview)" />
        <Tile icon={ShieldCheck} label="In probation" value={d.probation} sub={d.development[0]?.due ? `Next decision ${new Date(d.development[0].due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Next decision —'}
          tint="var(--color-stage-offer-bg)" ink="var(--color-stage-offer)" to="/people" />
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
        <div className={`${CARD} p-4`}>
          <CardHead title="Needs attention" count={d.attentionCount} action={viewAll('/people')} />
          {d.attention.length === 0 && <p className="py-4 text-[12.5px] text-[var(--color-ink-soft)]">Nothing needs a decision today.</p>}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {d.attention.map((a, i) => {
              const [Icon, tint, ink] = KIND[a.kind] || KIND.Request;
              return (
                <div key={i} className="flex items-center gap-3 py-3 first:pt-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" style={{ background: tint, color: ink }}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{a.kind}</span>
                    <span className="block truncate text-[12px] text-[var(--color-ink-soft)]">{a.line}</span>
                  </span>
                  <Link to={a.to} className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">
                    {a.cta} <ArrowRight size={13} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <CardHead title="Today's team" action={viewAll('/attendance')} />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-line-soft)] text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                  <th className="py-2 pr-3 font-semibold">Employee</th>
                  <th className="py-2 pr-3 font-semibold">Role</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Start time</th>
                </tr>
              </thead>
              <tbody>
                {d.today.people.map((p) => (
                  <tr key={p.username} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[11px] font-semibold text-[var(--color-ink-soft)]">
                          {(p.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                        </span>
                        <span className="font-semibold text-[var(--color-ink)]">{p.name}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{p.title || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-soft)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.present ? 'var(--color-good)' : 'var(--color-bad)' }} />
                        {p.present ? 'Present' : 'Absent'}
                      </span>
                    </td>
                    <td className="py-2 text-[var(--color-ink-soft)]">{p.present ? time(p.startTime) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className={`${CARD} p-4`}>
          <CardHead title="Team performance" action={viewAll('/performance')} />
          {d.performance.length === 0
            ? <p className="py-4 text-[12.5px] text-[var(--color-ink-soft)]">No targets or review scores recorded this month.</p>
            : (
              <div className="space-y-3.5">
                {d.performance.map((row, i) => (
                  <div key={row.area}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{row.area}</span>
                        <span className="block truncate text-[11.5px] text-[var(--color-ink-soft)]">{row.line}</span>
                      </span>
                      <span className="text-[15px] font-semibold text-[var(--color-ink)]">{row.pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-line-soft)]">
                      <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: BAR[i % BAR.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className={`${CARD} p-4`}>
          <CardHead title="People development" action={viewAll('/performance')} />
          {d.development.length === 0 && <p className="py-6 text-[12.5px] text-[var(--color-ink-soft)]">Nobody is in probation or coaching.</p>}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {d.development.map((p, i) => (
              <div key={i} className="py-2.5 first:pt-0">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[11px] font-semibold text-[var(--color-ink-soft)]">
                    {(p.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{p.name}</span>
                    <span className="block truncate text-[12px] text-[var(--color-ink-soft)]">{p.note}</span>
                  </span>
                  <Link to={p.to} className="shrink-0 rounded-[8px] border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">{p.cta}</Link>
                </div>
                {p.progress != null && (
                  <div className="mt-2.5 h-1.5 rounded-full bg-[var(--color-line-soft)]">
                    <div className="h-full rounded-full bg-[var(--color-good)]" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <CardHead title="Recent activity" action={viewAll('/attendance')} />
          {d.activity.length === 0 && <p className="py-6 text-[12.5px] text-[var(--color-ink-soft)]">Nothing has happened yet today.</p>}
          <div className="space-y-2.5">
            {d.activity.map((a, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-fill)] text-[var(--color-ink-soft)]">
                  <Star size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-ink)]">{a.line}</span>
                <span className="shrink-0 text-[11.5px] text-[var(--color-ink-faint)]">{ago(a.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-[var(--color-ink-faint)]">
        Signed in as {user?.name}. Figures are live from the same records the detail pages use.
      </p>
    </div>
  );
}
