import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronRight, ChevronLeft, Mail, Phone, MapPin, Briefcase, Building2, Clock,
  CalendarDays, UserRound, Download, FileText, Star, MessageSquare, Plus,
  CalendarPlus, FilePlus2, ThumbsUp, ArrowRight,
} from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { payByName } from '../lib/pay.js';

// One employee, in the design Adama sent (20 Aug): who they are, the four
// facts that matter across the top, then Job, Salary, Quick actions,
// Attendance, Performance, Personal, Documents and Notes.
//
// 🔒 SALARY IS NOT IN THIS PAYLOAD. The card reads the payroll-gated endpoint
// separately, so a viewer without that power receives no figure to hide.

const CARD = 'card';
const D = (n) => 'D' + Number(n || 0).toLocaleString('en-US');
const day = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const tenure = (iso) => {
  const start = Date.parse(iso || '');
  if (isNaN(start)) return '';
  const months = Math.max(0, Math.round((Date.now() - start) / (30.44 * 86400000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? `${y}y ${m}m` : `${m}m`;
};
const STATUS = {
  active: ['Active', 'var(--color-pill-active-bg)', 'var(--color-pill-active)'],
  probation: ['Probation', 'var(--color-pill-probation-bg)', 'var(--color-pill-probation)'],
  leave: ['On leave', 'var(--color-pill-leave-bg)', 'var(--color-pill-leave)'],
  inactive: ['Inactive', 'var(--color-pill-inactive-bg)', 'var(--color-pill-inactive)'],
};
const TABS = ['Overview', 'Job & pay', 'Attendance', 'Performance', 'Documents', 'Notes', 'History'];

const Row = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 py-2.5">
    {Icon && <Icon size={15} className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]" />}
    <span className="w-[128px] shrink-0 text-[13px] text-[var(--color-ink-faint)]">{label}</span>
    <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{value || <span className="text-[var(--color-ink-ghost)]">—</span>}</span>
  </div>
);
const CardHead = ({ title, action }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 className="t-card">{title}</h2>
    {action}
  </div>
);
const linkish = 'inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-brand)] hover:underline';

export default function EmployeePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [pay, setPay] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [roster, setRoster] = useState([]);

  useEffect(() => {
    setD(null);
    api(`/hr/employee/${username}`).then(setD).catch((e) => setError(e.message));
  }, [username]);
  useEffect(() => {
    api('/hr/employees').then((r) => setRoster(r.employees || [])).catch(() => setRoster([]));
  }, []);
  useEffect(() => {
    if (!d?.employee?.name) return;
    payByName().then((m) => setPay(m[d.employee.name] || null)).catch(() => {});
  }, [d?.employee?.name]);

  // Previous / next walk the same order the Employees list is in.
  const { prev, next } = useMemo(() => {
    const i = roster.findIndex((e) => e.username === username);
    return { prev: i > 0 ? roster[i - 1] : null, next: i >= 0 && i < roster.length - 1 ? roster[i + 1] : null };
  }, [roster, username]);

  if (error) return <p className="text-[13px] text-[var(--color-stage-out)]">{error}</p>;
  if (!d) return <p className="text-[13px] text-[var(--color-ink-soft)]">Loading…</p>;

  const e = d.employee;
  const a = d.attendance;
  const [statusLabel, statusBg, statusInk] = STATUS[e.status] || STATUS.active;
  const initials = (e.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const netPay = pay ? (Number(pay.base) || 0) + (Number(pay.transport) || 0) + (Number(pay.commission) || 0) : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-2 text-[13px] text-[var(--color-ink-faint)]">
          <Link to="/people" className="hover:text-[var(--color-ink)]">Employees</Link>
          <ChevronRight size={14} />
          <span className="text-[var(--color-ink)]">{e.name}</span>
        </nav>
        <div className="flex items-center gap-2">
          <button disabled={!prev} onClick={() => prev && navigate(`/people/${prev.username}`)}
            className="btn-secondary flex h-[38px] w-[38px] items-center justify-center p-0 disabled:opacity-40"><ChevronLeft size={16} /></button>
          <button disabled={!next} onClick={() => next && navigate(`/people/${next.username}`)}
            className="btn-secondary flex h-[38px] w-[38px] items-center justify-center p-0 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* who they are, and the four facts worth knowing before anything else */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full bg-[#f2f4f8] text-[24px] font-semibold text-[#647086]">{initials}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="t-page">{e.name}</h1>
              <span className="inline-flex h-[25px] items-center rounded-full px-2.5 text-[12px] font-medium" style={{ background: statusBg, color: statusInk }}>{statusLabel}</span>
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
              {e.title || '—'}{e.department ? ` · ${e.department}` : ''}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-[var(--color-ink-soft)]">
              {e.email && <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-[var(--color-ink-faint)]" /> {e.email}</span>}
              {e.phone && <a href={`tel:${e.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-[var(--color-ink)]"><Phone size={14} className="text-[var(--color-ink-faint)]" /> {e.phone}</a>}
              {e.address && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-[var(--color-ink-faint)]" /> {e.address}</span>}
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
              Employee ID: {e.employeeId}
              {e.joined && <> · Joined {day(e.joined)} ({tenure(e.joined)})</>}
            </p>
          </div>
        </div>

        <div className={`${CARD} grid min-w-[320px] flex-1 grid-cols-2 gap-y-4 p-5 sm:grid-cols-4`}>
          {[
            ['Status', <span key="s" className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: statusInk }} />{statusLabel}</span>],
            ['Employment type', e.employment],
            ['Reports to', e.reportsTo || '—'],
            ['Work schedule', e.schedule],
          ].map(([label, value]) => (
            <div key={label} className="px-1">
              <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
              <p className="mt-1 text-[13px] font-medium text-[var(--color-ink)]">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3.5 pb-3 pt-1 text-[13px] font-medium ${tab === t ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className={`${CARD} p-5`}>
            <CardHead title="Job information" />
            <div className="divide-y divide-[var(--color-line-soft)]">
              <Row icon={Briefcase} label="Role" value={e.title} />
              <Row icon={Building2} label="Department" value={e.department} />
              <Row icon={FileText} label="Employment type" value={e.employment} />
              <Row icon={Clock} label="Work schedule" value={e.schedule} />
              <Row icon={UserRound} label="Reports to" value={e.reportsTo} />
              <Row icon={MapPin} label="Location" value={e.address} />
            </div>
          </div>

          {/* 🔒 Only rendered when the payroll endpoint actually returned a
              figure — a viewer without that power never receives one. */}
          <div className={`${CARD} p-5`}>
            <CardHead title="Salary information" />
            {pay ? (
              <>
                <div className="divide-y divide-[var(--color-line-soft)]">
                  <Row label="Base salary" value={D(pay.base)} />
                  <Row label="Allowances" value={D(pay.transport)} />
                  <Row label="Commission" value={D(pay.commission)} />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line)] pt-3">
                  <span className="text-[13px] text-[var(--color-ink-faint)]">Net pay</span>
                  <span className="text-[15px] font-semibold text-[var(--color-ink)]">{D(netPay)} <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">/ month</span></span>
                </div>
                <Link to="/payroll" className={`${linkish} mt-3`}>View payslips and payment history <ArrowRight size={14} /></Link>
              </>
            ) : (
              <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">Pay is only visible to payroll holders.</p>
            )}
          </div>

          <div className={`${CARD} p-5`}>
            <CardHead title="Quick actions" />
            <div className="grid grid-cols-2 gap-2.5">
              {[
                [Clock, 'Record attendance', '/attendance'],
                [CalendarPlus, 'Add leave', '/requests'],
                [MessageSquare, 'Coaching note', `/performance/${e.username}`],
                [FilePlus2, 'Add document', '/documents'],
              ].map(([Icon, label, to]) => (
                <Link key={label} to={to}
                  className="flex items-center gap-2.5 rounded-[8px] border border-[var(--color-line-control)] px-3 py-3 text-[13px] font-medium text-[var(--color-brand)] hover:bg-[var(--color-soft)]">
                  <Icon size={15} /> {label}
                </Link>
              ))}
              <Link to="/reviews" className="col-span-2 flex items-center justify-center gap-2.5 rounded-[8px] border border-[var(--color-line-control)] px-3 py-3 text-[13px] font-medium text-[var(--color-brand)] hover:bg-[var(--color-soft)]">
                <ThumbsUp size={15} /> Request feedback
              </Link>
            </div>
          </div>

          <div className={`${CARD} p-5`}>
            <CardHead title="Attendance summary" action={<span className="text-[12px] text-[var(--color-ink-faint)]">This month</span>} />
            <div className="grid grid-cols-5 gap-2">
              {[['Working days', a.workingDays, 'var(--color-ink)'], ['Present', a.present, 'var(--color-pill-active)'],
                ['Absent', a.absent, 'var(--color-stage-out)'], ['Late', a.late, 'var(--color-pill-leave)'],
                ['Leave', a.leave, 'var(--color-stage-new)']].map(([label, value, colour]) => (
                  <div key={label} className="rounded-[8px] border border-[var(--color-line-soft)] px-2 py-3 text-center">
                    <p className="text-[18px] font-semibold" style={{ color: colour }}>{value}</p>
                    <p className="mt-1 text-[11.5px] text-[var(--color-ink-faint)]">{label}</p>
                  </div>
                ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--color-line-soft)] pt-3">
              <span>
                <span className="block text-[12px] text-[var(--color-ink-faint)]">Hours worked</span>
                <span className="block text-[15px] font-semibold text-[var(--color-ink)]">{a.hours}h {a.minutes}m</span>
              </span>
              <span className="text-right">
                <span className="block text-[12px] text-[var(--color-ink-faint)]">Average check-in</span>
                <span className="block text-[15px] font-semibold text-[var(--color-ink)]">{a.avgCheckIn || '—'}</span>
              </span>
            </div>
            <Link to="/attendance" className={`${linkish} mt-3`}>View full attendance <ArrowRight size={14} /></Link>
          </div>

          <div className={`${CARD} p-5`}>
            <CardHead title="Performance overview" action={<span className="text-[12px] text-[var(--color-ink-faint)]">This month</span>} />
            {d.performance.score == null && !d.performance.sales && d.performance.attendancePct == null ? (
              <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">Nothing recorded for this month yet.</p>
            ) : (
              <div className="space-y-3.5">
                {d.performance.score != null && <Bar label="Review score" pct={d.performance.score} colour="var(--color-pill-active)" />}
                {d.performance.sales?.target ? (
                  <Bar label={`Sales · ${d.performance.sales.actual ?? 0} of ${d.performance.sales.target}`}
                    pct={Math.min(100, Math.round(((d.performance.sales.actual || 0) / d.performance.sales.target) * 100))}
                    colour="var(--color-stage-new)" />
                ) : null}
                {d.performance.attendancePct != null && <Bar label="Attendance" pct={d.performance.attendancePct} colour="var(--color-pill-probation)" />}
              </div>
            )}
            <Link to={`/performance/${e.username}`} className={`${linkish} mt-4`}>View performance details <ArrowRight size={14} /></Link>
          </div>

          <div className={`${CARD} p-5`}>
            <CardHead title="Personal information" />
            <div className="divide-y divide-[var(--color-line-soft)]">
              <Row label="Full name" value={e.name} />
              <Row label="Date of birth" value={e.dob} />
              <Row label="Gender" value={e.gender} />
              <Row label="Phone" value={e.phone} />
              <Row label="Email" value={e.email} />
              <Row label="Address" value={e.address} />
              <Row label="Nationality" value={e.nationality} />
              <Row label="Emergency contact" value={e.emergencyContact && `${e.emergencyContact}${e.emergencyPhone ? ` · ${e.emergencyPhone}` : ''}`} />
            </div>
          </div>

          <div className={`${CARD} p-5 xl:col-span-2`}>
            <CardHead title="Recent documents" action={<Link to="/documents" className="text-[13px] font-medium text-[var(--color-brand)] hover:underline">View all</Link>} />
            {d.documents.length === 0 && <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">No documents on file.</p>}
            <div className="divide-y divide-[var(--color-line-soft)]">
              {d.documents.map((f) => (
                <div key={f.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-stage-new-bg)] text-[var(--color-stage-new)]"><FileText size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[var(--color-ink)]">{f.name}</span>
                    <span className="block text-[12px] text-[var(--color-ink-faint)]">{Math.round((f.sizeBytes || 0) / 1024)} KB · {day(f.uploadedAt)}</span>
                  </span>
                  <a href={`/api/agent-files/${f.id}/download?t=${encodeURIComponent(getToken() || '')}`}
                    className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Download size={15} /></a>
                </div>
              ))}
            </div>
          </div>

          <div className={`${CARD} p-5`}>
            <CardHead title="Notes" action={<Link to={`/performance/${e.username}`} className="text-[13px] font-medium text-[var(--color-brand)] hover:underline">Add note</Link>} />
            {d.notes.length === 0 && <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">Nothing written down yet.</p>}
            <div className="space-y-3">
              {d.notes.map((n, i) => (
                <div key={i} className="rounded-[8px] bg-[var(--color-soft)] p-3">
                  <p className="flex items-center gap-2 text-[12px] text-[var(--color-ink-faint)]">
                    <Star size={12} className="text-[var(--color-pill-leave)]" /> {n.kind}{n.by ? ` · ${n.by}` : ''}{n.at ? ` · ${day(n.at)}` : ''}
                  </p>
                  <p className="mt-1.5 text-[13px] text-[var(--color-ink)]">{n.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab !== 'Overview' && (
        <div className={`${CARD} p-5`}>
          {tab === 'History' ? (
            <ol className="space-y-3">
              {d.history.map((h, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-line-control)]" />
                  <span>
                    <span className="block text-[13px] text-[var(--color-ink)]">{h.event}</span>
                    <span className="block text-[12px] text-[var(--color-ink-faint)]">{day(h.date)}</span>
                  </span>
                </li>
              ))}
              {d.history.length === 0 && <p className="text-[13px] text-[var(--color-ink-soft)]">Nothing recorded.</p>}
            </ol>
          ) : (
            <p className="py-2 text-[13px] text-[var(--color-ink-soft)]">
              {tab} lives on its own page.{' '}
              <Link to={tab === 'Documents' ? '/documents' : tab === 'Attendance' ? '/attendance' : tab === 'Notes' ? `/performance/${e.username}` : tab === 'Job & pay' ? '/payroll' : `/performance/${e.username}`}
                className="font-medium text-[var(--color-brand)] hover:underline">Open {tab.toLowerCase()}</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ label, pct, colour }) {
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
