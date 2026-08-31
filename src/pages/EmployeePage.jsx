import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, ChevronLeft, Mail, Phone, MapPin, Briefcase, Building2, Clock,
  CalendarDays, UserRound, FileText, ArrowRight,
} from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import AccessPanel from './employee/AccessPanel.jsx';
import { payByName } from '../lib/pay.js';
import { Attendance, Documents, Notes, History } from './employee/tabs.jsx';
import RoleChange from '../components/employee/RoleChange.jsx';
import Assignment from '../components/employee/Assignment.jsx';
import EndEmployment from '../components/employee/EndEmployment.jsx';
import LeaverFile from '../components/employee/LeaverFile.jsx';
import { PageSkeleton } from '../components/ui/Skeleton.jsx';

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
  // UTC pin: the company clock is Gambia. Without it a plain '1990-05-04'
  // parses as UTC midnight and renders as 3 May for a viewer in the US.
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
  // 🔒 Being built and being employed are different facts (Adama 30 Aug).
  pending: ['Pending completion', 'var(--color-pill-leave-bg)', 'var(--color-pill-leave)'],
  complete: ['Ready to activate', 'var(--color-stage-new-bg)', 'var(--color-stage-new)'],
  active: ['Active', 'var(--color-pill-active-bg)', 'var(--color-pill-active)'],
  probation: ['Probation', 'var(--color-pill-probation-bg)', 'var(--color-pill-probation)'],
  leave: ['On leave', 'var(--color-pill-leave-bg)', 'var(--color-pill-leave)'],
  inactive: ['Inactive', 'var(--color-pill-inactive-bg)', 'var(--color-pill-inactive)'],
};
const TABS = ['Overview', 'Job & pay', 'Attendance', 'Performance', 'Documents', 'Notes', 'History'];
// 🔴 Access is its own tab and its own GATE. The record opens with the `hr`
// power; assigning a role, changing the login email, resetting a password and
// pausing sign-in are `staffadmin`. Folding the old member page in here must
// not hand a wider audience the ability to reset somebody's password, so the
// tab is not offered at all without that power — and every control inside it
// still asks, and the server re-checks every write regardless.
const ACCESS_TAB = 'Access';

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
// A number, and the line that says what it is measured against. The sub-line
// carries the colour — a tile that shouts in red for a normal month teaches
// people to stop reading it (Adama 27 Aug: the page was "dim and boring", so
// the answer is contrast where it MEANS something, not colour everywhere).
const TONE = {
  good: 'var(--color-pill-active)',
  warn: 'var(--color-pill-leave)',
  bad: 'var(--color-stage-out)',
  muted: 'var(--color-ink-faint)',
};
const Tile = ({ label, value, sub, tone = 'muted' }) => (
  <div className={`${CARD} p-5`}>
    <p className="text-[12.5px] text-[var(--color-ink-soft)]">{label}</p>
    <p className="mt-2 text-[26px] font-semibold leading-none text-[var(--color-ink)]">{value}</p>
    <p className="mt-2 text-[12px] font-medium" style={{ color: TONE[tone] }}>{sub}</p>
  </div>
);
const GENDERS = ['', 'Female', 'Male'];
const MARITAL = ['', 'Single', 'Married', 'Divorced', 'Widowed'];

// One row while the card is being edited. Rows without a `key` are owned
// somewhere else (a name, a login email, a contract) and stay as facts.
function EditRow({ row, value, onChange }) {
  const Icon = row.icon;
  return (
    <div className="flex items-center gap-3 py-2">
      {Icon ? <Icon size={15} className="shrink-0 text-[var(--color-ink-faint)]" /> : <span className="w-[15px] shrink-0" />}
      <label className="w-[128px] shrink-0 text-[13px] text-[var(--color-ink-faint)]">{row.label}</label>
      {row.options ? (
        <select className="field min-w-0 flex-1" value={value} onChange={(ev) => onChange(ev.target.value)}>
          {row.options.map((o) => <option key={o || 'blank'} value={o}>{o || '—'}</option>)}
        </select>
      ) : (
        <input className="field min-w-0 flex-1" type={row.type || 'text'} value={value}
          placeholder={row.placeholder || ''} onChange={(ev) => onChange(ev.target.value)} />
      )}
    </div>
  );
}

// A card you edit where it is shown, rather than travelling to a form and back
// (DESIGN.md, "Quick editing"). Edit turns the card's own rows into fields;
// Save sends ONLY what actually changed, so an untouched field is never
// rewritten and never lands on the person's History.
function EditableCard({ title, rows, canEdit, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = rows.filter((r) => r.key);

  function open() {
    setDraft(Object.fromEntries(fields.map((r) => [r.key, r.raw ?? ''])));
    setError('');
    setEditing(true);
  }
  async function save() {
    const changed = {};
    for (const r of fields) if ((draft[r.key] ?? '') !== (r.raw ?? '')) changed[r.key] = draft[r.key] ?? '';
    if (!Object.keys(changed).length) { setEditing(false); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(changed);
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${CARD} p-5`}>
      <CardHead title={title} action={canEdit && !editing
        ? <button type="button" onClick={open} className="text-[13px] font-medium text-[var(--color-brand)] hover:underline">Edit</button>
        : null} />
      <div className="divide-y divide-[var(--color-line-soft)]">
        {rows.map((r) => (editing && r.key
          ? <EditRow key={r.label} row={r} value={draft[r.key] ?? ''} onChange={(v) => setDraft((st) => ({ ...st, [r.key]: v }))} />
          : <Row key={r.label} icon={r.icon} label={r.label} value={r.value} />))}
      </div>
      {editing && (
        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          {/* The failure shows where it happened, not as a toast that leaves. */}
          {error && <p className="mb-3 text-[13px] text-[var(--color-stage-out)]">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="btn-secondary disabled:opacity-60">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmployeePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [pay, setPay] = useState(null);
  // A link can ask for a tab (Team & access sends people straight to Access).
  // 🔴 Read it from the router, not window — the render check runs server-side
  // and `window` is not defined there.
  const [search] = useSearchParams();
  const wantTab = search.get('tab');
  const [tab, setTab] = useState(
    wantTab && [...TABS, ACCESS_TAB].includes(wantTab) ? wantTab : 'Overview',
  );
  const [roster, setRoster] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  // 🔴 The work email is read-only on a record because it is the login, and a
  // login is changed on Team & access. But a record that has never been
  // activated is not ON Team & access — so "Activate — needs a work email"
  // named the blocker and led nowhere (Adama 30 Aug: "where am i putting the
  // work email?"). While it is a draft it is set here, at the point of the
  // block, because that is the only moment it cannot be set anywhere else.
  const [workEmail, setWorkEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [payEdit, setPayEdit] = useState(null);
  const [payErr, setPayErr] = useState('');
  const { realUser, isViewAs, hasRealPower } = useAuth();
  const canSeeAccess = hasRealPower('staffadmin') && !isViewAs;
  // The Edit affordance only appears for someone who can actually save — the
  // server re-checks every write regardless, and view-as stays read-only.
  const canEditRecord = !!realUser?.canRecordsEdit && !isViewAs;
  const canMoveDepartment = !!realUser?.canMoveDepartment && !isViewAs;
  // Correcting pay is a payroll act, not an HR one: the same power that may see
  // the figure is the only one that may change it.
  const canPayEdit = !!realUser?.canPayEdit && !isViewAs;

  async function savePay() {
    setPayErr('');
    try {
      await api(`/hr/employee/${username}/pay`, { method: 'PATCH', body: payEdit });
      // Re-read from the payroll endpoint rather than trusting the form: the
      // server decides what was stored.
      const m = await payByName(true);
      setPay(m[d?.employee?.name] || null);
      setPayEdit(null);
    } catch (err) {
      setPayErr(err.message || 'Could not save that');
    }
  }

  // Department keeps its own Manage-staff endpoint and its own history line:
  // it moves the sales goal and the leaderboard, so it never rides along in
  // the HR write.
  async function saveRecord(fields) {
    const { department, ...rest } = fields;
    if (department !== undefined) await api(`/staff/${username}/department`, { method: 'POST', body: { department } });
    if (Object.keys(rest).length) await api(`/hr/employee/${username}`, { method: 'PATCH', body: { fields: rest } });
    setD(await api(`/hr/employee/${username}`));
  }

  // One place to re-read the record after a write, so a document that was
  // deleted or added does not leave a stale list on screen.
  async function saveWorkEmail() {
    setSavingEmail(true);
    setError(null);
    try {
      await api(`/staff/${username}/draft`, { method: 'PUT', body: { email: workEmail.trim() } });
      await refreshRecord();
      setWorkEmail('');
    } catch (err) { setError(err.message); }
    finally { setSavingEmail(false); }
  }

  async function activate() {
    setActivating(true);
    try { await api(`/staff/${username}/activate`, { method: 'POST', body: {} }); await refreshRecord(); }
    catch (err) { setError(err.message); }
    finally { setActivating(false); }
  }

  async function refreshRecord() {
    setD(await api(`/hr/employee/${username}`));
  }

  async function uploadDocument(file) {
    if (!file || !d?.employee) return;
    setUploading(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',').pop());
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await api('/agent-files', { method: 'POST', body: { agent: d.employee.name, name: file.name, mimeType: file.type, base64, category: 'document' } });
      const fresh = await api(`/hr/employee/${username}`);
      setD(fresh);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    setD(null);
    api(`/hr/employee/${username}`).then(setD).catch((e) => setError(e.message));
  }, [username]);
  useEffect(() => {
    api('/hr/employees').then((r) => setRoster(r.employees || [])).catch(() => setRoster([]));
    api('/departments').then((r) => setDepartments(r.departments || [])).catch(() => setDepartments([]));
    // Owner-only to read; anyone else simply gets no access-role picker on a
    // role change rather than an error.
    api('/roles').then((r) => setRoles(r.roles || [])).catch(() => setRoles([]));
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
  if (!d) return <PageSkeleton tiles={3} rows={5} />;

  const e = d.employee;
  const a = d.attendance;
  // 🔑 `actual: null` means admin has no count for this month — it is NOT a
  // zero, and rendering it as one would tell Adama someone sold nothing.
  const sales = d.performance?.sales || null;
  // 🔴 AN UNKNOWN STATUS IS NOT "ACTIVE". This fell back to STATUS.active, so a
  // record that was merely COMPLETE showed a green Active badge on somebody
  // Adama had never activated (30 Aug: "it's active but i have not activated
  // it"). A default that means "fully employed" is the worst possible guess:
  // it is the one answer that cannot be walked back by looking at the page.
  const [statusLabel, statusBg, statusInk] = STATUS[e.status]
    || [e.status || 'Unknown', 'var(--color-pill-inactive-bg)', 'var(--color-pill-inactive)'];
  const isDraftRecord = e.status === 'pending' || e.status === 'complete';
  // Someone who has left keeps their record, but it stops being editable: the
  // server refuses a write to an archived record, so an Edit button here could
  // only fail. Offboarding is the exception and stays open below.
  const canEditActive = canEditRecord && e.status !== 'inactive';
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
          {/* Leaving is a thing that happens to a person, so the action is on
              the person — not buried in a contracts tab somewhere else. */}
          {/* 🔒 The end of the process, where he is standing when the signed
              contract comes back. Only offered once the record is complete —
              activating a half-built record is what the two states exist to
              prevent. */}
          {e.status === 'complete' && e.email && (
            <button onClick={activate} disabled={activating}
              className="btn-primary disabled:opacity-60">{activating ? 'Activating…' : 'Activate'}</button>
          )}
          {canEditActive && !isDraftRecord && !endOpen && (
            <button onClick={() => setEndOpen(true)}
              className="btn-secondary text-[var(--color-stage-out)]">End employment</button>
          )}
          <button disabled={!prev} onClick={() => prev && navigate(`/people/${prev.username}`)}
            className="btn-secondary flex h-[38px] w-[38px] items-center justify-center p-0 disabled:opacity-40"><ChevronLeft size={16} className="shrink-0" /></button>
          <button disabled={!next} onClick={() => next && navigate(`/people/${next.username}`)}
            className="btn-secondary flex h-[38px] w-[38px] items-center justify-center p-0 disabled:opacity-40"><ChevronRight size={16} className="shrink-0" /></button>
        </div>
      </div>

      {/* who they are, and the four facts worth knowing before anything else */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[24px] font-semibold text-[var(--color-ink-soft)]">{initials}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="t-page">{e.name}</h1>
              <span className="inline-flex h-[25px] items-center rounded-full px-2.5 text-[12px] font-medium" style={{ background: statusBg, color: statusInk }}>{statusLabel}</span>
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
              {e.title || '—'}{e.department ? ` · ${e.department}` : ''}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-[var(--color-ink-soft)]">
              {/* 🔒 WHICH EMAIL MATTERS DEPENDS ON WHETHER THEY STILL WORK
                  HERE (Adama 28 Aug): "the work email is only used when he
                  works with us for getting into our systems, but when fired his
                  personal email trumps always". The work address is a key to
                  our systems and it is switched off on the last day, so after
                  that it is the wrong address to reach anyone about final pay,
                  a reference or their documents. */}
              {e.status === 'inactive' ? (
                e.personalEmail ? (
                  <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-[var(--color-ink-faint)]" /> {e.personalEmail} <span className="text-[12px] text-[var(--color-ink-faint)]">personal</span></span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[var(--color-stage-out)]"><Mail size={14} /> No personal email on file</span>
                )
              ) : (
                e.email && <span className="inline-flex items-center gap-1.5"><Mail size={14} className="text-[var(--color-ink-faint)]" /> {e.email}</span>
              )}
              {e.phone && <a href={`tel:${e.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-[var(--color-ink)]"><Phone size={14} className="text-[var(--color-ink-faint)]" /> {e.phone}</a>}
              {e.address && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-[var(--color-ink-faint)]" /> {e.address}</span>}
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
              Employee ID: {e.employeeId}
              {e.joined && <> · Joined {day(e.joined)} ({tenure(e.joined)})</>}
            </p>
            {/* 🔒 No company email, no activation. The field sits here in the
                identity block, under the Employee ID, because this address IS
                part of who they are in our systems (Adama 31 Aug: "something
                subtle") — not a page-level action in the header. */}
            {e.status === 'complete' && !e.email && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-[var(--color-ink-faint)]">Work email</span>
                <input
                  value={workEmail}
                  onChange={(ev) => setWorkEmail(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' && workEmail.trim()) saveWorkEmail(); }}
                  placeholder="name@damiatracker.com"
                  className="field h-[32px] w-[220px] text-[12px]"
                  aria-label="Work email"
                />
                <button onClick={saveWorkEmail} disabled={savingEmail || !workEmail.trim()}
                  className="btn-secondary h-[32px] px-3 text-[12px] disabled:opacity-50">
                  {savingEmail ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* The four facts you need before reading anything else. A flat band,
            not four boxes — the facts are the content, the card is not. */}
        <div className={`${CARD} grid min-w-[320px] flex-1 grid-cols-2 gap-y-4 p-5 sm:grid-cols-4`}>
          {[
            ['Reports to', e.reportsTo || '—'],
            ['Schedule', e.schedule],
            ['Employment', e.employment],
            ['Location', e.location || '—'],
          ].map(([label, value]) => (
            <div key={label} className="px-1">
              <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
              <p className="mt-1 text-[13px] font-medium text-[var(--color-ink)]">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* An exit outranks every tab below it: it changes what the whole record
          means, so it is not something to go and find. */}
      <EndEmployment employee={e} canEdit={canEditRecord} open={endOpen}
        onClose={() => setEndOpen(false)} onDone={refreshRecord} />

      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
        {[...TABS, ...(canSeeAccess ? [ACCESS_TAB] : [])].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3.5 pb-3 pt-1 text-[13px] font-medium ${tab === t ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* 🔒 A LEAVER'S OVERVIEW IS THEIR FILE, not a dashboard of a month they
          were not here for. The live record answers "how is this person doing";
          a closed one answers "how long were they here, did they finish the
          term, why did it end, and is anything outstanding". */}
      {tab === 'Overview' && (d.leaverFile
        ? <LeaverFile file={d.leaverFile} e={e} notes={d.notes || []} documents={d.documents || []} onTab={setTab} />
        : <OverviewTab d={d} e={e} a={a} sales={sales} pay={pay} netPay={netPay}
            statusLabel={statusLabel} statusInk={statusInk} onTab={setTab}
            canEdit={canEditActive} onSave={saveRecord} />
      )}

      {tab === 'Job & pay' && (
        <div className="space-y-4">
          <JobPayTab e={e} d={d} pay={pay} netPay={netPay} roster={roster}
            departments={departments} canEdit={canEditActive}
            canMoveDepartment={canMoveDepartment} onSave={saveRecord}
            canPayEdit={canPayEdit} payEdit={payEdit} setPayEdit={setPayEdit}
            payErr={payErr} savePay={savePay} />
          {/* A role change is an EVENT with a date and a reason, not a title
              typed over another one — so it sits under the terms it changes. */}
          <RoleChange employee={e} departments={departments} roster={roster} roles={roles}
            canEdit={canEditActive} onDone={refreshRecord} />
          {/* The role is the role; the assignment sits UNDER it — what they
              are told to do for a period, and what they are judged on while
              they do it. It changes no title, no pay and no permission. */}
          <Assignment employee={e} canEdit={canEditActive} onDone={refreshRecord} />
        </div>
      )}

      {/* The tab owns its own month (Adama 27 Aug): it fetches the month it
          is showing, so the arrows move the DATA and not just the grid. */}
      {tab === 'Attendance' && <Attendance username={username} />}
      {/* 🔒 The KPIs come from scorecardFor on the server — the same builder
          My Progress and the team-member card use — so this tab cannot
          invent its own targets. The hand-typed score is deliberately NOT
          here (Adama 27 Aug: performance is driven by actual KPIs). */}
      {tab === 'Performance' && (
        <PerformanceTab d={d} e={e} a={a} sales={sales} />
      )}
      {tab === 'Documents' && (
        <Documents documents={d.documents} onUpload={uploadDocument} uploading={uploading}
          canDelete={!!realUser?.canDocsDelete && !isViewAs} onChanged={refreshRecord} />
      )}
      {tab === 'Notes' && <Notes notes={d.notes} username={e.username} />}
      {tab === ACCESS_TAB && canSeeAccess && <AccessPanel username={username} onChanged={refreshRecord} />}
      {tab === 'History' && <History history={d.history} />}

    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────
// Exported so the tab test can render it with real data: this is the tab
// that opens by default, and a crash here is a blank record.
export function OverviewTab({ d, e, a, sales, pay, netPay, statusLabel, statusInk, onTab, canEdit, onSave }) {
  return (

        <div className="space-y-4">
          <div>
            <h2 className="t-card">Employee overview</h2>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">One connected view of work, attendance, pay and employment status.</p>
          </div>

          {/* The month in four numbers. Each carries a line saying what it is
              measured against, so a figure is never a number on its own. */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Tile
              label="Sales this month"
              value={sales ? (sales.actual == null ? '—' : `${sales.actual} / ${sales.target ?? '—'}`) : '—'}
              sub={sales
                ? (sales.actual == null
                  ? 'not counted for this month'
                  : sales.target ? `${Math.round((sales.actual / sales.target) * 100)}% of target` : 'no target set')
                : 'not a sales role'}
              tone={sales && sales.actual != null && sales.target && sales.actual >= sales.target ? 'good' : 'muted'}
            />
            <Tile
              label="Attendance"
              value={a.ratePct == null ? '—' : `${a.ratePct}%`}
              sub={a.ratePct == null ? 'nothing recorded yet' : `${a.present} present · ${a.absent} absent`}
              tone={a.ratePct == null ? 'muted' : a.ratePct >= 90 ? 'good' : 'warn'}
            />
            <Tile
              label="Hours worked"
              value={`${a.hours}h ${String(a.minutes).padStart(2, '0')}m`}
              sub={a.missingCheckouts
                ? `${a.missingCheckouts} ${a.missingCheckouts === 1 ? 'record needs' : 'records need'} review`
                : 'recorded'}
              tone={a.missingCheckouts ? 'bad' : 'muted'}
            />
            {/* 🔒 Rendered only when the payroll-gated endpoint returned a
                figure — a viewer without that power never receives one. */}
            <Tile
              label={pay ? 'Current pay' : 'Pay'}
              value={pay ? D(netPay) : '—'}
              sub={pay ? 'base + commission' : 'payroll holders only'}
              tone="muted"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className={`${CARD} p-5`}>
                <CardHead title="What needs attention" />
                {d.attention.length === 0 ? (
                  <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">
                    Nothing needs a decision on this record right now.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-line-soft)]">
                    {d.attention.map((it, i) => (
                      <div key={i} className="flex flex-wrap items-start gap-3 py-3 first:pt-0">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: it.tone === 'bad' ? 'var(--color-stage-out)' : 'var(--color-pill-leave)' }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-[var(--color-ink)]">{it.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-[var(--color-ink-soft)]">{it.detail}</span>
                        </span>
                        <button onClick={() => onTab(it.tab)} className={linkish}>
                          {it.action} <ArrowRight size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${CARD} p-5`}>
                <CardHead title="Recent employee activity" />
                {d.history.length === 0 ? (
                  <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">
                    Nothing has changed on this record yet. Edits and status changes appear here.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-line-soft)]">
                    {d.history.slice(0, 5).map((h, i) => (
                      <div key={i} className="flex items-baseline gap-4 py-2.5 first:pt-0">
                        <span className="w-[86px] shrink-0 text-[12px] text-[var(--color-ink-faint)]">{day(h.date)}</span>
                        <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{h.event}</span>
                      </div>
                    ))}
                  </div>
                )}
                {d.history.length > 5 && (
                  <button onClick={() => onTab('History')} className={`${linkish} mt-3`}>
                    See full history <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className={`${CARD} p-5`}>
                <CardHead title="Employment" />
                <div className="divide-y divide-[var(--color-line-soft)]">
                  <Row label="Role" value={e.title} />
                  <Row label="Manager" value={e.reportsTo} />
                  <Row label="Status" value={<span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: statusInk }} />{statusLabel}</span>} />
                  <Row label="Employment" value={e.employment} />
                </div>
              </div>

              <div className={`${CARD} p-5`}>
                <CardHead title="This month at a glance" />
                <div className="divide-y divide-[var(--color-line-soft)]">
                  {[
                    ['Present', `${a.present} ${a.present === 1 ? 'day' : 'days'}`, 'var(--color-pill-active)'],
                    ['Late', a.late, 'var(--color-pill-leave)'],
                    ['Absent', a.absent, 'var(--color-stage-out)'],
                    ['Sales', sales ? (sales.actual == null ? '—' : sales.actual) : '—', 'var(--color-brand)'],
                  ].map(([label, value, colour]) => (
                    <div key={label} className="flex items-center justify-between py-2.5">
                      <span className="text-[13px] text-[var(--color-ink-faint)]">{label}</span>
                      <span className="text-[13px] font-semibold" style={{ color: colour }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Kept editable here: this is the profile view, and Job & pay
                  deliberately does not repeat personal information. */}
              <EditableCard title="Personal information" canEdit={canEdit} onSave={onSave} rows={[
                // Not editable: every profile, review, sale, document and
                // warning in Pulse is filed under this name — renaming here
                // would orphan all of them. A name change is Manage-staff work.
                { label: 'Full name', value: e.name },
                { label: 'Date of birth', key: 'dob', type: 'date', raw: e.dob || '', value: e.dob ? day(e.dob) : '' },
                { label: 'Gender', key: 'gender', options: GENDERS, raw: e.gender, value: e.gender },
                { label: 'Marital status', key: 'maritalStatus', options: MARITAL, raw: e.maritalStatus, value: e.maritalStatus },
                { label: 'Phone', key: 'phone', type: 'tel', raw: e.phone, value: e.phone },
                // The work email is the login. It changes on Team & access,
                // where the CEO grant lives.
                { label: 'Email', value: e.email },
                { label: 'Address', key: 'address', raw: e.address, value: e.address },
                // Contact on file, never a sign-in. It used to be settable only
                // on the access page, which no longer exists.
                { label: 'Personal email', key: 'personalEmail', type: 'email', raw: e.personalEmail || '', value: e.personalEmail },
                { label: 'Nationality', key: 'nationality', raw: e.nationality, value: e.nationality },
                { label: 'Emergency contact', key: 'emergencyContact', raw: e.emergencyContact, value: e.emergencyContact },
                { label: 'Emergency phone', key: 'emergencyPhone', type: 'tel', raw: e.emergencyPhone, value: e.emergencyPhone },
              ]} />
            </div>
          </div>
        </div>
  );
}


// ── Job & pay tab ─────────────────────────────────────────────────────
// Employment stays EDITABLE here — this is where the job facts live, and
// losing Edit would undo the quick editing he asked for.
export function JobPayTab({ e, d, pay, netPay, roster, departments, canEdit, canMoveDepartment, onSave, canPayEdit, payEdit, setPayEdit, payErr, savePay }) {
  return (

        <div className="space-y-4">
          <div>
            <h2 className="t-card">Job &amp; pay</h2>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Employment terms and compensation, without repeating profile information.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <EditableCard title="Employment" canEdit={canEdit} onSave={onSave} rows={[
              { label: 'Role', icon: Briefcase, key: 'title', raw: e.title, value: e.title },
              // Only offered to a Manage-staff holder — the one row on this
              // card that is not the HR grant's to change.
              { label: 'Department', icon: Building2, key: canMoveDepartment ? 'department' : undefined, options: departments, raw: e.department, value: e.department },
              { label: 'Reports to', icon: UserRound, key: 'manager', options: ['', ...roster.filter((r) => r.name !== e.name).map((r) => r.name)], raw: e.reportsTo, value: e.reportsTo },
              // Decided by the contract actions, never typed.
              { label: 'Employment type', icon: FileText, value: e.employment },
              { label: 'Work schedule', icon: Clock, key: 'schedule', raw: e.schedule, value: e.schedule },
              { label: 'Location', icon: MapPin, key: 'location', raw: e.location, value: e.location, placeholder: 'Office, site or town' },
              { label: 'Employee ID', icon: FileText, key: 'employeeId', raw: e.employeeId, value: e.employeeId },
              { label: 'Start date', icon: CalendarDays, key: 'joined', type: 'date', raw: e.joined || '', value: e.joined ? day(e.joined) : '' },
              // Editable because a fixed term gets EXTENDED, and until now
              // there was nowhere to record that — so an extended contract
              // silently read as permanent (Adama 28 Aug, Sally). Blank means
              // no end date; a date means fixed term, and the employment type
              // follows from it everywhere.
              { label: 'Contract ends', icon: FileText, key: 'contractEnd', type: 'date', raw: e.contractEnd || '', value: e.contractEnd ? day(e.contractEnd) : 'No end date' },
              ...(e.left ? [{ label: 'Employment ended', icon: FileText, raw: e.left, value: `${day(e.left)}${e.leftReason ? ` · ${e.leftReason}` : ''}` }] : []),
            ]} />
            <div className="space-y-4">
              {/* 🔒 Only rendered when the payroll endpoint actually returned
                  a figure — a viewer without that power never receives one. */}
              <div className={`${CARD} p-5`}>
                {/* 🔑 Pay was typed once when the person was created and could
                    never be corrected. A record saying D6,000 against a signed
                    letter saying D7,000 was quoted, identically and
                    confidently, by payroll, this card and the exit settlement.
                    Editable here, by payroll holders, so a correction lands in
                    all three at once. */}
                <CardHead title="Compensation" action={pay && canPayEdit && !payEdit && (
                  <button onClick={() => setPayEdit({ base: pay.base || 0, transport: pay.transport || 0, commission: pay.commission || 0 })}
                    className="text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">Edit</button>
                )} />
                {pay && payEdit ? (
                  <div className="space-y-3">
                    {[['Base salary', 'base'], ['Allowances', 'transport'], ['Commission', 'commission']].map(([label, key]) => (
                      <label key={key} className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-[var(--color-ink-faint)]">{label}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px] text-[var(--color-ink-soft)]">D</span>
                          <input type="text" inputMode="numeric" className="field w-32 text-right" value={payEdit[key]}
                            onChange={(ev) => setPayEdit((c) => ({ ...c, [key]: ev.target.value.replace(/[^\d]/g, '') }))} />
                        </span>
                      </label>
                    ))}
                    <p className="text-[11.5px] text-[var(--color-ink-faint)]">
                      From the signed contract. Base plus allowances is the guaranteed monthly pay, and is what payroll and a final settlement use. Commission is on-target only and is never included automatically.
                    </p>
                    {payErr && <p className="text-[12.5px] text-[var(--color-stage-out)]">{payErr}</p>}
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setPayEdit(null); setPayErr(''); }} className="btn-secondary">Cancel</button>
                      <button onClick={savePay} className="btn-primary">Save</button>
                    </div>
                  </div>
                ) : pay ? (
                  <>
                    <div className="divide-y divide-[var(--color-line-soft)]">
                      <Row label="Base salary" value={`${D(pay.base)} / month`} />
                      <Row label="Allowances" value={D(pay.transport)} />
                      <Row label="Commission" value={D(pay.commission)} />
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-[var(--color-line)] pt-3">
                      <span className="text-[13px] text-[var(--color-ink-faint)]">Current net pay</span>
                      <span className="text-[15px] font-semibold text-[var(--color-ink)]">{D(netPay)} <span className="text-[12px] font-normal text-[var(--color-ink-faint)]">/ month</span></span>
                    </div>
                    <Link to="/payroll" className={`${linkish} mt-3`}>View payslips &amp; payment history <ArrowRight size={14} /></Link>
                  </>
                ) : (
                  <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">Pay is only visible to payroll holders.</p>
                )}
              </div>
              <div className={`${CARD} p-5`}>
                <CardHead title="Contract" />
                <div className="divide-y divide-[var(--color-line-soft)]">
                  <Row label="Type" value={d.contract.type} />
                  <Row label="Start date" value={d.contract.start ? day(d.contract.start) : ''} />
                  <Row label="End date" value={d.contract.end ? day(d.contract.end) : 'No end date'} />
                  {/* 🔑 Two different facts. The term he signed ran to 19 Nov;
                      he left on 28 Aug. Overwriting one with the other loses
                      the question "did they finish the term". */}
                  {d.contract.endedOn && (
                    <Row label="Employment ended" value={<span className="text-[var(--color-stage-out)]">{day(d.contract.endedOn)}{d.contract.endedWhy ? ` · ${d.contract.endedWhy}` : ''}</span>} />
                  )}
                  <Row label="Notice period" value={d.contract.noticePeriod} />
                  <Row label="Document" value={d.contract.document
                    ? <a href={`/api/agent-files/${d.contract.document.id}/download?t=${encodeURIComponent(getToken() || '')}`} className={linkish}><FileText size={14} /> {d.contract.document.name}</a>
                    : ''} />
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}

// ── Performance tab ───────────────────────────────────────────────────
// Adama 27 Aug: "performance is driven by actual KPIs — not a separate
// manual score." So this reads the person's ROLE scorecard (the same
// scorecardFor the server builds for My Progress and the team-member card)
// and shows each KPI against its target.
//
// 🔑 A KPI with `actual: null` has no feed in Pulse yet. It is shown, named,
// and marked "not measured yet" — never drawn as a 0% bar, which would read
// as failing at something nobody is tracking.
export function PerformanceTab({ d, e, a, sales }) {
  const kpis = d.scorecard?.kpis || [];
  const pctOf = (k) => (k.target ? Math.min(100, Math.round((k.actual / k.target) * 100)) : null);
  const measured = kpis.filter((k) => k.actual != null);
  const behindList = measured.filter((k) => pctOf(k) < 100);
  const status = !measured.length
    ? ['No KPIs measured yet', 'muted', 'nothing feeds this role yet']
    : behindList.length === 0
      ? ['On track', 'good', `${measured.length} of ${measured.length} KPIs at target`]
      : ['Needs attention', 'bad', `${behindList.length} of ${measured.length} ${behindList.length === 1 ? 'KPI' : 'KPIs'} below target`];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="t-card">Performance · this month</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          Driven by the KPIs set for this role, not a separate hand-typed score.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className={`${CARD} p-5`}>
          <p className="text-[12.5px] text-[var(--color-ink-soft)]">Overall status</p>
          <p className="mt-2 text-[19px] font-semibold leading-tight" style={{ color: TONE[status[1]] }}>{status[0]}</p>
          <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">{status[2]}</p>
        </div>
        <Tile label="Sales"
          value={sales ? (sales.actual == null ? '—' : `${sales.actual} / ${sales.target ?? '—'}`) : '—'}
          sub={sales
            ? (sales.actual == null ? 'not counted for this month'
              : sales.target ? `${Math.round((sales.actual / sales.target) * 100)}% of target` : 'no target set')
            : 'not a sales role'}
          tone={sales && sales.actual != null && sales.target && sales.actual >= sales.target ? 'good' : 'muted'} />
        <Tile label="Attendance"
          value={a.ratePct == null ? '—' : `${a.ratePct}%`}
          sub={a.ratePct == null ? 'nothing recorded yet' : a.ratePct >= 90 ? 'at target' : 'below the 90% target'}
          tone={a.ratePct == null ? 'muted' : a.ratePct >= 90 ? 'good' : 'warn'} />
        <Tile label="Review score"
          value={d.performance.averageReview == null ? '—' : String(d.performance.averageReview)}
          sub={d.performance.reviews?.length
            ? `average of ${d.performance.reviews.length} ${d.performance.reviews.length === 1 ? 'review' : 'reviews'}`
            : 'no reviews written yet'}
          tone="muted" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-5`}>
          <CardHead title="KPI progress" action={<span className="text-[12px] text-[var(--color-ink-faint)]">{d.scorecard?.role || ''}</span>} />
          {kpis.length === 0 ? (
            <p className="py-4 text-[13px] text-[var(--color-ink-soft)]">
              No KPIs are set for this role yet. They are defined on KPI Targets.
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-line-soft)]">
              {kpis.map((k) => {
                const pct = k.actual == null ? null : pctOf(k);
                const colour = pct == null ? 'var(--color-line)'
                  : pct >= 100 ? 'var(--color-pill-active)'
                    : pct >= 60 ? 'var(--color-pill-leave)' : 'var(--color-stage-out)';
                return (
                  <div key={k.key} className="py-3 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-[var(--color-ink)]">{k.label}</span>
                      <span className="text-[12.5px] text-[var(--color-ink-soft)]">
                        {k.actual == null
                          ? <span className="text-[var(--color-ink-faint)]">not measured yet</span>
                          : <>{k.actual}{k.kind === 'percent' ? '%' : ''} <span className="text-[var(--color-ink-faint)]">of {k.target}{k.kind === 'percent' ? '%' : ''}</span></>}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-[var(--color-line-soft)]">
                      {pct != null && <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: colour }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`${CARD} p-5`}>
          <CardHead title="Manager coaching" />
          {behindList.length > 0 && (
            <>
              <p className="text-[12px] text-[var(--color-ink-faint)]">Recommended focus</p>
              <p className="mt-1 text-[13px] font-medium text-[var(--color-ink)]">
                {behindList.map((k) => k.label).join(', ')}.
              </p>
            </>
          )}
          <p className={`text-[12px] text-[var(--color-ink-faint)] ${behindList.length > 0 ? 'mt-4' : ''}`}>Last note</p>
          {d.notes.length === 0 ? (
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">No coaching note yet.</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-[var(--color-ink)]">{d.notes[0].text}</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-faint)]">
                {d.notes[0].by}{d.notes[0].at ? ` · ${day(d.notes[0].at)}` : ''}
              </p>
            </>
          )}
          <Link to={`/performance/${e.username}`} className={`${linkish} mt-4`}>
            Add coaching note <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
