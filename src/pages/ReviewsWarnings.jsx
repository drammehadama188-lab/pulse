import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, AlertTriangle, CheckCircle2, ChevronRight, Plus, X } from 'lucide-react';
import { team } from '../data/team';
import { api } from '../lib/api.js';

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
  const [warnings, setWarnings] = useState([]);
  const [reviews, setReviews] = useState({});
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
  }, [scoped]);

  const hasReview = (name) => (reviews[name] || []).some((r) => r.period === period);
  const reviewed = roster.filter((p) => hasReview(p.name));
  const needsReview = roster.filter((p) => !hasReview(p.name));
  const sortedWarnings = [...warnings].sort((a, b) => (a.date < b.date ? 1 : -1));

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
                <button onClick={() => navigate(`/agents/${slugify(p.name)}`)} className="flex items-center gap-3 min-w-0 text-left group">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-xs font-semibold shrink-0">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-900 group-hover:underline truncate">{p.name}</p><p className="text-xs text-gray-500 truncate">{p.role}</p></div>
                </button>
                <button onClick={() => navigate(`/performance/${slugify(p.name)}`)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 shrink-0">Review <ChevronRight size={14} /></button>
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

      {/* Warnings */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Warnings &amp; disciplinary</h2>
        <p className="text-sm text-gray-500 mb-4">{warnings.length === 0 ? 'No warnings on file across the team.' : `${warnings.length} on record.`}</p>
        {warnings.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No warnings recorded.</div>
        ) : (
          <div className="space-y-2">
            {sortedWarnings.map((w) => (
              <button key={w.id} onClick={() => navigate(`/agents/${slugify(w.agent)}`)} className="w-full flex items-start gap-3 p-4 border border-gray-200 rounded-lg text-left hover:border-gray-300 hover:shadow-sm transition-all">
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
