import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { REACHED, INTERVIEWED } from './stages.js';
import { CARD, PageHead, fullDate, scoreTone, RECOMMENDATION } from './ui.jsx';

// One report answers one question. Everything is counted from the records —
// nothing here is entered by hand or kept in a second place.

const pct = (n, of) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—');

function Table({ title, question, head, rows, empty }) {
  return (
    <div className={`${CARD} p-5`}>
      <h3 className="text-sm font-bold text-[var(--color-ink)]">{title}</h3>
      <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">{question}</p>
      {rows.length === 0 ? <p className="mt-4 text-sm text-[var(--color-ink-faint)]">{empty}</p> : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)] border-b border-[var(--color-line-soft)]">
                {head.map((h, i) => <th key={h} className={`py-2 font-bold ${i ? 'text-right px-3' : 'pr-3'}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[var(--color-line-soft)] last:border-0">
                  {r.map((c, j) => <td key={j} className={`py-2.5 ${j ? 'text-right px-3 text-[var(--color-ink-soft)]' : 'pr-3 font-medium text-[var(--color-ink)]'}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [applicants, setApplicants] = useState([]);
  const [positions, setPositions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api('/applicants').then(d => d.applicants || []).catch(() => []),
      api('/positions').then(d => d.positions || []).catch(() => []),
      api('/interviews').then(d => d.interviews || []).catch(() => []),
    ]).then(([a, p, i]) => { setApplicants(a); setPositions(p); setInterviews(i); }).finally(() => setLoading(false));
  }, []);

  const bySource = useMemo(() => {
    const t = {};
    for (const a of applicants) {
      const k = (a.source || '').trim() || 'Not set';
      t[k] = t[k] || { applied: 0, reached: 0, interviewed: 0, hired: 0 };
      t[k].applied++;
      if (REACHED.includes(a.stage)) t[k].reached++;
      if (INTERVIEWED.includes(a.stage)) t[k].interviewed++;
      if (a.stage === 'hired') t[k].hired++;
    }
    return Object.entries(t).sort((x, y) => y[1].applied - x[1].applied)
      .map(([k, v]) => [k, v.applied, v.reached, v.interviewed, v.hired, pct(v.hired, v.applied)]);
  }, [applicants]);

  const byPosition = useMemo(() => positions.map(p => [
    p.title, p.applicantCount, p.interviewedCount, `${p.hiredCount}/${p.openings}`,
    p.status === 'open' ? 'Open' : 'Closed',
  ]), [positions]);

  const scored = useMemo(() => interviews.filter(i => i.status === 'completed' && i.totalScore != null)
    .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)), [interviews]);

  const scoreRows = scored.map(i => [
    <Link key={i.id} to={`/recruitment/interviews/${i.id}`} className="hover:underline">{i.applicantName}</Link>,
    i.templateName,
    i.interviewer || '—',
    i.recommendation ? RECOMMENDATION[i.recommendation][0] : '—',
    <span key="s" className={`font-bold ${scoreTone(i.totalScore)}`}>{i.totalScore}</span>,
  ]);

  // Time to hire reads the stage history: the day they were added against the
  // day the hire was recorded. Anyone hired before the history existed is left
  // out rather than guessed at.
  const timeToHire = useMemo(() => applicants.filter(a => a.stage === 'hired').map(a => {
    const hiredAt = (a.history || []).filter(h => h.stage === 'hired').pop()?.at;
    const start = a.createdAt;
    const days = hiredAt && start ? Math.max(0, Math.round((Date.parse(hiredAt) - Date.parse(start)) / 86400000)) : null;
    return [a.name, fullDate(start), hiredAt ? fullDate(hiredAt) : '—', days == null ? '—' : `${days} days`];
  }), [applicants]);

  const avgDays = useMemo(() => {
    const nums = timeToHire.map(r => parseInt(r[3], 10)).filter(n => !isNaN(n));
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  }, [timeToHire]);

  if (loading) return <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>;

  return (
    <div>
      <PageHead title="Reports" />
      <div className="space-y-5">
        <Table
          title="Where hires come from"
          question="Which channel is worth spending on?"
          head={['Channel', 'Applied', 'Reached', 'Interviewed', 'Hired', 'Hire rate']}
          rows={bySource}
          empty="No applicants yet." />
        <Table
          title="How each position is going"
          question="Which round still needs work?"
          head={['Position', 'Applied', 'Interviewed', 'Hired', 'Status']}
          rows={byPosition}
          empty="No positions yet." />
        <Table
          title="Interview scores"
          question="Who scored best, and who said so?"
          head={['Candidate', 'Questions', 'Interviewer', 'Recommendation', 'Score']}
          rows={scoreRows}
          empty="No completed interviews yet." />
        <Table
          title="Time to hire"
          question="How long from application to hired?"
          head={['Person', 'Added', 'Hired', 'Took']}
          rows={timeToHire}
          empty="Nobody hired yet." />
        {avgDays != null && <p className="text-xs text-[var(--color-ink-faint)]">Average across recorded hires: {avgDays} days.</p>}
      </div>
    </div>
  );
}
