import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, FileText, Search, Upload, ChevronLeft, ChevronRight, ArrowRight,
  Star, AlertTriangle, MessageSquare,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import EmptyState from '../../components/ui/EmptyState.jsx';

// The tabs of an employee's record. Each shows what Pulse actually holds and
// says so plainly when it holds nothing — an empty month is not a zero.

export const CARD = 'card';
export const D = (n) => 'D' + Number(n || 0).toLocaleString('en-US');
export const day = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const hhmm = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const dur = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`);
const linkish = 'inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-brand)] hover:underline';
const Empty = ({ children }) => <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">{children}</p>;
// An empty card says WHY it is empty and where to go, rather than sitting
// there looking broken. Kept beside Empty so a later edit to one section
// cannot delete it — which is exactly how it got lost once.
function Nothing({ children, to, cta }) {
  return (
    <div className="py-4">
      <p className="text-[13px] text-[var(--color-ink-soft)]">{children}</p>
      {to && <Link to={to} className={`${linkish} mt-2`}>{cta} <ArrowRight size={14} /></Link>}
    </div>
  );
}

export const CardHead = ({ title, action }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="t-card">{title}</h2>
    {action}
  </div>
);
export const Row = ({ label, value }) => (
  <div className="flex items-start gap-3 py-2.5">
    <span className="w-[132px] shrink-0 text-[13px] text-[var(--color-ink-faint)]">{label}</span>
    <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{value || <span className="text-[var(--color-ink-ghost)]">—</span>}</span>
  </div>
);
export function Bar({ label, pct, colour }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-[var(--color-ink-soft)]">{label}</span>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--color-line-soft)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: colour }} />
      </div>
    </div>
  );
}

// ── Job & pay ──────────────────────────────────────────────────────
export function JobPay({ e, pay, contract }) {
  const net = pay ? (Number(pay.base) || 0) + (Number(pay.transport) || 0) + (Number(pay.commission) || 0) : null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={`${CARD} p-5`}>
        <CardHead title="Employment details" />
        <div className="divide-y divide-[var(--color-line-soft)]">
          <Row label="Role" value={e.title} />
          <Row label="Department" value={e.department} />
          <Row label="Reports to" value={e.reportsTo} />
          <Row label="Employment type" value={e.employment} />
          <Row label="Work schedule" value={e.schedule} />
          <Row label="Location" value={e.address} />
          <Row label="Date joined" value={e.joined ? day(e.joined) : ''} />
          <Row label="Probation ends" value={e.probationEnd ? day(e.probationEnd) : ''} />
          <Row label="Contract ends" value={e.contractEnd ? day(e.contractEnd) : ''} />
        </div>
      </div>
      <div className="space-y-4">
        {/* 🔒 Only what the payroll-gated endpoint returned. */}
        <div className={`${CARD} p-5`}>
          <CardHead title="Salary overview" />
          {pay ? (
            <>
              <div className="divide-y divide-[var(--color-line-soft)]">
                <Row label="Base salary" value={`${D(pay.base)} / month`} />
                <Row label="Allowances" value={`${D(pay.transport)} / month`} />
                <Row label="Commission" value={D(pay.commission)} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line)] pt-3">
                <span className="text-[13px] text-[var(--color-ink-faint)]">Net pay</span>
                <span className="text-[15px] font-semibold text-[var(--color-ink)]">{D(net)} <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">/ month</span></span>
              </div>
              <Link to="/payroll" className={`${linkish} mt-3`}>View payslips and payment history <ArrowRight size={14} /></Link>
            </>
          ) : <Empty>Pay is only visible to payroll holders.</Empty>}
        </div>
        <div className={`${CARD} p-5`}>
          <CardHead title="Contract information" />
          <div className="divide-y divide-[var(--color-line-soft)]">
            <Row label="Contract type" value={contract.type} />
            <Row label="Start date" value={contract.start ? day(contract.start) : ''} />
            <Row label="End date" value={contract.end ? day(contract.end) : 'No end date'} />
            <Row label="Notice period" value={contract.noticePeriod} />
            <Row label="Contract document" value={contract.document
              ? <a href={`/api/agent-files/${contract.document.id}/download?t=${encodeURIComponent(getToken() || '')}`} className={linkish}><FileText size={14} /> {contract.document.name}</a>
              : ''} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Attendance ─────────────────────────────────────────────────────
const DAY_TONE = {
  present: ['var(--color-pill-active)', 'Present'],
  late: ['var(--color-pill-leave)', 'Late'],
  absent: ['var(--color-stage-out)', 'Absent'],
  leave: ['var(--color-stage-new)', 'On leave'],
};
export function Attendance({ a, records, overtimeMinutes }) {
  const [month, setMonth] = useState(a.month);
  const byDate = useMemo(() => Object.fromEntries(records.map((r) => [r.date, r])), [records]);
  const rate = a.workingDays ? Math.round((a.present / a.workingDays) * 100) : null;
  const cells = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const start = new Date(first);
    start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      return d;
    });
  }, [month]);
  const shift = (n) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Attendance rate', rate == null ? '—' : `${rate}%`, `${a.present} of ${a.workingDays} working days`],
          ['Total hours worked', `${a.hours}h ${a.minutes}m`, 'This month'],
          ['Overtime', dur(overtimeMinutes), 'Past the scheduled day'],
          ['Late arrivals', a.late, 'This month'],
        ].map(([label, value, sub]) => (
          <div key={label} className={`${CARD} p-5`}>
            <p className="text-[13px] text-[var(--color-ink-soft)]">{label}</p>
            <p className="mt-2 text-[24px] font-semibold leading-none text-[var(--color-ink)]">{value}</p>
            <p className="mt-1.5 text-[12px] text-[var(--color-ink-faint)]">{sub}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-5`}>
          <CardHead title="Attendance calendar" action={
            <span className="flex items-center gap-2">
              <button onClick={() => shift(-1)} className="rounded-[6px] border border-[var(--color-line-control)] p-1.5 text-[var(--color-ink-soft)]"><ChevronLeft size={14} /></button>
              <span className="w-[112px] text-center text-[13px] font-medium text-[var(--color-ink)]">
                {new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </span>
              <button onClick={() => shift(1)} className="rounded-[6px] border border-[var(--color-line-control)] p-1.5 text-[var(--color-ink-soft)]"><ChevronRight size={14} /></button>
            </span>} />
          <div className="grid grid-cols-7 text-center text-[11.5px] text-[var(--color-ink-faint)]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="py-1.5">{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {cells.map((d, i) => {
              const iso = d.toISOString().slice(0, 10);
              const rec = byDate[iso];
              const other = iso.slice(0, 7) !== month;
              const tone = rec ? DAY_TONE[rec.status] : null;
              return (
                <span key={i} className={`py-1.5 text-[13px] ${other ? 'text-[var(--color-ink-ghost)]' : 'text-[var(--color-ink-soft)]'}`}
                  style={tone ? { color: tone[0], fontWeight: 500 } : undefined} title={tone ? tone[1] : ''}>
                  {d.getUTCDate()}
                </span>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 border-t border-[var(--color-line-soft)] pt-3">
            {Object.entries(DAY_TONE).map(([k, [colour, label]]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} /> {label}
              </span>
            ))}
          </div>
        </div>
        <div className={`${CARD} p-5`}>
          <CardHead title="Monthly summary" />
          <div className="divide-y divide-[var(--color-line-soft)]">
            <Row label="Working days" value={a.workingDays} />
            <Row label="Present" value={a.present} />
            <Row label="Absent" value={a.absent} />
            <Row label="Late" value={a.late} />
            <Row label="On leave" value={a.leave} />
          </div>
          <Link to="/attendance" className={`${linkish} mt-3`}>View full attendance report <ArrowRight size={14} /></Link>
        </div>
      </div>
      <div className={`${CARD} overflow-x-auto`}>
        <div className="p-5 pb-0"><CardHead title="Recent attendance records" /></div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
              {['Date', 'Clock in', 'Clock out', 'Status', 'Worked'].map((h) => <th key={h} className="h-[46px] px-5">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 10).map((r) => {
              const [colour, label] = DAY_TONE[r.status] || DAY_TONE.absent;
              return (
                <tr key={r.date} className="border-b border-[var(--color-line-soft)] last:border-0">
                  <td className="px-5 py-4 text-[var(--color-ink)]">{day(r.date)}</td>
                  <td className="px-5 py-4 text-[var(--color-ink-soft)]">{r.checkIn ? hhmm(r.checkIn) : '—'}</td>
                  <td className="px-5 py-4 text-[var(--color-ink-soft)]">{r.checkOut ? hhmm(r.checkOut) : '—'}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: colour }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[var(--color-ink-soft)]">{dur(r.workedMinutes)}</td>
                </tr>
              );
            })}
            {records.length === 0 && <tr><td colSpan={5}>
              <EmptyState
                title="No check-ins this month"
                line="A check-in appears here once their manager records one."
              />
            </td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────
const CATEGORIES = [['all', 'All documents'], ['contract', 'Contracts'], ['document', 'Employment'], ['monthly-review', 'Reviews'], ['general', 'Other']];
export function Documents({ documents, onUpload, uploading }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const shown = documents.filter((f) => (cat === 'all' || f.category === cat) && (!q || f.name.toLowerCase().includes(q.toLowerCase())));
  const count = (k) => (k === 'all' ? documents.length : documents.filter((f) => f.category === k).length);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className={`${CARD} p-4`}>
        <CardHead title="Categories" />
        <div className="space-y-1">
          {CATEGORIES.map(([k, label]) => (
            <button key={k} onClick={() => setCat(k)}
              className={`flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-[13px] ${cat === k ? 'bg-[var(--color-brand-50)] font-medium text-[var(--color-brand)]' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)]'}`}>
              {label} <span className="text-[12px] text-[var(--color-ink-faint)]">{count(k)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <span className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search documents…" className="field w-full pl-10" />
          </span>
          <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
            <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload document'}
            <input type="file" className="sr-only" onChange={(ev) => onUpload(ev.target.files?.[0])} />
          </label>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
              {['Document', 'Category', 'Added by', 'Date', 'Size', ''].map((h, i) => <th key={i} className="h-[46px] px-5">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} className="border-b border-[var(--color-line-soft)] last:border-0">
                <td className="px-5 py-4">
                  <span className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-stage-new-bg)] text-[var(--color-stage-new)]"><FileText size={15} /></span>
                    <span className="truncate font-medium text-[var(--color-ink)]">{f.name}</span>
                  </span>
                </td>
                <td className="px-5 py-4 text-[var(--color-ink-soft)]">{f.category}</td>
                <td className="px-5 py-4 text-[var(--color-ink-soft)]">{f.uploadedBy || '—'}</td>
                <td className="whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{day(f.uploadedAt)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{Math.round((f.sizeBytes || 0) / 1024)} KB</td>
                <td className="px-5 py-4 text-right">
                  <a href={`/api/agent-files/${f.id}/download?t=${encodeURIComponent(getToken() || '')}`} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Download size={15} /></a>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}>
              <EmptyState
                title="No files yet"
                line="Contracts, CVs and anything else uploaded for this person appear here."
              />
            </td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Notes ──────────────────────────────────────────────────────────
const NOTE_TONE = {
  Recognition: ['var(--color-pill-active-bg)', 'var(--color-pill-active)', Star],
  Coaching: ['var(--color-stage-new-bg)', 'var(--color-stage-new)', MessageSquare],
  Concern: ['var(--color-stage-out-bg)', 'var(--color-stage-out)', AlertTriangle],
  General: ['var(--color-fill)', 'var(--color-ink-soft)', FileText],
};
export function Notes({ notes, username }) {
  const [open, setOpen] = useState(0);
  const [cat, setCat] = useState('all');
  const shown = notes.filter((n) => cat === 'all' || n.kind === cat);
  const active = shown[open] || shown[0];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={`${CARD} p-4`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {['all', 'Recognition', 'Coaching', 'Concern', 'General'].map((k) => (
            <button key={k} onClick={() => { setCat(k); setOpen(0); }}
              className={`rounded-[6px] px-2.5 py-1.5 text-[12px] font-medium ${cat === k ? 'bg-[var(--color-brand-50)] text-[var(--color-brand)]' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)]'}`}>
              {k === 'all' ? 'All' : k}
            </button>
          ))}
          <span className="flex-1" />
          <Link to={`/performance/${username}`} className="text-[13px] font-medium text-[var(--color-brand)] hover:underline">Add note</Link>
        </div>
        {shown.length === 0 && (
          <Nothing to={`/performance/${username}`} cta="Write the first note">
            Nothing written down yet. Coaching notes, recognition and warnings all land here.
          </Nothing>
        )}
        <div className="space-y-2">
          {shown.map((n, i) => {
            const [bg, ink, Icon] = NOTE_TONE[n.kind] || NOTE_TONE.General;
            return (
              <button key={i} onClick={() => setOpen(i)}
                className={`flex w-full items-start gap-3 rounded-[8px] border p-3 text-left ${i === open ? 'border-[var(--color-brand-soft)] bg-[var(--color-brand-100)]' : 'border-[var(--color-line-soft)] hover:bg-[var(--color-soft)]'}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: bg, color: ink }}><Icon size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--color-ink)]">{n.title || String(n.text).slice(0, 40)}</span>
                  <span className="block text-[12px] text-[var(--color-ink-faint)]">{day(n.at)}</span>
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium" style={{ background: bg, color: ink }}>{n.kind}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={`${CARD} p-5`}>
        {!active ? <Empty>Pick a note to read it.</Empty> : (
          <>
            <CardHead title={active.title || active.kind} action={
              <span className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: (NOTE_TONE[active.kind] || NOTE_TONE.General)[0], color: (NOTE_TONE[active.kind] || NOTE_TONE.General)[1] }}>{active.kind}</span>} />
            <p className="text-[12px] text-[var(--color-ink-faint)]">{active.by || 'Pulse'}{active.at ? ` · ${day(active.at)}` : ''}</p>
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-[20px] text-[var(--color-ink)]">{active.text}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────
export function History({ history }) {
  return (
    <div className={`${CARD} p-5`}>
      <CardHead title="Employment history" />
      {history.length === 0 && <Empty>Nothing recorded.</Empty>}
      <ol className="relative space-y-4 border-l border-[var(--color-line)] pl-5">
        {history.map((h, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand-soft)]" />
            <p className="text-[12px] text-[var(--color-ink-faint)]">{day(h.date)}</p>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink)]">{h.event}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
