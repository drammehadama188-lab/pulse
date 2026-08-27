import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CARD, BTN_PRIMARY, PageHead, dayTime, fromGambiaInput, scoreTone, scoreWord, RECOMMENDATION } from './ui.jsx';
import { TableSkeleton } from '../../components/ui/Skeleton.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pager, { usePager } from '../../components/ui/Pager.jsx';

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

  const pager = usePager(rows);

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
          // The typed time IS Gambia time, wherever it is typed from.
          scheduledAt: fromGambiaInput(pick.scheduledAt),
        },
      });
      navigate(`/recruitment/interviews/${interview.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const chip = 'px-3 py-1.5 rounded-lg text-[12px] font-medium border';

  return (
    <div>
      <PageHead title="Interviews" count={interviews.length || null}>
        <button onClick={() => { setError(null); setBooking(true); }} className={BTN_PRIMARY}><Plus size={16} /> Book interview</button>
      </PageHead>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`${chip} ${filter === k ? 'bg-[var(--color-ink)] text-white border-[var(--color-ink)]' : 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:bg-[var(--color-fill)]'}`}>{label}</button>
        ))}
        <span className="flex-1" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name…" className="text-[13px] border border-[var(--color-line)] rounded-lg px-3 py-2 bg-white w-56" />
      </div>

      {loading ? <TableSkeleton rows={6} />
        : rows.length === 0 ? <div className={CARD}>
            <EmptyState
              title="No interviews booked"
              line="Book one from an applicant's page, or with the button above."
            />
          </div>
          : (
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] font-medium text-[var(--color-ink-faint)] border-b border-[var(--color-line-soft)]">
                    <th className="px-4 py-3 font-semibold">Candidate</th>
                    <th className="px-4 py-3 font-semibold">When</th>
                    <th className="px-4 py-3 font-semibold">Interviewer</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Recommendation</th>
                    <th className="px-4 py-3 font-semibold text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map(i => (
                    <tr key={i.id} className="border-b border-[var(--color-line-soft)] hover:bg-[var(--color-fill)] cursor-pointer" onClick={() => navigate(`/recruitment/interviews/${i.id}`)}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-[var(--color-ink)]">{i.applicantName}</span>
                        <span className="block text-[12px] text-[var(--color-ink-faint)]">{i.templateName}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={i.late ? 'text-[var(--color-stage-out)]' : 'text-[var(--color-ink-soft)]'}>{dayTime(i.scheduledAt)}</span>
                        {i.late && <span className="block text-[11px] text-[var(--color-stage-out)]">not scored yet</span>}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-soft)]">{i.interviewer || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-md text-[12px] font-medium ${i.status === 'completed' ? 'bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)]' : i.status === 'in_progress' ? 'bg-[var(--color-stage-interview-bg)] text-[var(--color-stage-interview)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
                          {i.status === 'completed' ? 'Completed' : i.status === 'in_progress' ? 'In progress' : 'Scheduled'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {i.recommendation
                          ? <span className={`px-2 py-0.5 rounded-md border text-[12px] font-medium ${RECOMMENDATION[i.recommendation][1]}`}>{RECOMMENDATION[i.recommendation][0]}</span>
                          : <span className="text-[var(--color-ink-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-base font-semibold ${scoreTone(i.totalScore)}`}>{i.totalScore ?? '—'}</span>
                        <span className="block text-[11px] text-[var(--color-ink-faint)]">
                          {i.totalScore != null ? `${scoreWord(i.totalScore)} · ${i.answered}/${i.totalQuestions} scored` : `${i.answered}/${i.totalQuestions} scored`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager {...pager.props} noun="interviews" />
            </div>
          )}

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setBooking(false)}>
          <div className="bg-white rounded-lg shadow-[var(--shadow-lift)] max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="t-card text-[var(--color-ink)]">Book interview</h3>
              <button onClick={() => setBooking(false)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Candidate</span>
                <input value={pick.query || ''} onChange={e => setPick(p => ({ ...p, query: e.target.value }))} placeholder="Type a name to narrow the list"
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px]" />
                <select value={pick.applicantId} onChange={e => setPick(p => ({ ...p, applicantId: e.target.value }))} size={6}
                  className="mt-2 w-full border border-[var(--color-line)] rounded-lg px-2 py-2 text-[13px] bg-white">
                  {candidates.map(a => <option key={a.id} value={a.id}>{a.name}{a.phone ? ` · ${a.phone}` : ''}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Questions</span>
                <select value={pick.templateId} onChange={e => setPick(p => ({ ...p, templateId: e.target.value }))}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px] bg-white">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">When</span>
                <input type="datetime-local" value={pick.scheduledAt} onChange={e => setPick(p => ({ ...p, scheduledAt: e.target.value }))}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px]" />
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Interviewer</span>
                <input value={pick.interviewer} onChange={e => setPick(p => ({ ...p, interviewer: e.target.value }))}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px]" />
              </label>
            </div>
            {error && <p className="mt-3 text-[13px] text-[var(--color-stage-out)]">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setBooking(false)} disabled={saving} className="px-3 py-2 rounded-lg text-[13px] bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
              <button onClick={book} disabled={saving || !pick.applicantId} className="px-3.5 py-2.5 rounded-[8px] text-[13.5px] font-semibold bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50">{saving ? 'Booking…' : 'Book'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
