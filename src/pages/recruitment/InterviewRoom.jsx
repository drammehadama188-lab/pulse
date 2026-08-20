import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, Download, Phone, ThumbsUp, ThumbsDown, HelpCircle, Trash2 } from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { CARD, BTN_PRIMARY, dayTime, toLocalInput, scoreTone, scoreWord, RECOMMENDATION } from './ui.jsx';

// The interview room: the questions on the left, the CV beside them, one score
// per answer, one recommendation at the end.
//
// 🔒 Scores are the average of what was actually rated — a question left blank
// is left out, not counted zero, so a half-finished interview does not read as
// a bad candidate. The total is that average as a percentage, computed on the
// server so this screen, the interview list and the reports all say the same
// number.

const SCORES = [[1, 'Poor'], [2, 'Fair'], [3, 'Average'], [4, 'Good'], [5, 'Excellent']];
const RECS = [
  ['strong_yes', 'Strong yes', ThumbsUp],
  ['yes', 'Yes', ThumbsUp],
  ['unsure', 'Unsure', HelpCircle],
  ['no', 'No', ThumbsDown],
];

export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [iv, setIv] = useState(null);
  const [applicant, setApplicant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [notes, setNotes] = useState({});
  const [summary, setSummary] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/interviews/${id}`)
      .then(d => {
        setIv(d.interview);
        setApplicant(d.applicant);
        setSummary(d.interview.summary || '');
        setNotes(Object.fromEntries(Object.entries(d.interview.answers || {}).map(([k, v]) => [k, v.notes || ''])));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function patch(body) {
    setBusy(true);
    try {
      const { interview } = await api(`/interviews/${id}`, { method: 'PUT', body });
      setIv(interview);
      setSavedAt(new Date());
      return interview;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const done = iv?.status === 'completed';
  const section = iv?.sections?.[sectionIdx];
  const cvUrl = useMemo(() => (applicant?.cv ? `/api/applicants/${applicant.id}/cv?t=${encodeURIComponent(getToken() || '')}` : null), [applicant]);

  async function complete() {
    if (!iv.recommendation) return setError('Choose a recommendation first — strong yes, yes, unsure or no.');
    setError(null);
    await patch({ status: 'completed', summary });
    navigate(`/recruitment/interviews`);
  }
  async function removeInterview() {
    if (!window.confirm('Delete this interview and its scores?')) return;
    await api(`/interviews/${id}`, { method: 'DELETE' });
    navigate('/recruitment/interviews');
  }

  if (loading) return <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>;
  if (!iv) return <div className={`${CARD} p-12 text-center text-sm text-[var(--color-ink-faint)]`}>{error || 'Interview not found.'}</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <Link to={applicant ? `/recruitment/applicants/${applicant.id}` : '/recruitment/interviews'} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
          <ArrowLeft size={15} /> {applicant ? applicant.name : 'Interviews'}
        </Link>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-[var(--color-ink-faint)]">Saved {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={removeInterview} className="p-2 rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]" title="Delete interview"><Trash2 size={16} /></button>
          {!done && <button onClick={complete} disabled={busy} className={`${BTN_PRIMARY} disabled:opacity-50`}><Check size={16} /> Complete interview</button>}
        </div>
      </div>

      <div className={`${CARD} p-5 mb-5 flex items-start justify-between gap-4 flex-wrap`}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-ink)]">{iv.applicantName}</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mt-0.5">{iv.templateName}{iv.interviewer ? ` · ${iv.interviewer}` : ''}</p>
          <div className="mt-2 flex items-center gap-3 flex-wrap text-sm text-[var(--color-ink-soft)]">
            {applicant?.phone && <a href={`tel:${applicant.phone.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-[var(--color-ink)]"><Phone size={14} /> {applicant.phone}</a>}
            <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${done ? 'bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)]' : iv.status === 'in_progress' ? 'bg-[var(--color-stage-interview-bg)] text-[var(--color-stage-interview)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
              {done ? 'Completed' : iv.status === 'in_progress' ? 'In progress' : 'Scheduled'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-4xl font-semibold ${scoreTone(iv.totalScore)}`}>{iv.totalScore ?? '—'}<span className="text-lg text-[var(--color-ink-faint)] font-bold">/100</span></p>
          <p className="text-xs text-[var(--color-ink-faint)]">{iv.answered} of {iv.totalQuestions} scored{iv.totalScore != null ? ` · ${scoreWord(iv.totalScore)}` : ''}</p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-[var(--color-stage-out)]">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_320px] gap-5 items-start">
        {/* sections */}
        <div className={`${CARD} p-3`}>
          {iv.sections.map((s, i) => {
            const sc = iv.sectionScores?.find(x => x.id === s.id);
            const isOn = i === sectionIdx;
            return (
              <button key={s.id} onClick={() => setSectionIdx(i)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left ${isOn ? 'bg-[var(--color-ink)] text-white' : 'hover:bg-[var(--color-fill)]'}`}>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-medium truncate ${isOn ? 'text-white' : 'text-[var(--color-ink)]'}`}>{i + 1}. {s.title}</span>
                  <span className={`block text-[11px] ${isOn ? 'text-white/70' : 'text-[var(--color-ink-faint)]'}`}>{sc?.answered || 0}/{sc?.of || s.questions.length}</span>
                </span>
                {sc?.answered === sc?.of
                  ? <Check size={16} className={isOn ? 'text-white' : 'text-[var(--color-stage-hired)]'} />
                  : <Circle size={14} className={isOn ? 'text-white/50' : 'text-[var(--color-ink-faint)]'} />}
              </button>
            );
          })}
        </div>

        {/* questions */}
        <div className="space-y-4">
          <div className={`${CARD} p-5`}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <p className="text-xs text-[var(--color-ink-faint)]">Section {sectionIdx + 1} of {iv.sections.length}</p>
              {sectionIdx < iv.sections.length - 1 && (
                <button onClick={() => setSectionIdx(i => i + 1)} className="text-sm font-medium text-[var(--color-ink)] hover:underline">Next section</button>
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--color-ink)]">{section.title}</h2>
          </div>

          {section.questions.map((q, qi) => {
            const ans = iv.answers?.[q.id] || {};
            return (
              <div key={q.id} className={`${CARD} p-5`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-lg bg-[var(--color-fill)] px-2 py-1 text-[11px] font-bold text-[var(--color-ink-soft)]">Q{qi + 1}</span>
                  <p className="text-sm font-medium text-[var(--color-ink)]">{q.text}</p>
                </div>
                <textarea
                  value={notes[q.id] ?? ''}
                  onChange={e => setNotes(n => ({ ...n, [q.id]: e.target.value }))}
                  onBlur={() => (notes[q.id] ?? '') !== (ans.notes || '') && patch({ answer: { questionId: q.id, notes: notes[q.id] ?? '' } })}
                  disabled={done}
                  rows={3} placeholder="What they actually said"
                  className="mt-3 w-full border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-sm disabled:bg-[var(--color-fill)]" />
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {SCORES.map(([n, label]) => (
                    <button key={n} disabled={done}
                      onClick={() => patch({ answer: { questionId: q.id, score: ans.score === n ? null : n } })}
                      className={`rounded-lg border py-2 text-center ${ans.score === n ? 'bg-[var(--color-ink)] border-[var(--color-ink)] text-white' : 'bg-white border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]'} disabled:opacity-60`}>
                      <span className="block text-base font-bold">{n}</span>
                      <span className="block text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* CV, scores, decision */}
        <div className="space-y-4">
          <div className={`${CARD} p-4`}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="t-card text-[var(--color-ink)]">CV</h3>
              {cvUrl && <a href={`${cvUrl}&download=1`} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]" title="Download"><Download size={15} /></a>}
            </div>
            {cvUrl ? (
              String(applicant.cv.mimeType).startsWith('image/')
                ? <img src={cvUrl} alt="CV" className="w-full rounded-lg border border-[var(--color-line-soft)]" />
                : <iframe title="CV" src={cvUrl} className="w-full h-72 rounded-lg border border-[var(--color-line-soft)]" />
            ) : (
              <p className="text-xs text-[var(--color-ink-faint)]">
                No CV on file. <Link to={applicant ? `/recruitment/applicants/${applicant.id}` : '#'} className="text-[var(--color-ink-soft)] underline">Upload one</Link>
              </p>
            )}
          </div>

          <div className={`${CARD} p-4`}>
            <h3 className="t-card text-[var(--color-ink)] mb-3">Section scores</h3>
            <div className="space-y-2">
              {iv.sectionScores?.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--color-ink-soft)] truncate">{s.title}</span>
                  <span className="t-card text-[var(--color-ink)]">{s.score == null ? <span className="text-[var(--color-ink-faint)]">—</span> : `${s.score}/5`}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`${CARD} p-4`}>
            <h3 className="t-card text-[var(--color-ink)] mb-3">Recommendation</h3>
            <div className="grid grid-cols-2 gap-2">
              {RECS.map(([k, label, Icon]) => (
                <button key={k} disabled={done} onClick={() => patch({ recommendation: k })}
                  className={`rounded-lg border py-2.5 text-xs font-semibold ${iv.recommendation === k ? RECOMMENDATION[k][1] : 'bg-white border-[var(--color-line)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]'} disabled:opacity-60`}>
                  <Icon size={15} className="mx-auto mb-1" />
                  {label}
                </button>
              ))}
            </div>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} disabled={done}
              onBlur={() => summary !== (iv.summary || '') && patch({ summary })}
              rows={5} placeholder="What stood out, good or bad"
              className="mt-3 w-full border border-[var(--color-line)] rounded-lg px-3 py-2.5 text-sm disabled:bg-[var(--color-fill)]" />
            <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
              {done ? `Completed ${dayTime(iv.completedAt)}` : `Booked ${dayTime(iv.scheduledAt)}`}
            </p>
            {!done && (
              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Date and time</span>
                <input type="datetime-local" value={toLocalInput(iv.scheduledAt)}
                  onChange={e => patch({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : iv.scheduledAt })}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
