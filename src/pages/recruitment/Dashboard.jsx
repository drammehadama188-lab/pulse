import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users, CalendarCheck, Star, BadgeCheck, XCircle, ArrowRight, Plus, Briefcase, Download, Rocket, CalendarDays,
  Inbox, PhoneCall, ClipboardCheck, Handshake, UserCheck, UserPlus, CalendarPlus, FileText,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { PIPELINE, DROPPED, STAGES, INTERVIEWED, SHORTLISTED, OFFERED } from './stages.js';
import { CARD, CardHead, PageHead, BTN_PRIMARY, BTN_LIGHT, Kpi, Sparkline, Donut, RangePicker, RANGES, FeedRow, Empty, ago, dayTime, scoreWord } from './ui.jsx';

// Recruitment Dashboard — see. Not understand, not evaluate, not analyse:
// those are the applicant profile, the interview room and Reports.
//
// Every number is counted from the same records the other pages work from, and
// every number is a link — if Interview says 8, clicking it shows those eight.

const DAY = 24 * 3600 * 1000;
const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);
// Someone "entered" a stage when it was written into their history. Records
// from before the history existed simply do not count towards a change.
const enteredSince = (list, stage, t) =>
  list.filter(a => (a.history || []).some(h => h.stage === stage && Date.parse(h.at || '') >= t)).length;

const STAGE_ICON = { new: Inbox, screening: PhoneCall, interview: ClipboardCheck, shortlisted: Star, offer: Handshake, hired: UserCheck };
const STAGE_TINT = {
  new: 'var(--color-stage-new-bg)', screening: 'var(--color-stage-screening-bg)', interview: 'var(--color-stage-interview-bg)',
  shortlisted: 'var(--color-stage-short-bg)', offer: 'var(--color-stage-offer-bg)', hired: 'var(--color-stage-hired-bg)',
};
const SOURCE_COLORS = ['var(--color-stage-new)', 'var(--color-stage-screening)', 'var(--color-stage-short)', 'var(--color-stage-interview)', 'var(--color-stage-offer)', 'var(--color-ink-faint)'];
// What each kind of activity looks like in the feed.
const ACT = {
  added: [UserPlus, 'var(--color-stage-new-bg)', 'var(--color-stage-new)'],
  booked: [CalendarPlus, 'var(--color-stage-interview-bg)', 'var(--color-stage-interview)'],
  scored: [FileText, 'var(--color-stage-screening-bg)', 'var(--color-stage-screening)'],
  short: [Star, 'var(--color-stage-short-bg)', 'var(--color-stage-short)'],
  offer: [Handshake, 'var(--color-stage-offer-bg)', 'var(--color-stage-offer)'],
  hired: [UserCheck, 'var(--color-stage-hired-bg)', 'var(--color-stage-hired)'],
  out: [XCircle, 'var(--color-stage-out-bg)', 'var(--color-stage-out)'],
  moved: [ClipboardCheck, 'var(--color-fill)', 'var(--color-ink-soft)'],
};
const actKind = (stage) =>
  stage === 'shortlisted' ? 'short' : stage === 'offer' ? 'offer' : stage === 'hired' ? 'hired'
    : DROPPED.includes(stage) ? 'out' : 'moved';

export default function Dashboard() {
  const [applicants, setApplicants] = useState([]);
  const [positions, setPositions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('7d');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api('/applicants').then(d => d.applicants || []).catch(() => []),
      api('/positions').then(d => d.positions || []).catch(() => []),
      api('/interviews').then(d => d.interviews || []).catch(() => []),
    ]).then(([a, p, i]) => { setApplicants(a); setPositions(p); setInterviews(i); }).finally(() => setLoading(false));
  }, []);

  // Export is the list as it stands — name, phone, stage, source, dates — so
  // it opens in Excel without anybody re-typing it.
  function exportReport() {
    const head = ['Name', 'Phone', 'Email', 'Stage', 'Source', 'Role', 'Can start now', 'Applied', 'Added', 'Notes'];
    const rows = applicants.map(a => [
      a.name, a.phone, a.email, (STAGES.find(s => s[0] === a.stage) || [])[1] || a.stage,
      a.source, a.role, a.startNow === true ? 'Yes' : a.startNow === false ? 'No' : '',
      a.appliedAt || '', a.createdAt || '', (a.notes || '').replace(/\s+/g, ' '),
    ]);
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `damia-applicants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const days = RANGES.find(r => r[0] === range)?.[2] || 7;
  const rangeLabel = `from last ${days} days`;

  const m = useMemo(() => {
    const total = applicants.length;
    const inSet = (keys) => applicants.filter(a => keys.includes(a.stage)).length;
    const from = Date.now() - days * DAY;

    const stages = PIPELINE.map(([key, label, keys, color]) => ({
      key, label, color,
      count: applicants.filter(a => keys.includes(a.stage)).length,
      delta: keys.reduce((n, s) => n + enteredSince(applicants, s, from), 0),
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

    // Activity comes out of the records themselves — there is no separate
    // event log that could fall out of step with them.
    const events = [];
    for (const a of applicants) {
      events.push({ at: a.createdAt, kind: 'added', title: 'New applicant added', line: `${a.name} applied for ${a.role || 'a position'}`, to: `/recruitment/applicants/${a.id}` });
      for (const h of a.history || []) {
        if (h.stage === 'cv_received') continue;
        const label = STAGES.find(s => s[0] === h.stage)?.[1] || h.stage;
        events.push({ at: h.at, kind: actKind(h.stage), title: `Applicant ${label.toLowerCase()}`, line: a.name, to: `/recruitment/applicants/${a.id}` });
      }
    }
    for (const i of interviews) {
      events.push({ at: i.createdAt, kind: 'booked', title: 'Interview scheduled', line: `${i.applicantName}${i.interviewer ? ` with ${i.interviewer}` : ''}`, to: `/recruitment/interviews/${i.id}` });
      if (i.completedAt) events.push({ at: i.completedAt, kind: 'scored', title: 'Interview scored', line: `${i.applicantName} · ${i.totalScore}/100 ${scoreWord(i.totalScore)}`, to: `/recruitment/interviews/${i.id}` });
    }

    // Eight buckets the width of the chosen window, oldest first.
    const bucket = Math.max(1, Math.round(days / 8));
    const series = (stamps) => {
      const out = Array(8).fill(0);
      for (const s of stamps) {
        const t = Date.parse(s || '');
        if (isNaN(t)) continue;
        const back = Math.floor((Date.now() - t) / (bucket * DAY));
        if (back >= 0 && back < 8) out[7 - back]++;
      }
      return out;
    };
    const stageStamps = (stage) => applicants.flatMap(a => (a.history || []).filter(h => h.stage === stage).map(h => h.at));

    return {
      total, stages, worked, dropped,
      dropRate: pct(dropped, worked),
      dropWhere: WHERE[dropCounts[0]?.[0]] || '',
      scheduled: interviews.filter(i => i.status !== 'completed').length,
      scheduledDelta: interviews.filter(i => i.status !== 'completed' && Date.parse(i.createdAt || '') >= from).length,
      shortlisted: inSet(['shortlisted']),
      offers: inSet(['offer']),
      rejected: inSet(['rejected']),
      newDelta: applicants.filter(a => Date.parse(a.createdAt || '') >= from).length,
      shortDelta: enteredSince(applicants, 'shortlisted', from),
      offerDelta: enteredSince(applicants, 'offer', from),
      rejectDelta: enteredSince(applicants, 'rejected', from),
      sources, upcoming,
      events: events.filter(e => e.at).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5),
      openPositions: positions.filter(p => p.status === 'open'),
      rates: {
        applications: total,
        interview: pct(inSet(INTERVIEWED), total),
        shortlist: pct(inSet(SHORTLISTED), total),
        offer: pct(inSet(OFFERED), total),
        hired: inSet(['hired']),
      },
      trends: {
        applications: series(applicants.map(a => a.createdAt)),
        interview: series(stageStamps('interviewed')),
        shortlist: series(stageStamps('shortlisted')),
        offer: series(stageStamps('offer')),
        hired: series(stageStamps('hired')),
      },
    };
  }, [applicants, positions, interviews, days]);

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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page text-[var(--color-ink)]">Recruitment Dashboard</h1>
          <p className="t-support mt-1">Overview of your hiring pipeline and recruitment performance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={exportReport} className={BTN_LIGHT}><Download size={16} /> Export report</button>
          <Link to="/recruitment/positions?new=1" className={BTN_PRIMARY}><Plus size={16} /> Create position</Link>
        </div>
      </div>
      <div className="mb-5 flex justify-end"><RangePicker value={range} onChange={setRange} /></div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={Users} label="Total applicants" value={m.total} delta={m.newDelta} deltaLabel={rangeLabel}
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" onClick={() => navigate('/recruitment/applicants?stage=all')} />
        <Kpi icon={CalendarCheck} label="Interviews scheduled" value={m.scheduled} delta={m.scheduledDelta} deltaLabel={rangeLabel}
          tint="var(--color-stage-screening-bg)" ink="var(--color-stage-screening)" onClick={() => navigate('/recruitment/interviews')} />
        <Kpi icon={Star} label="Shortlisted" value={m.shortlisted} delta={m.shortDelta} deltaLabel={rangeLabel}
          tint="var(--color-stage-short-bg)" ink="var(--color-stage-short)" onClick={() => navigate('/recruitment/applicants?stage=shortlisted')} />
        <Kpi icon={BadgeCheck} label="Offers" value={m.offers} delta={m.offerDelta} deltaLabel={rangeLabel}
          tint="var(--color-stage-interview-bg)" ink="var(--color-stage-interview)" onClick={() => navigate('/recruitment/applicants?stage=offer')} />
        <Kpi icon={XCircle} label="Rejected" value={m.rejected} delta={m.rejectDelta} deltaLabel={rangeLabel}
          tint="var(--color-stage-out-bg)" ink="var(--color-stage-out)" onClick={() => navigate('/recruitment/applicants?stage=rejected')} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-6`}>
          <CardHead title="Hiring pipeline" action={
            <Link to="/recruitment/applicants?stage=all" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
              View full pipeline <ArrowRight size={14} />
            </Link>} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
            {m.stages.map(s => {
              const Icon = STAGE_ICON[s.key];
              return (
                <button key={s.key} onClick={() => navigate(s.to)} className="group text-left">
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-[7px]" style={{ background: STAGE_TINT[s.key], color: s.color }}>
                      <Icon size={13} strokeWidth={2.2} />
                    </span>
                    <span className="t-label group-hover:text-[var(--color-ink)]">{s.label}</span>
                  </span>
                  <span className="mt-2 flex items-baseline gap-2">
                    <span className="text-[24px] font-semibold leading-none text-[var(--color-ink)]">{s.count}</span>
                    {s.delta > 0 && <span className="text-[12.5px] font-medium text-[var(--color-good)]">+{s.delta} in</span>}
                  </span>
                  <span className="mt-3 block h-[3px] rounded-full" style={{ background: s.color, opacity: s.count ? 1 : 0.25 }} />
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[10px] bg-[var(--color-fill)] p-5">
            <div>
              <div className="t-label">Drop-off rate</div>
              <div className="mt-1 text-[26px] font-semibold leading-none text-[var(--color-ink)]">{m.dropRate}%</div>
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="t-support mb-2">Overall drop-off</div>
              <div className="h-2 rounded-full bg-[var(--color-line)]">
                <div className="h-full rounded-full bg-[var(--color-stage-new)]" style={{ width: `${m.dropRate}%` }} />
              </div>
            </div>
            <p className="t-support max-w-xs flex-1">
              {m.dropped} of the {m.worked} people worked so far dropped out{m.dropWhere ? `, most at ${m.dropWhere}` : ''}.
            </p>
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHead title="Applicants by source" />
          <div className="flex flex-1 flex-wrap items-center justify-center gap-6">
            <Donut total={m.total} slices={m.sources.map(([, v], i) => ({ value: v, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }))} />
            <div className="min-w-[150px] flex-1 space-y-3">
              {m.sources.map(([label, n], i) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                  <span className="t-body flex-1 truncate text-[var(--color-ink-soft)]">{label}</span>
                  <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">{n}</span>
                  <span className="w-14 text-right text-[12.5px] text-[var(--color-ink-faint)]">({pct(n, m.total)}%)</span>
                </div>
              ))}
            </div>
          </div>
          <Link to="/recruitment/reports" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            View full report <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${CARD} flex flex-col p-6`}>
          <CardHead title="Open positions" action={
            <Link to="/recruitment/positions" className="text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">View all</Link>} />
          {m.openPositions.length === 0
            ? <Empty>No open position yet. Add the job you are hiring for and applicants file under it.</Empty>
            : (
              <div className="flex-1 divide-y divide-[var(--color-line-soft)]">
                {m.openPositions.slice(0, 4).map(p => (
                  <Link key={p.id} to={`/recruitment/applicants?position=${p.id}&stage=all`} className="group flex items-center gap-3 py-4 first:pt-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-fill)] text-[var(--color-ink-soft)]">
                      <Briefcase size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body block truncate font-semibold text-[var(--color-ink)] group-hover:underline">{p.title}</span>
                      <span className="t-support block truncate">{[p.employment, p.location].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="flex shrink-0 gap-4 text-center">
                      {[[p.applicantCount, 'Applicants'], [p.interviewedCount, 'Interviewing'], [`${p.hiredCount}/${p.openings}`, 'Hired']].map(([v, l]) => (
                        <span key={l} className="block">
                          <span className="block text-[15px] font-semibold text-[var(--color-ink)]">{v}</span>
                          <span className="block text-[11px] text-[var(--color-ink-faint)]">{l}</span>
                        </span>
                      ))}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          <Link to="/recruitment/positions" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            <Plus size={14} /> Create new position
          </Link>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHead title="Upcoming interviews" action={
            <Link to="/recruitment/calendar" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
              View calendar <ArrowRight size={14} />
            </Link>} />
          {m.upcoming.length === 0
            ? <Empty>Nothing booked. Open an applicant and start an interview.</Empty>
            : (
              <div className="flex-1 divide-y divide-[var(--color-line-soft)]">
                {m.upcoming.slice(0, 4).map(i => (
                  <div key={i.id} className="flex items-center gap-3 py-4 first:pt-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[12px] font-semibold text-[var(--color-ink-soft)]">
                      {(i.applicantName || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body block truncate font-semibold text-[var(--color-ink)]">{i.applicantName}</span>
                      <span className="t-support flex items-center gap-1.5 truncate"><CalendarDays size={12} /> {dayTime(i.scheduledAt)}{i.interviewer ? ` · ${i.interviewer}` : ''}</span>
                    </span>
                    <Link to={`/recruitment/interviews/${i.id}`}
                      className="shrink-0 rounded-[9px] border border-[var(--color-line)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">
                      Interview
                    </Link>
                  </div>
                ))}
              </div>
            )}
          <Link to="/recruitment/interviews" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            View all interviews <ArrowRight size={14} />
          </Link>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHead title="Recent activity" />
          <div className="flex-1 divide-y divide-[var(--color-line-soft)]">
            {m.events.map((e, i) => {
              const [Icon, tint, ink] = ACT[e.kind] || ACT.moved;
              return <FeedRow key={i} as={Link} to={e.to} icon={Icon} tint={tint} ink={ink} title={e.title} line={e.line} meta={ago(e.at)} />;
            })}
            {m.events.length === 0 && <Empty>Nothing has happened yet.</Empty>}
          </div>
          <Link to="/recruitment/applicants?stage=all" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            View all activity <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-6`}>
          <CardHead title="Recruitment performance" action={
            <Link to="/recruitment/reports" className="text-[13px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">Reports</Link>} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-7 md:grid-cols-3 lg:grid-cols-5">
            {[
              ['Applications', m.rates.applications, m.newDelta, m.trends.applications, 'var(--color-stage-new)'],
              ['Interview rate', `${m.rates.interview}%`, null, m.trends.interview, 'var(--color-stage-screening)'],
              ['Shortlist rate', `${m.rates.shortlist}%`, m.shortDelta, m.trends.shortlist, 'var(--color-stage-short)'],
              ['Offer rate', `${m.rates.offer}%`, m.offerDelta, m.trends.offer, 'var(--color-stage-interview)'],
              ['Hired', m.rates.hired, null, m.trends.hired, 'var(--color-stage-hired)'],
            ].map(([label, value, delta, points, color]) => (
              <div key={label}>
                <div className="t-label">{label}</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[24px] font-semibold leading-none text-[var(--color-ink)]">{value}</span>
                  {delta > 0 && <span className="text-[12.5px] font-medium text-[var(--color-good)]">↑ {delta}</span>}
                </div>
                <div className="mt-2.5"><Sparkline points={points} color={color} /></div>
              </div>
            ))}
          </div>
          <p className="t-support mt-5">Lines cover the last {days} days. Rates are of all applicants and count only moves recorded in Pulse.</p>
        </div>

        <div className={`${CARD} flex flex-col justify-center p-6`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--color-brand-50)] text-[var(--color-brand)]">
            <Rocket size={22} strokeWidth={2} />
          </span>
          <h2 className="t-card mt-4 text-[var(--color-ink)]">Improve your hiring</h2>
          <p className="t-support mt-1.5">Ask every candidate the same questions and score them the same way.</p>
          <Link to="/recruitment/templates" className={`${BTN_LIGHT} mt-5 self-start`}>View templates</Link>
        </div>
      </div>
    </div>
  );
}
