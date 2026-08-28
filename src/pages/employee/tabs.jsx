import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, FileText, Search, Upload, ChevronLeft, ChevronRight, ArrowRight,
  Star, AlertTriangle, MessageSquare, Eye, Trash2,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { timeShort } from '../../lib/format.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pager, { usePager } from '../../components/ui/Pager.jsx';

// The tabs of an employee's record. Each shows what Pulse actually holds and
// says so plainly when it holds nothing — an empty month is not a zero.

export const CARD = 'card';
export const D = (n) => 'D' + Number(n || 0).toLocaleString('en-US');
// Company clock = Gambia (GMT) — dates pin to UTC like the shared format.js
// helpers, so a viewer abroad reads the same day the office does. Times go
// through the shared timeShort, never a page-local copy.
export const day = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
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
// ── Attendance ─────────────────────────────────────────────────────
// Every figure comes from ONE call to
// /api/hr/employee/:username/attendance?month=, so the tiles and the day
// cards cannot disagree, and the month arrows move the DATA (before 27 Aug
// they moved an empty grid while the numbers stayed on the current month).
//
// 🔒 There is no excused/unexcused split on an absence: nothing in Pulse
// records one, and a made-up split on a person's record is worse than none
// (Adama 27 Aug). Approved leave already stands as its own status.
//
// The server's status words, each with the ink it is written in and the wash
// behind the card.
const CELL = {
  worked: ['Present', 'var(--color-pill-active)', 'var(--color-pill-active-bg)'],
  late: ['Late', 'var(--color-pill-leave)', 'var(--color-pill-leave-bg)'],
  absent: ['Absent', 'var(--color-stage-out)', 'var(--color-stage-out-bg)'],
  leave: ['On leave', 'var(--color-stage-new)', 'var(--color-stage-new-bg)'],
  sick: ['Sick leave', 'var(--color-stage-new)', 'var(--color-stage-new-bg)'],
  off: ['Off', 'var(--color-ink-faint)', 'transparent'],
  today: ['Not started', 'var(--color-ink-soft)', 'transparent'],
  future: ['Scheduled', 'var(--color-ink-faint)', 'transparent'],
};
const FILTERS = [
  ['all', 'All'], ['present', 'Present'], ['late', 'Late'],
  ['absent', 'Absent'], ['leave', 'Leave'], ['review', 'Needs review'],
];
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : null);
const shiftLabel = (s) => (s ? `${s.start}–${s.end}` : '—');
const hoursLabel = (min) => `${Math.floor((min || 0) / 60)}h ${String(Math.round((min || 0) % 60)).padStart(2, '0')}m`;
// The number, and the line saying what it is measured against. Colour lives
// on the sub-line, and only where it means something.
const ATT_TONE = {
  good: 'var(--color-pill-active)',
  warn: 'var(--color-pill-leave)',
  bad: 'var(--color-stage-out)',
  muted: 'var(--color-ink-faint)',
};
const AttTile = ({ label, value, sub, tone = 'muted' }) => (
  <div className={`${CARD} p-5`}>
    <p className="text-[12.5px] text-[var(--color-ink-soft)]">{label}</p>
    <p className="mt-2 text-[26px] font-semibold leading-none text-[var(--color-ink)]">{value}</p>
    <p className="mt-2 text-[12px] font-medium" style={{ color: ATT_TONE[tone] }}>{sub}</p>
  </div>
);
// The shell: it owns the month and fetches it. Kept apart from the view
// below so the view can be rendered with real data in the tab test — a
// self-fetching component can only ever be tested as a loading skeleton,
// and this tab is exactly where a blank page came from once.
export function Attendance({ username }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setD(null);
    setError('');
    api(`/hr/employee/${encodeURIComponent(username)}/attendance?month=${month}`)
      .then((j) => { if (live) setD(j); })
      .catch((e) => { if (live) setError(e.message || 'Could not load attendance'); });
    return () => { live = false; };
  }, [username, month]);

  return <AttendanceMonth d={d} error={error} month={month} onMonth={setMonth} />;
}

// The month in four numbers, anything that needs a decision called out, the
// last working days at a glance, and THE FULL RECORD underneath — Adama
// 27 Aug: "the attendance full record should be here with date filters, i do
// not have to go to another page to see this." The month arrows filter by
// date, the chips by what happened, and Review jumps to the records that
// cannot be trusted rather than leaving the page.
export function AttendanceMonth({ d, error, month, onMonth }) {
  const [filter, setFilter] = useState('all');
  const shift = (n) => {
    const x = new Date(`${month}-01T00:00:00Z`);
    x.setUTCMonth(x.getUTCMonth() + n);
    onMonth(x.toISOString().slice(0, 7));
  };
  const monthLabel = new Date(`${month}-01T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Days that have actually happened, newest first. Rest days stay out of
  // the record — a row saying "Off" is not a record of anything.
  const rows = useMemo(() => {
    const days = (d?.days || []).filter((x) => x.date <= (d?.today || '') && x.date >= (d?.attendanceStart || '') && (x.scheduled || x.checkIn || x.leaveType));
    const keep = {
      all: () => true,
      present: (x) => x.status === 'worked' || x.status === 'late',
      late: (x) => x.status === 'late',
      absent: (x) => x.status === 'absent',
      leave: (x) => x.status === 'leave' || x.status === 'sick',
      review: (x) => x.missingCheckout,
    }[filter] || (() => true);
    return days.filter(keep).sort((x, y) => y.date.localeCompare(x.date));
  }, [d, filter]);
  // The last stretch of real working days — the days a manager actually asks
  // about. Rest days are skipped: a row of "Off" cards says nothing.
  const recent = useMemo(() => {
    const days = (d?.days || []).filter((x) => x.scheduled && x.date <= (d?.today || '') && x.date >= (d?.attendanceStart || ''));
    return days.slice(-7);
  }, [d]);
  const pager = usePager(rows);
  const { reset } = pager;
  useEffect(() => { reset(); }, [filter, month, reset]);

  if (error) return <p className="py-4 text-[13px] text-[var(--color-stage-out)]">{error}</p>;
  const s = d?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="t-card">Attendance · {monthLabel}</h2>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
            Counted against this person&rsquo;s own working days, not an assumed week.
          </p>
        </div>
        <span className="flex items-center gap-2">
          <button onClick={() => shift(-1)} aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--color-line-control)] text-[var(--color-ink-soft)]">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => shift(1)} aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--color-line-control)] text-[var(--color-ink-soft)]">
            <ChevronRight size={14} />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <AttTile label="Attendance rate"
          value={!s ? '…' : s.ratePct == null ? '—' : `${s.ratePct}%`}
          sub={s ? `${s.present} of ${s.scheduledDays} scheduled` : ' '}
          tone={!s || s.ratePct == null ? 'muted' : s.ratePct >= 90 ? 'good' : 'warn'} />
        <AttTile label="Hours worked"
          value={s ? hoursLabel(s.workedMinutes) : '…'}
          sub={s ? `of ${Math.round(s.scheduledMinutes / 60)}h scheduled` : ' '} tone="muted" />
        <AttTile label="Late arrivals" value={s ? s.late : '…'}
          sub={s && s.latePctOfAttended != null ? `${s.latePctOfAttended}% of attended days` : 'none this month'}
          tone={s && s.late ? 'warn' : 'muted'} />
        <AttTile label="Absences" value={s ? s.absent : '…'}
          sub={s && s.absent ? 'scheduled days with no clock-in' : 'none this month'}
          tone={s && s.absent ? 'bad' : 'muted'} />
      </div>

      {/* A record nobody can trust is work for a manager, so it is named
          rather than left to be noticed. */}
      {s?.missingCheckouts > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-stage-out)] bg-[var(--color-stage-out-bg)] px-4 py-3">
          <AlertTriangle size={15} className="shrink-0 text-[var(--color-stage-out)]" />
          <span className="text-[13px] font-medium text-[var(--color-ink)]">
            {s.missingCheckouts} {s.missingCheckouts === 1 ? 'record needs' : 'records need'} review
          </span>
          <span className="text-[12.5px] text-[var(--color-ink-soft)]">
            clocked in without a clock-out, so the hours cannot be counted
          </span>
          <button onClick={() => setFilter('review')} className={`${linkish} ml-auto`}>Review <ArrowRight size={14} /></button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <CardHead title="Attendance calendar" action={
          <span className="text-[12px] text-[var(--color-ink-faint)]">last {recent.length} working days</span>} />
        {!d ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="h-[76px] rounded-[8px] border border-[var(--color-line-soft)]" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            title="No working days recorded yet"
            line="Days appear here from the first scheduled day of the month."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {recent.map((c) => {
              const meta = CELL[c.status] || CELL.absent;
              const label = c.missingCheckout ? 'Needs review'
                : c.status === 'leave' ? (c.leaveType || 'On leave') : meta[0];
              const ink = c.missingCheckout ? 'var(--color-stage-out)' : meta[1];
              return (
                <div key={c.date} className="rounded-[8px] border border-[var(--color-line-soft)] p-3"
                  style={{ background: meta[2] === 'transparent' ? undefined : meta[2] }}>
                  <p className="text-[12px] text-[var(--color-ink-faint)]">{c.date.slice(8, 10)}</p>
                  <p className="mt-1 truncate text-[12.5px] font-medium" style={{ color: ink }}>{label}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink-soft)]">
                    {c.checkIn ? `${hhmm(c.checkIn)}–${hhmm(c.checkOut) || '—'}` : shiftLabel(c.scheduled)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* THE FULL RECORD, here (Adama 27 Aug: "i do not have to go to another
          page to see this"). The month arrows above filter by date; the chips
          filter by what happened. */}
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <h3 className="t-card">Attendance records</h3>
          <span className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`h-7 rounded-[8px] px-3 text-[12px] font-medium ${filter === k
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'border border-[var(--color-line-control)] text-[var(--color-ink-soft)]'}`}>
                {label}
              </button>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                {['Date', 'Schedule', 'Clock in', 'Clock out', 'Worked', 'Status'].map((h) => (
                  <th key={h} className="h-[46px] px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r) => {
                const meta = CELL[r.status] || CELL.absent;
                const label = r.missingCheckout ? 'Missing checkout'
                  : r.status === 'leave' ? (r.leaveType || 'On leave') : meta[0];
                const ink = r.missingCheckout ? 'var(--color-stage-out)' : meta[1];
                const wash = r.missingCheckout ? 'var(--color-stage-out-bg)' : meta[2];
                return (
                  <tr key={r.date} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="whitespace-nowrap px-5 py-4 text-[var(--color-ink)]">{day(r.date)}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-[var(--color-ink-soft)]">{shiftLabel(r.scheduled)}</td>
                    <td className="px-5 py-4 text-[var(--color-ink-soft)]">{hhmm(r.checkIn) || '—'}</td>
                    <td className="px-5 py-4 text-[var(--color-ink-soft)]">{hhmm(r.checkOut) || '—'}</td>
                    <td className="px-5 py-4 text-[var(--color-ink-soft)]">{r.workedMinutes == null ? '—' : hoursLabel(r.workedMinutes)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center rounded-[6px] px-2 py-1 text-[12px] font-medium"
                        style={{ color: ink, background: wash === 'transparent' ? 'var(--color-fill)' : wash }}>
                        {label}
                      </span>
                      {r.fixedByName && (
                        <span className="mt-1 block text-[11px] text-[var(--color-ink-faint)]">Fixed by {r.fixedByName}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {d && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <EmptyState
                    title={filter === 'all' ? 'Nothing recorded this month' : 'Nothing in this filter'}
                    line={filter === 'all'
                      ? 'Days appear here from the first scheduled day of the month. Use the arrows above to look at another month.'
                      : 'Try another filter, or All to see the whole month.'}
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager {...pager.props} noun="days" />
      </div>
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────
// What a browser can open in a tab. A .docx cannot be, so it gets Download
// only rather than a View that quietly downloads instead.
const VIEWABLE = /^(application\/pdf|image\/|text\/plain)/;
const CATEGORIES = [['all', 'All documents'], ['contract', 'Contracts'], ['document', 'Employment'], ['monthly-review', 'Reviews'], ['general', 'Other']];
export function Documents({ documents, onUpload, uploading, canDelete, onChanged }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  // Two-step, in the row itself. A document is deleted for good, so the
  // second click is the consent — and an inline ask beats a browser popup
  // you dismiss without reading.
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');

  async function remove(id) {
    setBusy(id);
    setErr('');
    try {
      await api(`/agent-files/${id}`, { method: 'DELETE' });
      setConfirming(null);
      await onChanged?.();
    } catch (e) {
      setErr(e.message || 'Could not delete that');
    } finally {
      setBusy(null);
    }
  }
  const shown = documents.filter((f) => (cat === 'all' || f.category === cat) && (!q || f.name.toLowerCase().includes(q.toLowerCase())));
  const count = (k) => (k === 'all' ? documents.length : documents.filter((f) => f.category === k).length);
  return (
    <div className="space-y-4">
    <div>
      <h2 className="t-card">Documents</h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Contracts, employment files and reviews attached to this employee.</p>
    </div>
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
          {err && <span className="w-full text-[12.5px] text-[var(--color-stage-out)]">{err}</span>}
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
                  {/* View opens it in a tab; Download puts it on the disk.
                      Only offered for what a browser can actually render —
                      a View that silently downloads a .docx is a lie. */}
                  {confirming === f.id ? (
                    <span className="flex items-center justify-end gap-3 whitespace-nowrap">
                      <span className="text-[12px] text-[var(--color-ink-soft)]">Delete for good?</span>
                      <button onClick={() => remove(f.id)} disabled={busy === f.id}
                        className="text-[12px] font-medium text-[var(--color-stage-out)] hover:underline disabled:opacity-50">
                        {busy === f.id ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button onClick={() => setConfirming(null)}
                        className="text-[12px] font-medium text-[var(--color-ink-soft)] hover:underline">Cancel</button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-3">
                      {VIEWABLE.test(f.mimeType || '') && (
                        <a href={`/api/agent-files/${f.id}/download?inline=1&t=${encodeURIComponent(getToken() || '')}`}
                          target="_blank" rel="noopener noreferrer" title="View"
                          className="text-[var(--color-ink-faint)] hover:text-[var(--color-brand)]"><Eye size={15} /></a>
                      )}
                      <a href={`/api/agent-files/${f.id}/download?t=${encodeURIComponent(getToken() || '')}`}
                        title="Download"
                        className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Download size={15} /></a>
                      {canDelete && (
                        <button onClick={() => { setConfirming(f.id); setErr(''); }} title="Delete"
                          className="text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]"><Trash2 size={15} /></button>
                      )}
                    </span>
                  )}
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
    <div className="space-y-4">
    <div>
      <h2 className="t-card">Notes</h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Recognition, coaching, concerns and general manager notes.</p>
    </div>
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
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────
export function History({ history }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="t-card">Employment history</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">A readable timeline of important changes, not raw field-by-field database logs.</p>
      </div>
      <div className={`${CARD} p-5`}>
        {history.length === 0 ? (
          <Empty>Nothing has changed on this record yet. Edits, status changes and contract events appear here.</Empty>
        ) : (
          <ol className="relative space-y-4 border-l border-[var(--color-line)] pl-5">
            {history.map((h, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand-soft)]" />
                <p className="text-[12px] text-[var(--color-ink-faint)]">{day(h.date)}</p>
                <p className="mt-0.5 text-[13px] font-medium text-[var(--color-ink)]">{h.event}</p>
                {h.detail && <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-soft)]">{h.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
