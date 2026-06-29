import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Upload, Download, FileText, AlertTriangle, CheckCircle2, Circle, RefreshCw, CalendarPlus, BadgeCheck, UserX, X, Trash2 } from 'lucide-react';
import { team } from '../data/team';
import { api } from '../lib/api.js';

// Employee Profile — a real HR profile, not a spreadsheet row. Phase 1:
// Overview (employment + editable personal/contact), Documents (agent-files),
// Performance (reviews + warnings), Activity (timeline). Everything is real
// data; personal fields are editable and show "Not set" until filled — never
// faked. (24 Jun 2026, Adama.)

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Human-readable line for a contract action, used in the History timeline.
function contractEventText(e) {
  const end = e.toEnd ? formatDate(e.toEnd) : 'no end date';
  if (e.action === 'renew') return `Contract renewed — ${e.toType || 'fixed term'}, now ending ${end}`;
  if (e.action === 'extend') return `Contract extended to ${end}`;
  if (e.action === 'convert') return `Converted to permanent (${e.toType || 'Permanent'})`;
  if (e.action === 'terminate') return `Contract terminated — ${e.reason || 'no reason given'}`;
  return e.action;
}

const ACTION_TITLES = { renew: 'Renew contract', extend: 'Extend contract', convert: 'Convert to permanent', terminate: 'Terminate contract' };
const ACTION_CONFIRM = { renew: 'Renew', extend: 'Extend', convert: 'Convert', terminate: 'Terminate & deactivate' };

function Field({ label, value, accent }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-medium ${accent || 'text-gray-900'}`}>{value || <span className="text-gray-300 font-normal">Not set</span>}</p>
    </div>
  );
}

const PERSONAL = [
  ['phone', 'Phone'], ['email', 'Email'], ['manager', 'Manager'],
  ['emergencyContact', 'Emergency contact'], ['emergencyPhone', 'Emergency phone'],
  ['address', 'Address'], ['nextReview', 'Next review'],
];

export default function EmployeeProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const agent = team.find((t) => t.name.toLowerCase().replace(/\s+/g, '-') === slug);

  const [tab, setTab] = useState('overview');
  const [profile, setProfile] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [review, setReview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [checklist, setChecklist] = useState({ onboarding: [], offboarding: [] });
  const [contract, setContract] = useState(null);
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');

  useEffect(() => {
    if (!agent) return;
    const n = encodeURIComponent(agent.name);
    api(`/employee-profile?name=${n}`).then(d => { setProfile(d.profile || {}); setDraft(d.profile || {}); }).catch(() => {});
    api(`/agent-files?agent=${n}`).then(d => setFiles(d.files || [])).catch(() => setFiles([]));
    api(`/warnings?agent=${n}`).then(d => setWarnings(d.warnings || [])).catch(() => setWarnings([]));
    api(`/decisions?agent=${n}`).then(d => setReview(d.current || null)).catch(() => {});
    api(`/employee-checklist?name=${n}`).then(d => setChecklist({ onboarding: d.onboarding || [], offboarding: d.offboarding || [] })).catch(() => {});
    api(`/contracts?name=${n}`).then(d => setContract(d.contract || null)).catch(() => {});
  }, [agent?.name]);

  async function toggleCheck(type, label, done) {
    // optimistic
    setChecklist(c => ({ ...c, [type]: c[type].map(it => it.label === label ? { ...it, done } : it) }));
    try {
      await api('/employee-checklist', { method: 'PUT', body: { name: agent.name, type, label, done } });
    } catch {
      setChecklist(c => ({ ...c, [type]: c[type].map(it => it.label === label ? { ...it, done: !done } : it) }));
    }
  }

  if (!agent) {
    return (
      <div>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back</button>
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">Employee not found.</div>
      </div>
    );
  }

  const initials = agent.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const now = new Date();

  // Effective contract — overlay (renew/extend/convert/terminate) wins over the
  // team.js seed once any action has been recorded. Until loaded, fall back to
  // the seed so the page never renders blank.
  const cLoaded = contract != null;
  const cEnd = cLoaded ? contract.end : (agent.contractEnd || null);
  const cType = cLoaded ? contract.type : (agent.contract || (agent.contractEnd ? 'Fixed term' : 'Permanent'));
  const cStart = cLoaded ? contract.start : (agent.joined || null);
  const cStatus = cLoaded ? contract.status : 'active';
  const events = (contract && contract.events) || [];

  const daysToEnd = cEnd ? Math.ceil((new Date(cEnd) - now) / 86400000) : null;
  const terminated = cStatus === 'terminated';
  const permanent = cStatus === 'permanent' || (!cEnd && !terminated);
  const termEvent = events.filter((e) => e.action === 'terminate').slice(-1)[0];

  const isActive = !terminated;
  const statusLabel = terminated ? 'Terminated'
    : agent.status === 'training' ? 'Training'
    : agent.status === 'probation' ? 'Probation'
    : permanent ? 'Permanent'
    : (daysToEnd != null && daysToEnd < 0) ? 'Expired'
    : 'Active';
  const statusColor = terminated ? 'bg-gray-800 text-white'
    : agent.status === 'training' ? 'bg-orange-100 text-orange-700'
    : agent.status === 'probation' ? 'bg-amber-100 text-amber-700'
    : (daysToEnd != null && daysToEnd < 0) ? 'bg-red-100 text-red-700'
    : 'bg-emerald-100 text-emerald-700';

  const documents = files.filter((f) => f.category !== 'monthly-review');
  const reviews = files.filter((f) => f.category === 'monthly-review');
  const activity = [
    ...(agent.history || []).map((h) => ({ date: h.date, text: h.event })),
    ...warnings.map((w) => ({ date: w.date, text: `Warning (${w.type || 'verbal'}): ${w.reason || ''}`, warn: true })),
    ...events.map((e) => ({ date: e.at, text: contractEventText(e), warn: e.action === 'terminate' })),
  ].filter((a) => a.date).sort((a, b) => (a.date < b.date ? 1 : -1));

  // Contract management layer — real status + recommendation (live perf score,
  // falling back to the roster figure; "Review" when nothing is scored yet).
  const score = profile.performanceScore === '' || profile.performanceScore == null
    ? (typeof agent.performance === 'number' ? agent.performance : null)
    : Number(profile.performanceScore);
  const contractBadge = terminated ? { label: 'Terminated', cls: 'bg-gray-800 text-white' }
    : (agent.status === 'probation' || agent.status === 'training') ? { label: 'Probation', cls: 'bg-violet-100 text-violet-700' }
    : permanent ? { label: 'Permanent', cls: 'bg-emerald-100 text-emerald-700' }
    : daysToEnd < 0 ? { label: 'Expired', cls: 'bg-red-100 text-red-700' }
    : daysToEnd <= 30 ? { label: 'Expiring soon', cls: 'bg-amber-100 text-amber-700' }
    : { label: 'Active', cls: 'bg-emerald-100 text-emerald-700' };
  const recommendation = terminated ? null
    : permanent ? 'Permanent — no action'
    : daysToEnd == null ? null
    : daysToEnd < 0 ? 'Confirm, extend or end'
    : (score != null && score >= 80) ? 'Renew'
    : (score != null && score < 55) ? 'Review — underperforming'
    : 'Review';

  const ACTIONS = [
    { key: 'renew', label: 'Renew', icon: RefreshCw },
    { key: 'extend', label: 'Extend', icon: CalendarPlus },
    { key: 'convert', label: 'Convert to permanent', icon: BadgeCheck, hide: permanent },
    { key: 'terminate', label: 'Terminate', icon: UserX, danger: true },
  ];

  function openAction(key) {
    const today = new Date().toISOString().slice(0, 10);
    setActionErr('');
    setForm(key === 'terminate' ? { newEnd: today, reason: '', note: '' }
      : key === 'convert' ? { newType: 'Permanent', note: '' }
      : { newEnd: '', newStart: '', newType: cType, note: '' });
    setAction(key);
  }
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  async function runAction() {
    setActionBusy(true); setActionErr('');
    try {
      const payload = { name: agent.name, action, note: form.note };
      if (action === 'renew') { payload.newEnd = form.newEnd; payload.newStart = form.newStart; payload.newType = form.newType; }
      else if (action === 'extend') { payload.newEnd = form.newEnd; }
      else if (action === 'convert') { payload.newType = form.newType; }
      else if (action === 'terminate') { payload.reason = form.reason; payload.newEnd = form.newEnd; }
      const d = await api('/contracts/action', { method: 'POST', body: payload });
      setContract(d.contract);
      setAction(null);
    } catch (e) {
      setActionErr(e.message || 'Action failed');
    } finally {
      setActionBusy(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      const d = await api('/employee-profile', { method: 'PUT', body: { name: agent.name, fields: draft } });
      setProfile(d.profile || draft); setEditing(false);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  async function uploadDoc(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      await api('/agent-files', { method: 'POST', body: { agent: agent.name, name: file.name, mimeType: file.type, base64, category: 'document' } });
      const d = await api(`/agent-files?agent=${encodeURIComponent(agent.name)}`); setFiles(d.files || []);
    } catch { /* ignore */ } finally { setUploading(false); e.target.value = ''; }
  }

  async function deleteDoc(f) {
    if (!window.confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const prev = files;
    setFiles((s) => s.filter((x) => x.id !== f.id)); // optimistic
    try {
      await api(`/agent-files/${f.id}`, { method: 'DELETE' });
    } catch {
      setFiles(prev); // restore on failure
    }
  }

  const onbDone = checklist.onboarding.filter(i => i.done).length;
  const tabs = [['overview', 'Overview'], ['documents', `Documents${documents.length ? ` (${documents.length})` : ''}`], ['performance', 'Reviews & Warnings'], ['checklists', `Checklists${checklist.onboarding.length ? ` (${onbDone}/${checklist.onboarding.length})` : ''}`], ['activity', 'History']];

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-6"><ArrowLeft size={14} /> Back</button>

      {/* Identity */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-xl font-semibold shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{agent.name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusColor}`}>{statusLabel}</span>
            </div>
            <p className="text-gray-600">{agent.role}{agent.type ? ` · ${agent.type}` : ''}</p>
            <p className="text-[11px] text-gray-400 mt-1">Started {cStart || '—'} · Ends {cEnd ? formatDate(cEnd) : (permanent ? 'No end date' : '—')}{daysToEnd !== null && daysToEnd > 0 ? ` (${daysToEnd}d)` : ''}</p>
          </div>
        </div>
      </div>

      {/* Termination banner */}
      {terminated && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <UserX size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Contract terminated{termEvent?.toEnd ? ` — ${formatDate(termEvent.toEnd)}` : ''}</p>
            <p className="text-sm text-red-700">{termEvent?.reason || 'No reason recorded.'}</p>
            <p className="text-[11px] text-red-500 mt-0.5">This employee has been deactivated across Pulse and signed out.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl shadow-sm border border-gray-200 p-1.5 w-fit mb-4">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Contract — the management layer: status + recommendation + actions */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900">Contract</h2>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${contractBadge.cls}`}>{contractBadge.label}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
              <Field label="Type" value={cType} />
              <Field label="Start date" value={cStart || '—'} />
              <Field label="End date" value={cEnd ? formatDate(cEnd) : 'No end date'} accent={daysToEnd !== null && daysToEnd <= 30 ? 'text-red-600' : daysToEnd !== null && daysToEnd <= 90 ? 'text-amber-600' : 'text-gray-900'} />
              <Field label="Days left" value={daysToEnd == null ? '—' : daysToEnd < 0 ? `${-daysToEnd} days ago` : `${daysToEnd} days`} accent={daysToEnd !== null && daysToEnd <= 30 ? 'text-red-600' : 'text-gray-900'} />
              <Field label="Performance" value={score == null ? '—' : `${score}%`} />
              <Field label="Recommendation" value={recommendation || '—'} accent={recommendation === 'Renew' ? 'text-emerald-700' : /under|extend|end/i.test(recommendation || '') ? 'text-red-600' : 'text-gray-900'} />
            </div>
            {!terminated ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {ACTIONS.filter((a) => !a.hide).map((a) => (
                  <button key={a.key} type="button" onClick={() => openAction(a.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${a.danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                    <a.icon size={14} /> {a.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-gray-400">Contract ended. The full timeline is in the History tab.</p>
            )}
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Employment</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
              <Field label="Role" value={agent.role} />
              <Field label="Department" value={agent.type} />
              <Field label="Status" value={statusLabel} accent={isActive ? 'text-emerald-700' : 'text-gray-900'} />
              <Field label="Base salary" value={`D${(agent.base || 0).toLocaleString()}`} />
              <Field label="Commission" value={agent.commission > 0 ? `Up to D${agent.commission.toLocaleString()}` : '—'} accent={agent.commission > 0 ? 'text-emerald-700' : 'text-gray-900'} />
              <Field label="Warnings" value={String(warnings.length)} accent={warnings.length > 0 ? 'text-red-600' : 'text-gray-900'} />
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900">Personal &amp; contact</h2>
              {!editing
                ? <button onClick={() => { setDraft(profile); setEditing(true); }} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"><Pencil size={14} /> Edit</button>
                : <div className="flex gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                    <button onClick={saveProfile} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
                  </div>}
            </div>
            {!editing ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                {PERSONAL.map(([k, label]) => <Field key={k} label={label} value={k === 'nextReview' ? (profile[k] ? formatDate(profile[k]) : '') : profile[k]} />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {PERSONAL.map(([k, label]) => (
                  <label key={k} className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</span>
                    <input type={k === 'nextReview' ? 'date' : 'text'} value={draft[k] || ''} onChange={(e) => setDraft(s => ({ ...s, [k]: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="bg-white rounded-3xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-gray-900">Documents</h2>
            <label className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 cursor-pointer">
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
              <input type="file" className="hidden" onChange={uploadDoc} disabled={uploading} />
            </label>
          </div>
          {documents.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No documents yet. Upload a CV, ID, contract or certificate.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {documents.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 min-w-0"><FileText size={16} className="text-gray-400 shrink-0" /><div className="min-w-0"><p className="text-sm text-gray-900 truncate">{f.name}</p><p className="text-xs text-gray-400">{formatDate(f.uploadedAt)}</p></div></div>
                  <div className="flex items-center gap-4 shrink-0">
                    <a href={`/api/agent-files/${f.id}/download`} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"><Download size={14} /> Download</a>
                    <button type="button" onClick={() => deleteDoc(f)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-600"><Trash2 size={14} /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'performance' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Latest review</h2>
            {review ? <p className="text-sm text-gray-700">{review.decision} {review.reason && <span className="text-gray-500">— {review.reason}</span>} <span className="text-xs text-gray-400 ml-1">{review.setAt ? formatDate(review.setAt) : ''}</span></p> : <p className="text-sm text-gray-400">No review on file.</p>}
          </div>
          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Warnings</h2>
            {warnings.length === 0 ? <p className="text-sm text-gray-400">No warnings on file.</p> : (
              <div className="space-y-2">{warnings.map((w) => (
                <div key={w.id} className="flex items-start gap-2 text-sm"><AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" /><div><span className="text-gray-900">{w.reason}</span><span className="block text-xs text-gray-400">{w.type} · {formatDate(w.date)}{w.issuedBy ? ` · ${w.issuedBy}` : ''}</span></div></div>
              ))}</div>
            )}
          </div>
          <div className="bg-white rounded-3xl border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Review documents</h2>
            {reviews.length === 0 ? <p className="text-sm text-gray-400">No review documents.</p> : (
              <div className="divide-y divide-gray-100">{reviews.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-2.5"><span className="text-sm text-gray-900">{f.name}</span><a href={`/api/agent-files/${f.id}/download`} className="text-sm text-gray-600 hover:text-gray-900">Download</a></div>
              ))}</div>
            )}
          </div>
        </div>
      )}

      {tab === 'checklists' && (
        <div className="space-y-4">
          {[['onboarding', 'Onboarding', 'emerald'], ['offboarding', 'Offboarding', 'red']].map(([type, title, color]) => {
            const items = checklist[type] || [];
            const done = items.filter(i => i.done).length;
            const pct = items.length ? Math.round((done / items.length) * 100) : 0;
            return (
              <div key={type} className="bg-white rounded-3xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                  <span className="text-xs font-medium text-gray-500">{done}/{items.length} done</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 mb-5 overflow-hidden">
                  <div className={`h-full rounded-full ${color === 'emerald' ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="divide-y divide-gray-100">
                  {items.map((it) => (
                    <button key={it.label} type="button" onClick={() => toggleCheck(type, it.label, !it.done)} className="w-full flex items-center gap-3 py-3 text-left hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                      {it.done ? <CheckCircle2 size={18} className={color === 'emerald' ? 'text-emerald-600' : 'text-red-500'} /> : <Circle size={18} className="text-gray-300" />}
                      <span className={`flex-1 text-sm ${it.done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{it.label}</span>
                      {it.done && it.doneAt && <span className="text-[11px] text-gray-400">{formatDate(it.doneAt)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'activity' && (
        <div className="bg-white rounded-3xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Employment history</h2>
          {activity.length === 0 ? <p className="text-sm text-gray-400">No recorded history yet.</p> : (
            <div className="space-y-0">
              {activity.map((a, i) => (
                <div key={i} className="flex gap-4 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full mt-1.5 ${a.warn ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    {i < activity.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1" />}
                  </div>
                  <div className="min-w-0 pb-1">
                    <p className="text-sm text-gray-900">{a.text}</p>
                    <p className="text-xs text-gray-400">{formatDate(a.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Contract action modal */}
      {action && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !actionBusy && setAction(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{ACTION_TITLES[action]}</h3>
              <button onClick={() => setAction(null)} disabled={actionBusy} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              {action === 'renew' && (
                <>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">New contract type</span>
                    <input type="text" value={form.newType || ''} onChange={(e) => setF('newType', e.target.value)} placeholder="e.g. 6-month fixed" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">New start date (optional)</span>
                    <input type="date" value={form.newStart || ''} onChange={(e) => setF('newStart', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">New end date</span>
                    <input type="date" value={form.newEnd || ''} onChange={(e) => setF('newEnd', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                </>
              )}
              {action === 'extend' && (
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Extend end date to</span>
                  <input type="date" value={form.newEnd || ''} onChange={(e) => setF('newEnd', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              )}
              {action === 'convert' && (
                <>
                  <p className="text-sm text-gray-600">This makes the contract permanent — no end date, no expiry reminders.</p>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Contract type</span>
                    <input type="text" value={form.newType || ''} onChange={(e) => setF('newType', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                </>
              )}
              {action === 'terminate' && (
                <>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    Terminating deactivates <span className="font-semibold">{agent.name}</span> across Pulse — removed from the roster, payroll and attendance, and signed out immediately. This is recorded permanently.
                  </div>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Reason (required)</span>
                    <textarea value={form.reason || ''} onChange={(e) => setF('reason', e.target.value)} rows={3} placeholder="Why is this contract being terminated?" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Termination date</span>
                    <input type="date" value={form.newEnd || ''} onChange={(e) => setF('newEnd', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </label>
                </>
              )}
              {action !== 'terminate' && (
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Note (optional)</span>
                  <input type="text" value={form.note || ''} onChange={(e) => setF('note', e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              )}
            </div>

            {actionErr && <p className="text-sm text-red-600 mt-3">{actionErr}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAction(null)} disabled={actionBusy} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={runAction} disabled={actionBusy} className={`px-4 py-2 rounded-lg text-sm text-white disabled:opacity-60 ${action === 'terminate' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{actionBusy ? 'Working…' : ACTION_CONFIRM[action]}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
