import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CARD, BTN_DARK, PageHead, dayTime, scoreTone, scoreWord, RECOMMENDATION } from './ui.jsx';

// Every interview booked or scored. The list is the record — a completed
// interview keeps its own copy of the questions it asked, so it stays readable
// after a template is edited.

const FILTERS = [['upcoming', 'Upcoming'], ['completed', 'Completed'], ['all', 'All']];

export default function Interviews() {
  const [interviews, setInterviews] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('upcoming');
  const [booking, setBooking] = useState(false);
  const [pick, setPick] = useState({ applicantId: '', templateId: '', scheduledAt: '', interviewer: '' });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  function load() {
    api('/interviews').then(d => setInterviews(d.interviews || [])).catch(() => setInterviews([])).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    api('/applicants').then(d => setApplicants(d.applicants || [])).catch(() => setApplicants([]));
    api('/interview-templates').then(d => {
      setTemplates(d.templates || []);
      setPick(p => ({ ...p, templateId: (d.templates || []).find(t => t.isDefault)?.id || (d.templates || [])[0]?.id || '' }));
    }).catch(() => setTemplates([]));
  }, []);

  const rows = useMemo(() => {
    const now = Date.now();
    let list = interviews;
    if (filter === 'upcoming') list = list.filter(i => i.status !== 'completed');
    if (filter === 'completed') list = list.filter(i => i.status === 'completed');
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(i => `${i.applicantName} ${i.templateName} ${i.interviewer}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (filter === 'upcoming') return (a.scheduledAt || '').localeCompare(b.scheduledAt || '');
      return (b.completedAt || b.scheduledAt || '').localeCompare(a.completedAt || a.scheduledAt || '');
    }).map(i => ({ ...i, late: i.status !== 'completed' && Date.parse(i.scheduledAt || '') < now }));
  }, [interviews, filter, query]);

  const candidates = useMemo(() => {
    const q = (pick.query || '').toLowerCase();
    return applicants.filter(a => !q || String(a.name || '').toLowerCase().includes(q)).slice(0, 200);
  }, [applicants, pick.query]);

  async function book() {
    if (!pick.applicantId) return;
    setSaving(true); setError(null);
    try {
      const { interview } = await api('/interviews', {
        method: 'POST',
        body: {
          applicantId: pick.applicantId,
          templateId: pick.templateId,
          interviewer: pick.interviewer,
          scheduledAt: pick.scheduledAt ? new Date(pick.scheduledAt).toISOString() : undefined,
        },
      });
      navigate(`/recruitment/interviews/${interview.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const chip = 'px-3 py-1.5 rounded-lg text-xs font-medium border';

  return (
    <div>
      <PageHead title="Interviews" count={interviews.length || null}>
        <button onClick={() => { setError(null); setBooking(true); }} className={BTN_DARK}><Plus size={16} /> Book interview</button>
      </PageHead>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${chip} ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{label}</button>
        ))}
        <span className="flex-1" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name…" className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white w-56" />
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p>
        : rows.length === 0 ? <div className={`${CARD} p-12 text-center text-gray-400 text-sm`}>Nothing here. Book one from an applicant's page or with the button above.</div>
          : (
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-3 font-bold">Candidate</th>
                    <th className="px-4 py-3 font-bold">When</th>
                    <th className="px-4 py-3 font-bold">Interviewer</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Recommendation</th>
                    <th className="px-4 py-3 font-bold text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(i => (
                    <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer" onClick={() => navigate(`/recruitment/interviews/${i.id}`)}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{i.applicantName}</span>
                        <span className="block text-xs text-gray-400">{i.templateName}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={i.late ? 'text-rose-600' : 'text-gray-700'}>{dayTime(i.scheduledAt)}</span>
                        {i.late && <span className="block text-[11px] text-rose-400">not scored yet</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{i.interviewer || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${i.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : i.status === 'in_progress' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {i.status === 'completed' ? 'Completed' : i.status === 'in_progress' ? 'In progress' : 'Scheduled'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {i.recommendation
                          ? <span className={`px-2 py-0.5 rounded-md border text-xs font-medium ${RECOMMENDATION[i.recommendation][1]}`}>{RECOMMENDATION[i.recommendation][0]}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-base font-extrabold ${scoreTone(i.totalScore)}`}>{i.totalScore ?? '—'}</span>
                        <span className="block text-[11px] text-gray-400">{i.totalScore != null ? scoreWord(i.totalScore) : `${i.answered}/${i.totalQuestions}`}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setBooking(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Book interview</h3>
              <button onClick={() => setBooking(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Candidate</span>
                <input value={pick.query || ''} onChange={e => setPick(p => ({ ...p, query: e.target.value }))} placeholder="Type a name to narrow the list"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <select value={pick.applicantId} onChange={e => setPick(p => ({ ...p, applicantId: e.target.value }))} size={6}
                  className="mt-2 w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white">
                  {candidates.map(a => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Questions</span>
                <select value={pick.templateId} onChange={e => setPick(p => ({ ...p, templateId: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">When</span>
                <input type="datetime-local" value={pick.scheduledAt} onChange={e => setPick(p => ({ ...p, scheduledAt: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Interviewer</span>
                <input value={pick.interviewer} onChange={e => setPick(p => ({ ...p, interviewer: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setBooking(false)} disabled={saving} className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={book} disabled={saving || !pick.applicantId} className="px-3 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Booking…' : 'Book'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
