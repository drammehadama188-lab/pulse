import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, FileText } from 'lucide-react';
import { api } from '../../lib/api.js';
import { STAGES } from './stages.js';
import { CARD, PageHead, StageChip, scoreTone, shortDate } from './ui.jsx';

// Profiles — every applicant as a person rather than a row to call. The
// Applicants list is the call sheet; this is how you find someone and open
// their record.

export default function Profiles() {
  const [applicants, setApplicants] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');

  useEffect(() => {
    Promise.all([
      api('/applicants').then(d => d.applicants || []).catch(() => []),
      api('/interviews').then(d => d.interviews || []).catch(() => []),
    ]).then(([a, i]) => { setApplicants(a); setInterviews(i); }).finally(() => setLoading(false));
  }, []);

  // Best score per person, so a card can say how they did without opening it.
  const bestScore = useMemo(() => {
    const t = {};
    for (const i of interviews) {
      if (i.totalScore == null) continue;
      if (t[i.applicantId] == null || i.totalScore > t[i.applicantId]) t[i.applicantId] = i.totalScore;
    }
    return t;
  }, [interviews]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applicants
      .filter(a => stage === 'all' || a.stage === stage)
      .filter(a => !q || `${a.name || ''} ${a.phone || ''} ${a.role || ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [applicants, query, stage]);

  const counts = useMemo(() => Object.fromEntries(STAGES.map(([k]) => [k, applicants.filter(a => a.stage === k).length])), [applicants]);
  const chip = 'rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors';
  const on = 'bg-[var(--color-brand-50)] text-[var(--color-brand)] border-[var(--color-brand-100)]';
  const off = 'bg-[var(--color-surface)] text-[var(--color-ink-soft)] border-[var(--color-line)] hover:bg-[var(--color-fill)]';

  return (
    <div>
      <PageHead title="Profiles" count={applicants.length || null}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a name or number…"
          className="w-64 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px]" />
      </PageHead>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setStage('all')} className={`${chip} ${stage === 'all' ? on : off}`}>All {applicants.length}</button>
        {STAGES.filter(([k]) => counts[k] > 0).map(([k, label]) => (
          <button key={k} onClick={() => setStage(k)} className={`${chip} ${stage === k ? on : off}`}>{label} {counts[k]}</button>
        ))}
      </div>

      {loading ? <p className="text-[13px] text-[var(--color-ink-soft)]">Loading…</p>
        : rows.length === 0 ? <div className={`${CARD} p-10 text-center text-[13px] text-[var(--color-ink-soft)]`}>Nobody matches that.</div>
          : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {rows.map(a => {
                const score = bestScore[a.id];
                return (
                  <Link key={a.id} to={`/recruitment/applicants/${a.id}`} className={`${CARD} card-quiet p-4 hover:border-[var(--color-ink-faint)]`}>
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[13px] font-semibold text-[var(--color-ink-soft)]">
                        {(a.name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{a.name}</span>
                        <span className="block truncate text-[11.5px] text-[var(--color-ink-faint)]">{a.role || 'No position filed'}</span>
                      </span>
                      {score != null && <span className={`text-[15px] font-semibold ${scoreTone(score)}`}>{score}</span>}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <StageChip stage={a.stage} />
                      {a.cv && <FileText size={13} className="text-[var(--color-ink-faint)]" />}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11.5px] text-[var(--color-ink-soft)]">
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                        <Phone size={11} className="shrink-0" />
                        {a.phoneValid === false ? 'No usable number' : a.phone || '—'}
                      </span>
                      <span className="shrink-0 text-[var(--color-ink-faint)]">{shortDate(a.createdAt)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
    </div>
  );
}
