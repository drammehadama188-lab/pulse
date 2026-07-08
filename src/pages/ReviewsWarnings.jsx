import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, AlertTriangle, CheckCircle2, ChevronRight, Plus, X, GraduationCap, Calendar, Flag, Pencil, Trash2 } from 'lucide-react';
import { team } from '../data/team';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Reviews & Warnings — the team-wide ACTION page (sibling to Contracts).
// Answers "who needs a review this month, and who has warnings on record?"
// and lets you act: complete a review (on the person's performance page) or
// log a warning right here. The per-person detail lives on the profile's
// "Reviews & Warnings" tab. All data is real (locked reviews + warnings API).

const slugify = (n) => n.toLowerCase().replace(/\s+/g, '-');
const period = new Date().toISOString().slice(0, 7); // YYYY-MM
const periodLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const fmtDate = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const typeCls = (t) => t === 'final' ? 'bg-red-200 text-red-900' : t === 'formal' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
// coaching / flags / meetings share one store; each type gets its own look
const COACH_META = {
  coaching: { icon: GraduationCap, label: 'Coaching', cls: 'bg-emerald-50 text-emerald-700' },
  meeting: { icon: Calendar, label: 'Meeting', cls: 'bg-blue-50 text-blue-700' },
  flag: { icon: Flag, label: 'Flag', cls: 'bg-red-100 text-red-700' },
};
const COACHING_SHOWN = 15;

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ReviewsWarnings({ scope }) {
  const scoped = scope === 'team'; // MY TEAM: a lead's own team, read-only
  const navigate = useNavigate();
  const { user } = useAuth();
  const [warnings, setWarnings] = useState([]);
  const [reviews, setReviews] = useState({});
  const [coaching, setCoaching] = useState([]);
  const [editCoach, setEditCoach] = useState(null); // coaching record being edited
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachErr, setCoachErr] = useState('');
  const [confirmDelC, setConfirmDelC] = useState(null); // coaching id pending delete confirm
  const [delCBusy, setDelCBusy] = useState(false);
  // Edit and delete are separate permissions (Team power sub-toggles; CEO
  // always). Follows the VIEWED user under view-as — Adama must see exactly
  // their buttons; the server still refuses read-only impersonated writes.
  const canEditCoaching = !!user?.canCoachingEdit;
  const canDeleteCoaching = !!user?.canCoachingDelete;
  const [teamMembers, setTeamMembers] = useState(scoped ? null : []);
  const [adding, setAdding] = useState(null); // { agent, type, reason, date } | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const roster = scoped
    ? (teamMembers || [])
    : team.filter((t) => t.status !== 'maternity');

  useEffect(() => {
    if (scoped) {
      api('/team/reviews')
        .then((d) => { setReviews(d.reviews || {}); setWarnings(d.warnings || []); setTeamMembers(d.members || []); })
        .catch(() => { setReviews({}); setWarnings([]); setTeamMembers([]); });
    } else {
      api('/warnings').then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]));
      api('/reviews').then((d) => setReviews(d.reviews || {})).catch(() => setReviews({}));
    }
    // the API scopes this by viewer: CEO/HR see everyone, a lead sees their team
    api('/coaching').then((d) => setCoaching(d.coaching || [])).catch(() => setCoaching([]));
  }, [scoped]);

  const hasReview = (name) => (reviews[name] || []).some((r) => r.period === period);
  const reviewed = roster.filter((p) => hasReview(p.name));
  const needsReview = roster.filter((p) => !hasReview(p.name));
  const sortedWarnings = [...warnings].sort((a, b) => (a.date < b.date ? 1 : -1));
  // coaching arrives newest-first from the API; sessions logged this month drive the count
  const coachedThisMonth = coaching.filter((c) => ((c.datetime || c.createdAt) || '').slice(0, 7) === period).length;
  const coachingShown = coaching.slice(0, COACHING_SHOWN);

  // In team scope a lead can't reach the HR pages (/performance, /agents), so
  // clicks open the Team Member page they DO have — where they log coaching /
  // check-ins. Formal reviews + warnings stay with HR/CEO.
  const usernameByName = Object.fromEntries((scoped ? roster : []).map((p) => [p.name, p.username]));
  const openProfile = (name) => {
    if (scoped) { const un = usernameByName[name]; if (un) return navigate(`/team-member/${un}`); }
    navigate(`/agents/${slugify(name)}`);
  };
  const openReview = (name) => {
    if (scoped) return openProfile(name);
    navigate(`/performance/${slugify(name)}`);
  };

  async function saveCoach() {
    setCoachBusy(true); setCoachErr('');
    try {
      const d = await api(`/coaching/${editCoach.id}`, { method: 'PUT', body: { type: editCoach.type, title: editCoach.title, note: editCoach.note, datetime: editCoach.datetime } });
      setCoaching((list) => list.map((c) => (c.id === d.record.id ? { ...c, ...d.record } : c)));
      setEditCoach(null);
    } catch (e) { setCoachErr(e.message || 'Could not save'); }
    finally { setCoachBusy(false); }
  }
  async function deleteCoach(id) {
    setDelCBusy(true);
    try {
      await api(`/coaching/${id}`, { method: 'DELETE' });
      setCoaching((list) => list.filter((c) => c.id !== id));
      setConfirmDelC(null);
    } catch (e) { setCoachErr(e.message || 'Could not delete'); }
    finally { setDelCBusy(false); }
  }

  function openAdd() {
    setErr('');
    setAdding({ agent: roster[0]?.name || '', type: 'verbal', reason: '', date: new Date().toISOString().slice(0, 10) });
  }
  async function submitWarning() {
    if (!adding?.agent) { setErr('Pick a person'); return; }
    setBusy(true); setErr('');
    try {
      const d = await api('/warnings', { method: 'POST', body: { agent: adding.agent, type: adding.type, reason: adding.reason, date: adding.date } });
      setWarnings((w) => [...w, d.warning]);
      setAdding(null);
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">{scoped ? 'Team Reviews' : 'Reviews & Warnings'}</h1>
          <p className="text-gray-500 mt-1">{scoped ? "Your team's reviews and warnings on record." : 'Who needs a review this month, and who has warnings on record.'}</p>
        </div>
        {!scoped && <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-full"><Plus size={14} /> Log a warning</button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Team" value={roster.length} />
        <Stat label={`Reviewed — ${periodLabel}`} value={reviewed.length} sub={`of ${roster.length}`} accent="text-emerald-600" />
        <Stat label="Pending reviews" value={needsReview.length} accent={needsReview.length > 0 ? 'text-amber-600' : 'text-gray-900'} />
        <Stat label="Warnings on record" value={warnings.length} accent={warnings.length > 0 ? 'text-red-600' : 'text-gray-900'} />
      </div>

      {/* Needs a review */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Needs a review — {periodLabel}</h2>
        <p className="text-sm text-gray-500 mb-4">{needsReview.length === 0 ? 'Everyone has a locked review for this month.' : `${needsReview.length} ${needsReview.length === 1 ? 'person has' : 'people have'} no review yet.`}</p>
        {needsReview.length > 0 && (
          <div className="divide-y divide-gray-100">
            {needsReview.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-4 py-3">
                <button onClick={() => openProfile(p.name)} className="flex items-center gap-3 min-w-0 text-left group">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-xs font-semibold shrink-0">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-900 group-hover:underline truncate">{p.name}</p><p className="text-xs text-gray-500 truncate">{p.role}</p></div>
                </button>
                <button onClick={() => openReview(p.name)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 shrink-0">{scoped ? 'Coach' : 'Review'} <ChevronRight size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {reviewed.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {reviewed.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 size={12} /> {p.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Coaching & check-ins — logged by team leads on the Team Member pages */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Coaching &amp; check-ins</h2>
        <p className="text-sm text-gray-500 mb-4">
          {coaching.length === 0
            ? 'No coaching sessions logged yet.'
            : `${coachedThisMonth} logged in ${periodLabel} · ${coaching.length} total on record.`}
        </p>
        {coaching.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">Sessions appear here the moment a team lead logs them on a Team Member page.</div>
        ) : (
          <div className="space-y-2">
            {coachingShown.map((c) => {
              const m = COACH_META[c.type] || COACH_META.coaching;
              return (
                <div key={c.id} className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg">
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-0.5 ${m.cls}`}>
                    <m.icon size={11} /> {m.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{c.targetName || c.targetUsername}{c.title ? ` — ${c.title}` : ''}</p>
                    {c.note && <p className="text-sm text-gray-700 mt-0.5">{c.note}</p>}
                    <p className="text-[11px] text-gray-500 mt-1">{fmtDate(c.datetime || c.createdAt)} · by {c.createdBy}{c.editedBy ? ` · edited by ${c.editedBy}` : ''}</p>
                  </div>
                  {(canEditCoaching || canDeleteCoaching) && (
                    <div className="flex shrink-0 items-start gap-1">
                      {canEditCoaching && (
                        <button onClick={() => { setCoachErr(''); setConfirmDelC(null); setEditCoach({ id: c.id, type: c.type || 'coaching', title: c.title || '', note: c.note || '', datetime: c.datetime || '' }); }} title="Edit" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"><Pencil size={14} /></button>
                      )}
                      {canDeleteCoaching && (confirmDelC === c.id ? (
                        <button onClick={() => deleteCoach(c.id)} disabled={delCBusy} className="rounded-lg bg-red-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-60">{delCBusy ? 'Deleting…' : 'Delete?'}</button>
                      ) : (
                        <button onClick={() => setConfirmDelC(c.id)} title="Delete" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-red-600"><Trash2 size={14} /></button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {coaching.length > COACHING_SHOWN && (
              <p className="text-[11px] text-gray-400 pt-1">Showing the latest {COACHING_SHOWN} of {coaching.length}. The full month-by-month record lives in Reports.</p>
            )}
          </div>
        )}
      </div>

      {/* Warnings */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Warnings &amp; disciplinary</h2>
        <p className="text-sm text-gray-500 mb-4">{warnings.length === 0 ? 'No warnings on file across the team.' : `${warnings.length} on record.`}</p>
        {warnings.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No warnings recorded.</div>
        ) : (
          <div className="space-y-2">
            {sortedWarnings.map((w) => (
              <button key={w.id} onClick={() => openProfile(w.agent)} className="w-full flex items-start gap-3 p-4 border border-gray-200 rounded-lg text-left hover:border-gray-300 hover:shadow-sm transition-all">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-0.5 ${typeCls(w.type)}`}>{w.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{w.agent}</p>
                  {w.reason && <p className="text-sm text-gray-700 mt-0.5">{w.reason}</p>}
                  <p className="text-[11px] text-gray-500 mt-1">{fmtDate(w.date)}{w.issuedBy ? ` · issued by ${w.issuedBy}` : ''}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Edit a coaching entry modal */}
      {editCoach && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !coachBusy && setEditCoach(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><GraduationCap size={18} className="text-emerald-600" /> Edit entry</h3>
              <button onClick={() => setEditCoach(null)} disabled={coachBusy} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Type</span>
                <select value={editCoach.type} onChange={(e) => setEditCoach((s) => ({ ...s, type: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="coaching">Coaching</option>
                  <option value="meeting">Meeting</option>
                  <option value="flag">Flag</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Title</span>
                <input value={editCoach.title} onChange={(e) => setEditCoach((s) => ({ ...s, title: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Note</span>
                <textarea value={editCoach.note} onChange={(e) => setEditCoach((s) => ({ ...s, note: e.target.value }))} rows={3} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              {editCoach.type === 'meeting' && (
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">When</span>
                  <input type="datetime-local" value={editCoach.datetime} onChange={(e) => setEditCoach((s) => ({ ...s, datetime: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              )}
            </div>
            {coachErr && <p className="text-sm text-red-600 mt-3">{coachErr}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditCoach(null)} disabled={coachBusy} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={saveCoach} disabled={coachBusy} className="px-4 py-2 rounded-lg text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-60">{coachBusy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Log a warning modal */}
      {adding && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setAdding(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><ShieldAlert size={18} className="text-red-500" /> Log a warning</h3>
              <button onClick={() => setAdding(null)} disabled={busy} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Person</span>
                <select value={adding.agent} onChange={(e) => setAdding((s) => ({ ...s, agent: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {roster.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Type</span>
                <select value={adding.type} onChange={(e) => setAdding((s) => ({ ...s, type: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="verbal">Verbal</option>
                  <option value="formal">Formal</option>
                  <option value="final">Final</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Reason</span>
                <textarea value={adding.reason} onChange={(e) => setAdding((s) => ({ ...s, reason: e.target.value }))} rows={3} placeholder="What happened?" className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Date</span>
                <input type="date" value={adding.date} onChange={(e) => setAdding((s) => ({ ...s, date: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAdding(null)} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={submitWarning} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">{busy ? 'Saving…' : 'Log warning'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
