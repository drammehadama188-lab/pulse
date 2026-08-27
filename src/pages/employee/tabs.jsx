import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, FileText, Search, Upload, ChevronLeft, ChevronRight, ArrowRight,
  Star, AlertTriangle, MessageSquare, MoreHorizontal,
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
// Built to Adama's 27 Aug mockup: the month's tiles, the day-by-day calendar
// with times on every cell, the totals strip, and the records table with a
// row action. Every figure comes from ONE call to
// /api/hr/employee/:username/attendance?month= — the tiles, the calendar,
// the strip and the table cannot disagree, and the month arrows now move the
// DATA, not just the grid (before this, they moved an empty grid while the
// numbers stayed on the current month).
//
// 🔒 There is no excused/unexcused split on an absence: nothing in Pulse
// records one, and a made-up split on a person's record is worse than none
// (Adama 27 Aug). Approved leave already stands as its own status.
const DAY_TONE = {
  present: ['var(--color-pill-active)', 'Present'],
  late: ['var(--color-pill-leave)', 'Late'],
  absent: ['var(--color-stage-out)', 'Absent'],
  leave: ['var(--color-stage-new)', 'On leave'],
};
// The calendar's own vocabulary — the server's status words, each with the
// ink it is written in and the wash behind the cell.
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
// The shell: it owns the month and fetches it. Kept apart from the view
// below so the view can be rendered with real data in the tab test — a
// self-fetching component can only ever be tested as a loading skeleton,
// and this tab is exactly where a blank page came from once.
export function Attendance({ username }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setD(null);
    setError('');
    api(`/hr/employee/${encodeURIComponent(username)}/attendance?month=${month}`)
      .then((j) => { if (live) setD(j); })
      .catch((e) => { if (live) setError(e.message || 'Could not load attendance'); });
    return () => { live = false; };
  }, [username, month, nonce]);

  return (
    <AttendanceMonth
      username={username} d={d} error={error} month={month}
      onMonth={setMonth} onReload={() => setNonce((n) => n + 1)}
    />
  );
}

export function AttendanceMonth({ username, d, error, month, onMonth, onReload }) {
  const [filter, setFilter] = useState('all');
  const [fix, setFix] = useState(null); // the day being corrected

  const shift = (n) => {
    const x = new Date(`${month}-01T00:00:00Z`);
    x.setUTCMonth(x.getUTCMonth() + n);
    onMonth(x.toISOString().slice(0, 7));
  };

  // The calendar grid: whole weeks, Monday first, so a month always sits in
  // the same shape. Days outside the month render as ghosts.
  const grid = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const start = new Date(first);
    start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    const byDate = Object.fromEntries((d?.days || []).map((x) => [x.date, x]));
    const out = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + i);
      const iso = dt.toISOString().slice(0, 10);
      out.push({ iso, num: dt.getUTCDate(), inMonth: iso.slice(0, 7) === month, cell: byDate[iso] || null });
    }
    // A trailing week that belongs entirely to the next month is furniture.
    return out.slice(0, out.slice(35).every((x) => !x.inMonth) ? 35 : 42);
  }, [d, month]);

  // The table follows the chips. "Needs review" is the queue that matters:
  // a day someone clocked into and never out of cannot be trusted or paid.
  const rows = useMemo(() => {
    const days = (d?.days || []).filter((x) => x.date <= (d?.today || '') && x.date >= (d?.attendanceStart || ''));
    const keep = {
      all: () => true,
      present: (x) => x.status === 'worked' || x.status === 'late',
      late: (x) => x.status === 'late',
      absent: (x) => x.status === 'absent',
      leave: (x) => x.status === 'leave' || x.status === 'sick',
      review: (x) => x.missingCheckout,
    }[filter];
    return days.filter(keep).sort((x, y) => y.date.localeCompare(x.date));
  }, [d, filter]);
  const pager = usePager(rows);
  useEffect(() => { pager.reset(); }, [filter, month]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="py-4 text-[13px] text-[var(--color-stage-out)]">{error}</p>;

  const s = d?.summary;
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthNav = (
    <span className="flex items-center gap-2">
      <button onClick={() => shift(-1)} aria-label="Previous month"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--color-line-control)] text-[var(--color-ink-soft)]">
        <ChevronLeft size={14} />
      </button>
      <span className="w-[124px] text-center text-[13px] font-medium text-[var(--color-ink)]">{monthLabel}</span>
      <button onClick={() => shift(1)} aria-label="Next month"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--color-line-control)] text-[var(--color-ink-soft)]">
        <ChevronRight size={14} />
      </button>
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-card">Attendance</h2>
        {monthNav}
      </div>

      {/* The four the mockup leads with. Each names its own denominator, so a
          percentage is never a number without a question attached. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Attendance rate', s ? (s.ratePct == null ? '—' : `${s.ratePct}%`) : '…',
            s ? `${s.present} of ${s.scheduledDays} scheduled days` : ' '],
          ['Hours worked', s ? hoursLabel(s.workedMinutes) : '…',
            s ? `of ${Math.round(s.scheduledMinutes / 60)}h scheduled` : ' '],
          ['Late arrivals', s ? s.late : '…',
            s && s.latePctOfAttended != null ? `${s.latePctOfAttended}% of attended days` : 'none yet'],
          ['Absences', s ? s.absent : '…',
            s ? (s.absent ? 'scheduled days with no clock-in' : 'none this month') : ' '],
        ].map(([label, value, sub]) => (
          <div key={label} className={`${CARD} p-5`}>
            <p className="text-[13px] text-[var(--color-ink-soft)]">{label}</p>
            <p className="mt-2 text-[24px] font-semibold leading-none text-[var(--color-ink)]">{value}</p>
            <p className="mt-1.5 text-[12px] text-[var(--color-ink-faint)]">{sub}</p>
          </div>
        ))}
      </div>

      {/* A record nobody can trust is work for a manager, so it is named at
          the top rather than left to be noticed in the table. */}
      {s?.missingCheckouts > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[var(--color-pill-leave)] bg-[var(--color-pill-leave-bg)] px-4 py-3">
          <AlertTriangle size={15} className="shrink-0 text-[var(--color-pill-leave)]" />
          <span className="text-[13px] font-medium text-[var(--color-ink)]">
            {s.missingCheckouts} {s.missingCheckouts === 1 ? 'record needs' : 'records need'} review
          </span>
          <span className="text-[12.5px] text-[var(--color-ink-soft)]">
            clocked in with no clock-out — the hours cannot be counted until it is closed
          </span>
          <button onClick={() => setFilter('review')} className={`${linkish} ml-auto`}>
            Review {s.missingCheckouts === 1 ? 'it' : 'them'} <ArrowRight size={14} />
          </button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <CardHead title={monthLabel} action={
          <span className="flex flex-wrap items-center gap-4">
            {Object.entries(DAY_TONE).map(([k, [colour, label]]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-faint)]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} /> {label}
              </span>
            ))}
          </span>} />

        <div className="grid grid-cols-7 border-b border-[var(--color-line-soft)] text-center text-[11.5px] text-[var(--color-ink-faint)]">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => <span key={x} className="py-2">{x}</span>)}
        </div>
        {!d ? (
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }, (_, i) => (
              <div key={i} className="h-[92px] border-b border-r border-[var(--color-line-soft)] p-2">
                <div className="h-3 w-4 rounded-[4px] bg-[var(--color-line-soft)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {grid.map(({ iso, num, inMonth, cell }) => {
              const meta = cell ? CELL[cell.status] : null;
              const isToday = iso === d.today;
              return (
                <div key={iso}
                  className={`h-[92px] overflow-hidden border-b border-r border-[var(--color-line-soft)] p-2 ${isToday ? 'ring-1 ring-inset ring-[var(--color-brand)]' : ''}`}
                  style={{ background: inMonth && meta ? meta[2] : 'transparent', opacity: inMonth ? 1 : 0.4 }}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[12px] ${inMonth ? 'text-[var(--color-ink-soft)]' : 'text-[var(--color-ink-ghost)]'}`}>{num}</span>
                    {isToday && <span className="text-[10.5px] font-medium text-[var(--color-brand)]">Today</span>}
                    {cell?.missingCheckout && <AlertTriangle size={11} className="text-[var(--color-stage-out)]" />}
                  </div>
                  {inMonth && meta && (
                    <>
                      <p className="mt-1 truncate text-[12px] font-medium" style={{ color: meta[1] }}>
                        {cell.missingCheckout ? 'Needs review' : cell.status === 'leave' ? (cell.leaveType || 'On leave') : meta[0]}
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink-soft)]">
                        {cell.checkIn
                          ? `${hhmm(cell.checkIn)}–${hhmm(cell.checkOut) || '—'}`
                          : cell.status === 'future' || cell.status === 'today'
                            ? shiftLabel(cell.scheduled)
                            : cell.status === 'leave' || cell.status === 'sick' ? 'Approved' : ''}
                      </p>
                      {cell.workedMinutes != null && (
                        <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{hoursLabel(cell.workedMinutes)}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* The month in one line — the same numbers as the tiles, totalled. */}
        {s && (
          <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4 lg:grid-cols-8">
            {[
              [s.scheduledDays, 'Scheduled days'], [s.present, 'Present'], [s.late, 'Late'],
              [s.absent, 'Absent'], [s.leave, 'Leave'],
              [`${Math.round(s.scheduledMinutes / 60)}h`, 'Scheduled'],
              [hoursLabel(s.workedMinutes), 'Worked'], [hoursLabel(s.overtimeMinutes), 'Overtime'],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{value}</p>
                <p className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <h2 className="t-card">Attendance records</h2>
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
                {['Date', 'Schedule', 'Clock in', 'Clock out', 'Worked', 'Status', ''].map((h, i) => (
                  <th key={i} className="h-[46px] px-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r) => {
                const meta = CELL[r.status] || CELL.absent;
                const label = r.missingCheckout ? 'Missing checkout' : r.status === 'leave' ? (r.leaveType || 'On leave') : meta[0];
                const colour = r.missingCheckout ? 'var(--color-stage-out)' : meta[1];
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
                        style={{ color: colour, background: wash === 'transparent' ? 'var(--color-fill)' : wash }}>
                        {label}
                      </span>
                      {r.fixedByName && (
                        <span className="mt-1 block text-[11px] text-[var(--color-ink-faint)]">Fixed by {r.fixedByName}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {r.scheduled && (
                        <button onClick={() => setFix(r)} aria-label={`Fix ${r.date}`}
                          className="rounded-[6px] px-2 py-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)]">
                          <MoreHorizontal size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {d && rows.length === 0 && (
                <tr><td colSpan={7}>
                  <EmptyState
                    title={filter === 'all' ? 'No attendance yet this month' : 'Nothing in this filter'}
                    line={filter === 'all'
                      ? 'Days appear here as they are clocked, from the first scheduled day of the month.'
                      : 'Try another filter, or All to see the whole month.'}
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager {...pager.props} noun="days" />
      </div>

      {fix && (
        <FixDay
          username={username}
          row={fix}
          onClose={() => setFix(null)}
          onSaved={() => { setFix(null); onReload(); }}
        />
      )}
    </div>
  );
}

// Correcting a day writes through the manager's existing fix endpoint, with
// its own permission check and its reason — the same path the Attendance
// page uses, so a correction made here shows up there identically and is
// never a second, quieter way to change someone's hours.
function FixDay({ username, row, onClose, onSaved }) {
  const [checkIn, setCheckIn] = useState(hhmm(row.checkIn) || row.scheduled?.start || '09:00');
  const [checkOut, setCheckOut] = useState(hhmm(row.checkOut) || row.scheduled?.end || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await api('/team/attendance-fix', {
        method: 'POST',
        body: { username, date: row.date, checkIn, checkOut: checkOut || undefined, reason: reason.trim() },
      });
      onSaved();
    } catch (e) {
      setErr(e.message || 'Could not save that');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(23,32,51,0.45)] p-4" onClick={onClose}>
      <div className={`${CARD} w-full max-w-[420px] p-5`} onClick={(e) => e.stopPropagation()}>
        <h2 className="t-card">Fix {day(row.date)}</h2>
        <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
          Scheduled {shiftLabel(row.scheduled)}. The reason stays on the record.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Clock in</span>
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)}
              className="mt-1 w-full rounded-[8px] border border-[var(--color-line-control)] px-3 py-2 text-[13px]" />
          </label>
          <label className="block">
            <span className="text-[12px] text-[var(--color-ink-faint)]">Clock out</span>
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)}
              className="mt-1 w-full rounded-[8px] border border-[var(--color-line-control)] px-3 py-2 text-[13px]" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-[12px] text-[var(--color-ink-faint)]">Why</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Forgot to clock out — confirmed with their manager"
            className="mt-1 w-full rounded-[8px] border border-[var(--color-line-control)] px-3 py-2 text-[13px]" />
        </label>
        {err && <p className="mt-2 text-[12.5px] text-[var(--color-stage-out)]">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || !reason.trim()} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save correction'}
          </button>
        </div>
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
