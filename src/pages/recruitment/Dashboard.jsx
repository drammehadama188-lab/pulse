import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, CalendarCheck, Star, BadgeCheck, XCircle, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PIPELINE, DROPPED, STAGES, INTERVIEWED, SHORTLISTED, OFFERED } from './stages.js';
import { CARD, CardHead, PageHead, Kpi, Sparkline, Donut, StageChip, ago, dayTime, scoreWord } from './ui.jsx';

// Recruitment Dashboard — see. Not understand, not evaluate, not analyse:
// those are the applicant profile, the interview room and Reports.
//
// Every number is counted from the same records the other pages work from, and
// every number is a link — if Interview says 8, clicking it shows those eight.

const WEEK = 7 * 24 * 3600 * 1000;
const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);
const since = (n = 1) => Date.now() - n * WEEK;
// Someone "entered" a stage when it was written into their history. Records
// from before the history existed simply do not count towards a change.
const enteredSince = (list, stage, t) =>
  list.filter(a => (a.history || []).some(h => h.stage === stage && Date.parse(h.at || '') >= t)).length;

const SOURCE_COLORS = ['var(--color-stage-new)', 'var(--color-stage-screening)', 'var(--color-stage-interview)', 'var(--color-stage-short)', 'var(--color-stage-offer)', 'var(--color-ink-faint)'];

export default function Dashboard() {
  const [applicants, setApplicants] = useState([]);
  const [positions, setPositions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api('/applicants').then(d => d.applicants || []).catch(() => []),
      api('/positions').then(d => d.positions || []).catch(() => []),
      api('/interviews').then(d => d.interviews || []).catch(() => []),
    ]).then(([a, p, i]) => { setApplicants(a); setPositions(p); setInterviews(i); }).finally(() => setLoading(false));
  }, []);

  const m = useMemo(() => {
    const total = applicants.length;
    const inSet = (keys) => applicants.filter(a => keys.includes(a.stage)).length;
    const week = since(1);

    const stages = PIPELINE.map(([key, label, keys, color]) => ({
      key, label, color,
      count: applicants.filter(a => keys.includes(a.stage)).length,
      delta: keys.reduce((n, s) => n + enteredSince(applicants, s, week), 0),
      to: `/recruitment/applicants?stage=${keys[0]}`,
    }));

    // Drop-off is measured against the people actually worked — everyone who
    // has left New. Counting it against the whole pile would call an untouched
    // backlog a failure.
    const worked = total - inSet(['cv_received']);
    const dropped = inSet(DROPPED);
    const dropCounts = DROPPED.map(s => [s, applicants.filter(a => a.stage === s).length]).sort((a, b) => b[1] - a[1]);
    const WHERE = { unreachable: 'the number never answers', not_interested: 'the first call', not_qualified: 'screening', rejected: 'the interview' };

    const sources = Object.entries(applicants.reduce((t, a) => {
      const k = (a.source || '').trim() || 'Not set';
      t[k] = (t[k] || 0) + 1;
      return t;
    }, {})).sort((x, y) => y[1] - x[1]);

    const now = Date.now();
    const upcoming = interviews
      .filter(i => i.status !== 'completed' && Date.parse(i.scheduledAt || '') >= now - 3600 * 1000)
      .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));

    // Activity: what actually happened, newest first, from the records
    // themselves — there is no separate event log to fall out of step.
    const events = [];
    for (const a of applicants) {
      events.push({ at: a.createdAt, title: 'New applicant added', line: `${a.name} applied for ${a.role || 'a position'}`, to: `/recruitment/applicants/${a.id}` });
      for (const h of a.history || []) {
        if (h.stage === 'cv_received') continue;
        events.push({ at: h.at, title: `Applicant ${(STAGES.find(s => s[0] === h.stage)?.[1] || h.stage).toLowerCase()}`, line: a.name, to: `/recruitment/applicants/${a.id}`, stage: h.stage });
      }
    }
    for (const i of interviews) {
      events.push({ at: i.createdAt, title: 'Interview scheduled', line: `${i.applicantName}${i.interviewer ? ` with ${i.interviewer}` : ''}`, to: `/recruitment/interviews/${i.id}` });
      if (i.completedAt) events.push({ at: i.completedAt, title: 'Interview scored', line: `${i.applicantName} · ${i.totalScore}/100 ${scoreWord(i.totalScore)}`, to: `/recruitment/interviews/${i.id}` });
    }

    // Eight weekly buckets, oldest first.
    const weekly = (stamps) => {
      const buckets = Array(8).fill(0);
      for (const s of stamps) {
        const t = Date.parse(s || '');
        if (isNaN(t)) continue;
        const weeksAgo = Math.floor((Date.now() - t) / WEEK);
        if (weeksAgo >= 0 && weeksAgo < 8) buckets[7 - weeksAgo]++;
      }
      return buckets;
    };
    const stageStamps = (stage) => applicants.flatMap(a => (a.history || []).filter(h => h.stage === stage).map(h => h.at));

    return {
      total,
      stages,
      worked,
      dropped,
      dropRate: pct(dropped, worked),
      dropWhere: WHERE[dropCounts[0]?.[0]] || '',
      dropTop: dropCounts[0] || ['', 0],
      scheduled: interviews.filter(i => i.status !== 'completed').length,
      scheduledDelta: interviews.filter(i => i.status !== 'completed' && Date.parse(i.createdAt || '') >= week).length,
      shortlisted: inSet(['shortlisted']),
      offers: inSet(['offer']),
      rejected: inSet(['rejected']),
      hired: inSet(['hired']),
      newDelta: applicants.filter(a => Date.parse(a.createdAt || '') >= week).length,
      shortDelta: enteredSince(applicants, 'shortlisted', week),
      offerDelta: enteredSince(applicants, 'offer', week),
      rejectDelta: enteredSince(applicants, 'rejected', week),
      sources,
      upcoming,
      events: events.filter(e => e.at).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 6),
      openPositions: positions.filter(p => p.status === 'open'),
      rates: {
        applications: total,
        interview: pct(inSet(INTERVIEWED), total),
        shortlist: pct(inSet(SHORTLISTED), total),
        offer: pct(inSet(OFFERED), total),
        hired: inSet(['hired']),
      },
      trends: {
        applications: weekly(applicants.map(a => a.createdAt)),
        interview: weekly(stageStamps('interviewed')),
        shortlist: weekly(stageStamps('shortlisted')),
        offer: weekly(stageStamps('offer')),
        hired: weekly(stageStamps('hired')),
      },
    };
  }, [applicants, positions, interviews]);

  if (loading) return <p className="t-body text-[var(--color-ink-faint)]">Loading…</p>;

  if (m.total === 0) {
    return (
      <div>
        <PageHead title="Recruitment" />
        <div className={`${CARD} p-12 text-center`}>
          <p className="t-body text-[var(--color-ink-faint)]">
            Nothing to show yet. <Link to="/recruitment/applicants" className="font-semibold text-[var(--color-ink)] underline">Import a list</Link> or add the first CV you receive.
          </p>
        </div>
      </div>
    );
  }

  const pipeMax = Math.max(...m.stages.map(s => s.count), 1);

  return (
    <div>
      <PageHead title="Recruitment" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi icon={Users} label="Total applicants" value={m.total} delta={m.newDelta}
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" onClick={() => navigate('/recruitment/applicants?stage=all')} />
        <Kpi icon={CalendarCheck} label="Interviews scheduled" value={m.scheduled} delta={m.scheduledDelta}
          tint="var(--color-stage-interview-bg)" ink="var(--color-stage-interview)" onClick={() => navigate('/recruitment/interviews')} />
        <Kpi icon={Star} label="Shortlisted" value={m.shortlisted} delta={m.shortDelta}
          tint="var(--color-stage-short-bg)" ink="var(--color-stage-short)" onClick={() => navigate('/recruitment/applicants?stage=shortlisted')} />
        <Kpi icon={BadgeCheck} label="Offers" value={m.offers} delta={m.offerDelta}
          tint="var(--color-stage-offer-bg)" ink="var(--color-stage-offer)" onClick={() => navigate('/recruitment/applicants?stage=offer')} />
        <Kpi icon={XCircle} label="Rejected" value={m.rejected} delta={m.rejectDelta}
          tint="var(--color-stage-out-bg)" ink="var(--color-stage-out)" onClick={() => navigate('/recruitment/applicants?stage=rejected')} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={`${CARD} p-6 xl:col-span-2`}>
          <CardHead title="Hiring pipeline" action={<Link to="/recruitment/applicants?stage=all" className="text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">All applicants</Link>} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            {m.stages.map(s => (
              <button key={s.key} onClick={() => navigate(s.to)} className="group text-left">
                <div className="t-label group-hover:text-[var(--color-ink)]">{s.label}</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[24px] font-semibold leading-none text-[var(--color-ink)]">{s.count}</span>
                  {s.delta > 0 && <span className="text-[12.5px] font-medium text-[var(--color-good)]">+{s.delta}</span>}
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-[var(--color-line-soft)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, (s.count / pipeMax) * 100)}%`, background: s.color }} />
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--color-line-soft)] pt-5">
            <div className="flex items-center justify-between gap-4">
              <span className="t-label">Drop-off rate</span>
              <span className="text-[20px] font-semibold text-[var(--color-ink)]">{m.dropRate}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[var(--color-line-soft)]">
              <div className="h-full rounded-full bg-[var(--color-stage-out)]" style={{ width: `${m.dropRate}%` }} />
            </div>
            <p className="t-support mt-2.5">
              {m.dropped} of the {m.worked} people you have worked dropped out{m.dropWhere ? `, most at ${m.dropWhere}` : ''}.
            </p>
          </div>
        </div>

        <div className={`${CARD} p-6`}>
          <CardHead title="Applicants by source" />
          <div className="flex items-center justify-center">
            <Donut total={m.total} slices={m.sources.map(([, v], i) => ({ value: v, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }))} />
          </div>
          <div className="mt-5 space-y-2.5">
            {m.sources.map(([label, n], i) => (
              <div key={label} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                <span className="t-body flex-1 truncate text-[var(--color-ink-soft)]">{label}</span>
                <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">{n}</span>
                <span className="w-12 text-right text-[12.5px] text-[var(--color-ink-faint)]">{pct(n, m.total)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${CARD} p-6`}>
          <CardHead title="Open positions" action={<Link to="/recruitment/positions" className="text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">Manage</Link>} />
          {m.openPositions.length === 0 && <p className="t-support">No open position. Add the job you are hiring for.</p>}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {m.openPositions.slice(0, 4).map(p => (
              <Link key={p.id} to={`/recruitment/applicants?position=${p.id}&stage=all`} className="group block py-4 first:pt-0 last:pb-0">
                <div className="t-body font-semibold text-[var(--color-ink)] group-hover:underline">{p.title}</div>
                <div className="t-support mt-0.5">{[p.employment, p.location].filter(Boolean).join(' · ')}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-ink-soft)]">
                  <span><span className="font-semibold text-[var(--color-ink)]">{p.applicantCount}</span> applicants</span>
                  <span><span className="font-semibold text-[var(--color-ink)]">{p.interviewedCount}</span> interviewed</span>
                  <span><span className="font-semibold text-[var(--color-ink)]">{p.hiredCount}</span>/{p.openings} hired</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className={`${CARD} p-6`}>
          <CardHead title="Upcoming interviews" />
          {m.upcoming.length === 0 && <p className="t-support">Nothing booked.</p>}
          <div className="divide-y divide-[var(--color-line-soft)]">
            {m.upcoming.slice(0, 4).map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-4 first:pt-0">
                <div className="min-w-0">
                  <div className="t-body truncate font-semibold text-[var(--color-ink)]">{i.applicantName}</div>
                  <div className="t-support mt-0.5 truncate">{i.templateName}</div>
                  <div className="t-support mt-0.5">{dayTime(i.scheduledAt)}</div>
                </div>
                <Link to={`/recruitment/interviews/${i.id}`}
                  className="shrink-0 rounded-[10px] border border-[var(--color-line)] px-3 py-2 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">
                  Interview
                </Link>
              </div>
            ))}
          </div>
          {m.upcoming.length > 0 && (
            <Link to="/recruitment/interviews" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
              View all interviews <ArrowRight size={14} />
            </Link>
          )}
        </div>

        <div className={`${CARD} p-6`}>
          <CardHead title="Recent activity" />
          <div className="space-y-4">
            {m.events.map((e, i) => (
              <Link key={i} to={e.to} className="group block">
                <div className="flex items-center gap-2">
                  <span className="t-body font-semibold text-[var(--color-ink)] group-hover:underline">{e.title}</span>
                  {e.stage && <StageChip stage={e.stage} />}
                </div>
                <div className="t-support mt-0.5 truncate">{e.line}</div>
                <div className="t-support mt-0.5 text-[12px]">{ago(e.at)}</div>
              </Link>
            ))}
            {m.events.length === 0 && <p className="t-support">Nothing has happened yet.</p>}
          </div>
        </div>
      </div>

      <div className={`${CARD} mt-6 p-6`}>
        <CardHead title="Recruitment performance" action={<Link to="/recruitment/reports" className="text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">Reports</Link>} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3 lg:grid-cols-5">
          {[
            ['Applications', m.rates.applications, m.trends.applications, 'var(--color-stage-new)'],
            ['Interview rate', `${m.rates.interview}%`, m.trends.interview, 'var(--color-stage-interview)'],
            ['Shortlist rate', `${m.rates.shortlist}%`, m.trends.shortlist, 'var(--color-stage-short)'],
            ['Offer rate', `${m.rates.offer}%`, m.trends.offer, 'var(--color-stage-offer)'],
            ['Hired', m.rates.hired, m.trends.hired, 'var(--color-stage-hired)'],
          ].map(([label, value, points, color]) => (
            <div key={label}>
              <div className="t-label">{label}</div>
              <div className="mt-1 text-[24px] font-semibold leading-none text-[var(--color-ink)]">{value}</div>
              <div className="mt-2"><Sparkline points={points} color={color} /></div>
            </div>
          ))}
        </div>
        <p className="t-support mt-5">Lines show the last 8 weeks by volume. Rates are of all applicants, and only count moves recorded in Pulse.</p>
      </div>
    </div>
  );
}
