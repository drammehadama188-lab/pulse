import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Circle, Download, Phone, Mail, Tag, User, Plus, Flag,
  ThumbsUp, ThumbsDown, HelpCircle, ChevronDown, ChevronRight, Trash2, MessageSquarePlus,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { CARD, BTN_PRIMARY, BTN_LIGHT, fullDate, dayTime, toLocalInput, scoreWord, RECOMMENDATION } from './ui.jsx';

// The interview room: questions on the left, the CV beside them, one score per
// answer, one recommendation at the end. Built to Adama's reference screen.
//
// 🔒 Scores are the average of what was actually rated — a question left blank
// is left out, not counted zero, so a half-finished interview does not read as
// a bad candidate. The total is that average as a percentage, computed on the
// server so this screen, the interview list and the reports all agree.

const SCORES = [[1, 'Poor'], [2, 'Fair'], [3, 'Average'], [4, 'Good'], [5, 'Excellent']];
const RECS = [
  ['strong_yes', 'Strong yes', ThumbsUp],
  ['yes', 'Yes', ThumbsUp],
  ['unsure', 'Unsure', HelpCircle],
  ['no', 'No', ThumbsDown],
];
// The room is one job — evaluate. The other tabs are the applicant's record,
// so they go there rather than being rebuilt here.
const TABS = [['overview', 'Overview'], ['cv', 'CV'], ['interview', 'Interview'], ['notes', 'Notes'], ['activity', 'Activity']];

export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [iv, setIv] = useState(null);
  const [applicant, setApplicant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [openQ, setOpenQ] = useState(0);
  const [notes, setNotes] = useState({});
  const [summary, setSummary] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState('');
  const askRef = useRef(null);

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
  const profileUrl = applicant ? `/recruitment/applicants/${applicant.id}` : '/recruitment/applicants';
  const section = iv?.sections?.[sectionIdx];
  const cvUrl = useMemo(() => (applicant?.cv ? `/api/applicants/${applicant.id}/cv?t=${encodeURIComponent(getToken() || '')}` : null), [applicant]);
  const totals = useMemo(() => {
    const qs = (iv?.sections || []).reduce((n, s) => n + s.questions.length, 0);
    return { questions: qs, sections: (iv?.sections || []).length };
  }, [iv]);

  async function complete() {
    if (!iv.recommendation) return setError('Choose a recommendation first — strong yes, yes, unsure or no.');
    // A total built from two answers out of sixteen is not a score of the
    // candidate, and once completed it is what every other screen quotes.
    const total = (iv.sections || []).reduce((n, s) => n + s.questions.length, 0);
    if (iv.answered < total && !window.confirm(
      `Only ${iv.answered} of ${total} questions are scored. The total (${iv.totalScore ?? '—'}/100) is the average of those ${iv.answered}.\n\nComplete the interview anyway?`
    )) return;
    setError(null);
    await patch({ status: 'completed', summary });
    navigate('/recruitment/interviews');
  }
  async function removeInterview() {
    if (!window.confirm('Delete this interview and its scores?')) return;
    await api(`/interviews/${id}`, { method: 'DELETE' });
    navigate('/recruitment/interviews');
  }
  async function askOnTheSpot() {
    const text = asking.trim();
    if (!text) return;
    await patch({ addQuestion: { sectionId: section.id, text } });
    setAsking('');
  }
  // The scorecard as plain text: what was asked, what they said, what it scored.
  function exportScorecard() {
    const lines = [
      `${iv.applicantName} — ${iv.templateName}`,
      `${iv.interviewer ? `Interviewer: ${iv.interviewer}` : ''}`,
      `${done ? `Completed ${dayTime(iv.completedAt)}` : `Booked ${dayTime(iv.scheduledAt)}`}`,
      `Score: ${iv.totalScore ?? '—'}/100${iv.totalScore != null ? ` (${scoreWord(iv.totalScore)})` : ''}`,
      iv.recommendation ? `Recommendation: ${RECOMMENDATION[iv.recommendation][0]}` : '',
      '', 'QUESTIONS', '',
    ];
    for (const s of iv.sections) {
      lines.push(s.title.toUpperCase());
      for (const q of s.questions) {
        const a = iv.answers?.[q.id] || {};
        lines.push(`  ${q.text}`);
        lines.push(`    Score: ${a.score ?? '—'}/5${a.flag ? '  [flagged]' : ''}`);
        if (a.notes) lines.push(`    Notes: ${a.notes}`);
      }
      lines.push('');
    }
    if (iv.summary) lines.push('WHAT STOOD OUT', iv.summary);
    const url = URL.createObjectURL(new Blob([lines.filter(l => l !== undefined).join('\n')], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${iv.applicantName.replace(/\s+/g, '-').toLowerCase()}-interview.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="t-body text-[var(--color-ink-faint)]">Loading…</p>;
  if (!iv) return <div className={`${CARD} p-12 text-center text-[13px] text-[var(--color-ink-soft)]`}>{error || 'Interview not found.'}</div>;

  const answeredCount = iv.answered;
  const initials = (iv.applicantName || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
    <div className="pb-20">
      <Link to={applicant ? `/recruitment/applicants/${applicant.id}` : '/recruitment/interviews'}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">
        <ArrowLeft size={14} /> Back to {applicant?.name || 'applicant'}
      </Link>

      {/* who, where they are in the process, and the two things you can do */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <Link to={profileUrl} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[16px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]" title="Open profile">
            {initials}
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <Link to={profileUrl} className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-ink)] hover:underline">{iv.applicantName}</Link>
              <span className="text-[13px] text-[var(--color-ink-soft)]">{applicant?.role || iv.templateName}</span>
              <Link to={profileUrl} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-brand)] hover:underline">
                <User size={12} /> View profile
              </Link>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-ink-soft)]">
              {applicant?.phone && <a href={`tel:${applicant.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-[var(--color-ink)]"><Phone size={12} /> {applicant.phone}</a>}
              {applicant?.email && <span className="inline-flex items-center gap-1.5"><Mail size={12} /> {applicant.email}</span>}
              {applicant?.source && <span className="inline-flex items-center gap-1.5"><Tag size={12} /> {applicant.source}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${done ? 'bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)]' : iv.status === 'in_progress' ? 'bg-[var(--color-stage-short-bg)] text-[var(--color-stage-short)]' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {done ? 'Completed' : iv.status === 'in_progress' ? 'Interview in progress' : 'Not started'}
          </span>
          <span className="text-[12px] text-[var(--color-ink-soft)]">
            {iv.answered} of {iv.totalQuestions} scored
            {iv.totalScore != null && <span className="ml-2 font-semibold text-[var(--color-ink)]">{iv.totalScore}/100</span>}
          </span>
          <button onClick={exportScorecard} className={BTN_LIGHT}><Download size={15} /> Export</button>
          <button onClick={removeInterview} title="Delete interview" className="rounded-[8px] border border-[var(--color-line)] p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]"><Trash2 size={15} /></button>
          {!done && <button onClick={complete} disabled={busy} className={`${BTN_PRIMARY} disabled:opacity-50`}>Complete interview</button>}
        </div>
      </div>

      {/* the record's own tabs; only Interview lives here */}
      <div className="mb-4 flex items-center gap-1 border-b border-[var(--color-line)]">
        {TABS.map(([k, label]) => (
          <Link key={k} to={k === 'interview' ? '#' : `/recruitment/applicants/${applicant?.id || ''}/${k}`}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-semibold ${k === 'interview' ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </Link>
        ))}
        <span className="ml-auto pb-2 text-[12px] text-[var(--color-ink-faint)]">{iv.templateName}</span>
      </div>

      {error && <p className="mb-4 text-[12.5px] text-[var(--color-stage-out)]">{error}</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)_380px]">
        {/* sections + what they told us on the form */}
        <div className="space-y-4">
          <div className={`${CARD} card-quiet p-4`}>
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">Interview sections</h2>
            <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{totals.sections} sections · {totals.questions} questions</p>
            <div className="mt-3 space-y-1">
              {iv.sections.map((s, i) => {
                const sc = iv.sectionScores?.find(x => x.id === s.id);
                const complete = sc && sc.answered === sc.of;
                const on = i === sectionIdx;
                return (
                  <button key={s.id} onClick={() => { setSectionIdx(i); setOpenQ(0); }}
                    className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left ${on ? 'bg-[var(--color-brand)] text-white' : 'hover:bg-[var(--color-fill)]'}`}>
                    <span className={`flex-1 truncate text-[12.5px] font-semibold ${on ? 'text-white' : 'text-[var(--color-ink)]'}`}>{i + 1}. {s.title}</span>
                    <span className={`text-[11px] ${on ? 'text-white/80' : 'text-[var(--color-ink-faint)]'}`}>{sc?.answered || 0}/{sc?.of || s.questions.length}</span>
                    {complete
                      ? <Check size={14} className={on ? 'text-white' : 'text-[var(--color-good)]'} />
                      : <Circle size={12} className={on ? 'text-white/60' : 'text-[var(--color-line)]'} />}
                  </button>
                );
              })}
            </div>
            {!done && (
              <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
                <label className="block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">Ask a question on the spot</label>
                <textarea ref={askRef} value={asking} onChange={e => setAsking(e.target.value)} rows={2}
                  placeholder="It joins this interview only"
                  className="mt-1.5 w-full rounded-[8px] border border-[var(--color-line)] px-2.5 py-2 text-[12.5px]" />
                <button onClick={askOnTheSpot} disabled={!asking.trim() || busy}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-brand)] disabled:opacity-40">
                  <Plus size={13} /> Add to {section?.title}
                </button>
              </div>
            )}
          </div>

          {/* the reference has CV questions here; ours are the answers they
              actually gave on the application, which is the same job */}
          {applicant && Object.keys(applicant.answers || {}).length > 0 && (
            <div className={`${CARD} card-quiet p-4`}>
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">From their application</h2>
              <div className="mt-2.5 space-y-2.5">
                {Object.entries(applicant.answers).slice(0, 4).map(([q, v]) => (
                  <div key={q}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{q}</p>
                    <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-soft)]">{v}</p>
                    {!done && (
                      <button onClick={() => { setAsking(`About your application: "${String(v).slice(0, 80)}" — tell me more.`); askRef.current?.focus(); }}
                        className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--color-brand)]">
                        <MessageSquarePlus size={12} /> Ask about this
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Link to={`/recruitment/applicants/${applicant.id}`} className="mt-3 inline-block text-[12px] font-semibold text-[var(--color-brand)]">View the whole application</Link>
            </div>
          )}
        </div>

        {/* the questions themselves */}
        <div className="space-y-4">
          <div className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11.5px] text-[var(--color-ink-faint)]">Section {sectionIdx + 1} of {totals.sections}</p>
                <h2 className="mt-0.5 text-[18px] font-semibold text-[var(--color-ink)]">{sectionIdx + 1}. {section.title}</h2>
              </div>
              {sectionIdx < iv.sections.length - 1 && (
                <button onClick={() => { setSectionIdx(i => i + 1); setOpenQ(0); }} className={BTN_LIGHT}>
                  Next section <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>

          {section.questions.map((q, qi) => {
            const ans = iv.answers?.[q.id] || {};
            const open = openQ === qi;
            const answered = ans.score >= 1;
            return (
              <div key={q.id} className={`${CARD} ${open ? 'p-5' : 'px-5 py-3.5'}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-[6px] bg-[var(--color-fill)] px-1.5 py-1 text-[10.5px] font-semibold text-[var(--color-ink-soft)]">Q{qi + 1}</span>
                  <button onClick={() => setOpenQ(open ? -1 : qi)} className="flex-1 text-left">
                    <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{q.text}</span>
                  </button>
                  {ans.flag && <Flag size={13} className="mt-1 shrink-0 text-[var(--color-stage-interview)]" />}
                  {answered && (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-good-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-good)]">
                      <Check size={11} /> {ans.score}/5
                    </span>
                  )}
                  <button onClick={() => setOpenQ(open ? -1 : qi)} className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]">
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                </div>

                {open && (
                  <>
                    <label className="mt-4 block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">Interviewer notes</label>
                    <textarea
                      value={notes[q.id] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [q.id]: e.target.value }))}
                      onBlur={() => (notes[q.id] ?? '') !== (ans.notes || '') && patch({ answer: { questionId: q.id, notes: notes[q.id] ?? '' } })}
                      disabled={done}
                      rows={3} placeholder="What they actually said"
                      className="mt-1.5 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2.5 text-[12.5px] disabled:bg-[var(--color-fill)]" />

                    <label className="mt-4 block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">Score this answer</label>
                    <div className="mt-1.5 grid grid-cols-5 gap-2">
                      {SCORES.map(([n, label]) => (
                        <button key={n} disabled={done}
                          onClick={() => patch({ answer: { questionId: q.id, score: ans.score === n ? null : n } })}
                          className={`rounded-[8px] border py-2 text-center transition-colors ${ans.score === n ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white' : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]'} disabled:opacity-60`}>
                          <span className="block text-[15px] font-semibold">{n}</span>
                          <span className="block text-[10px]">{label}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-[var(--color-ink-faint)]">Rate from 1 (Poor) to 5 (Excellent)</span>
                      <button disabled={done} onClick={() => patch({ answer: { questionId: q.id, flag: !ans.flag } })}
                        className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${ans.flag ? 'text-[var(--color-stage-interview)]' : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]'}`}>
                        <Flag size={12} /> Flag for follow up
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* what the scores add up to */}
          <div className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">Interview evaluation</h2>
              <div className="text-right">
                <p className="text-[11.5px] text-[var(--color-ink-faint)]">Total score</p>
                <p className={`text-[26px] font-semibold leading-none ${iv.totalScore == null ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>
                  {iv.totalScore ?? '—'}<span className="text-[15px] text-[var(--color-ink-faint)]">/100</span>
                </p>
                <p className="mt-0.5 text-[11.5px] text-[var(--color-good)]">{scoreWord(iv.totalScore)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
              {iv.sectionScores?.map(s => (
                <div key={s.id}>
                  <p className="truncate text-[11.5px] text-[var(--color-ink-soft)]">{s.title}</p>
                  <p className="mt-1 text-[15px] font-semibold text-[var(--color-ink)]">
                    {s.score == null ? <span className="text-[var(--color-ink-faint)]">—</span> : Math.round(s.score * 2 * 10) / 10}
                    <span className="text-[11.5px] font-normal text-[var(--color-ink-faint)]">/10</span>
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-[var(--color-ink-faint)]">
              Each section is the average of the answers you scored, out of 10. {answeredCount} of {totals.questions} scored so far.
            </p>
          </div>
        </div>

        {/* CV, the record in brief, and the decision */}
        <div className="space-y-4 2xl:col-auto">
          <div className={`${CARD} card-quiet p-4`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">CV</h2>
              {cvUrl && <a href={`${cvUrl}&download=1`} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]" title="Download"><Download size={14} /></a>}
            </div>
            {cvUrl ? (
              String(applicant.cv.mimeType).startsWith('image/')
                ? <img src={cvUrl} alt="CV" className="w-full rounded-[8px] border border-[var(--color-line)]" />
                : <iframe title="CV" src={cvUrl} className="h-80 w-full rounded-[8px] border border-[var(--color-line)]" />
            ) : (
              <p className="text-[12px] text-[var(--color-ink-soft)]">
                No CV on file. <Link to={applicant ? `/recruitment/applicants/${applicant.id}/cv` : '#'} className="font-semibold text-[var(--color-brand)]">Upload one</Link>
              </p>
            )}
          </div>

          <div className={`${CARD} card-quiet p-4`}>
            <h2 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">Candidate summary</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                ['Applied on', fullDate(applicant?.appliedAt) || fullDate(applicant?.createdAt)],
                ['Source', [applicant?.source, applicant?.form].filter(Boolean).join(' · ')],
                ['Can start now', applicant?.startNow === true ? 'Yes' : applicant?.startNow === false ? 'No' : ''],
                ['Applying for', applicant?.role],
                ['Phone', applicant?.phoneValid === false ? 'No usable number' : applicant?.phone],
                ['Email', applicant?.email],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-[11px] text-[var(--color-ink-faint)]">{label}</p>
                  <p className="truncate text-[12.5px] text-[var(--color-ink)]">{value || <span className="text-[var(--color-ink-faint)]">—</span>}</p>
                </div>
              ))}
            </div>
            {applicant?.experience && (
              <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
                <p className="text-[11px] text-[var(--color-ink-faint)]">What they have sold</p>
                <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-soft)]">{applicant.experience}</p>
              </div>
            )}
          </div>

          <div className={`${CARD} p-4`}>
            <h2 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">Your final assessment</h2>
            <div className="grid grid-cols-2 gap-2">
              {RECS.map(([k, label, Icon]) => (
                <button key={k} disabled={done} onClick={() => patch({ recommendation: k })}
                  className={`rounded-[8px] border py-2.5 text-[11.5px] font-semibold transition-colors ${iv.recommendation === k ? RECOMMENDATION[k][1] : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]'} disabled:opacity-60`}>
                  <Icon size={14} className="mx-auto mb-1" />
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-[11.5px] font-semibold text-[var(--color-ink-soft)]">What stood out</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} disabled={done}
              onBlur={() => summary !== (iv.summary || '') && patch({ summary })}
              rows={5} placeholder="Strengths, concerns, overall impression"
              className="mt-1.5 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2.5 text-[12.5px] disabled:bg-[var(--color-fill)]" />
            {!done && (
              <label className="mt-3 block">
                <span className="text-[11px] text-[var(--color-ink-faint)]">Date and time</span>
                <input type="datetime-local" value={toLocalInput(iv.scheduledAt)}
                  onChange={e => patch({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : iv.scheduledAt })}
                  className="mt-1 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[12.5px]" />
              </label>
            )}
            <p className="mt-3 text-[11px] text-[var(--color-ink-faint)]">{done ? `Completed ${dayTime(iv.completedAt)}` : `Booked ${dayTime(iv.scheduledAt)}`}</p>
          </div>
        </div>
      </div>

      {/* the bar that follows you down the page */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur md:pl-[216px]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-2.5 md:px-8">
          <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${error ? 'font-semibold text-[var(--color-stage-out)]' : 'text-[var(--color-ink-faint)]'}`}>
            {error ? `Not saved — ${error}` : savedAt
              ? <><Check size={13} className="text-[var(--color-good)]" /> Saved {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>
              : 'Every answer saves as you go'}
          </span>
          <div className="flex items-center gap-2">
            <Link to="/recruitment/interviews" className={BTN_LIGHT}>Save and exit</Link>
            {!done && <button onClick={complete} disabled={busy} className={`${BTN_PRIMARY} disabled:opacity-50`}>Complete interview</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
