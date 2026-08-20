import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, PhoneCall, CalendarCheck, UserCheck, Briefcase } from 'lucide-react';
import { api } from '../../lib/api.js';
import { STAGES, CALLED, REACHED, INTERVIEWED } from './stages.js';
import { CARD, PageHead, dayTime, scoreTone, scoreWord } from './ui.jsx';

// Recruitment Dashboard — the first screen of the department (20 Aug 2026).
// Every number is counted from the same records the other pages work from, so
// a tile here and a chip on the applicant list cannot disagree. There is no
// dashboard endpoint holding its own copy of anything.

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);

function Tile({ icon: Icon, label, value, sub, tone = 'bg-gray-100 text-gray-600', to }) {
  const Wrap = to ? Link : 'div';
  return (
    <Wrap {...(to ? { to } : {})} className={`${CARD} block p-5 ${to ? 'hover:border-gray-300 transition-colors' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17} strokeWidth={2.2} /></span>
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </Wrap>
  );
}

function BarRow({ label, count, of, onClick }) {
  const width = of > 0 ? Math.max(2, (count / of) * 100) : 0;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className="w-full flex items-center gap-3 text-left group">
      <span className="w-40 shrink-0 truncate text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
      <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <span className="block h-full rounded-full bg-gray-900/80" style={{ width: `${width}%` }} />
      </span>
      <span className="w-14 shrink-0 text-right text-sm font-semibold text-gray-900">{count}</span>
      <span className="w-10 shrink-0 text-right text-xs text-gray-400">{pct(count, of)}%</span>
    </Tag>
  );
}

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
    const inSet = (keys) => applicants.filter(a => keys.includes(a.stage)).length;
    const byStage = Object.fromEntries(STAGES.map(([k]) => [k, applicants.filter(a => a.stage === k).length]));
    const group = (pick) => {
      const t = {};
      for (const a of applicants) {
        const key = (pick(a) || '').trim() || 'Not set';
        t[key] = (t[key] || 0) + 1;
      }
      return Object.entries(t).sort((x, y) => y[1] - x[1]);
    };
    const now = Date.now();
    const week = now + 7 * 24 * 3600 * 1000;
    const upcoming = interviews
      .filter(i => i.status !== 'completed' && Date.parse(i.scheduledAt || '') >= now - 3600 * 1000)
      .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
    return {
      total: applicants.length,
      toCall: byStage.cv_received || 0,
      called: inSet(CALLED),
      reached: inSet(REACHED),
      interviewed: inSet(INTERVIEWED),
      hired: byStage.hired || 0,
      canStart: applicants.filter(a => a.startNow === true).length,
      noPhone: applicants.filter(a => a.phoneValid === false).length,
      byStage,
      sources: group(a => a.source),
      upcoming,
      thisWeek: upcoming.filter(i => Date.parse(i.scheduledAt || '') <= week).length,
      done: interviews.filter(i => i.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')),
      openPositions: positions.filter(p => p.status === 'open'),
    };
  }, [applicants, positions, interviews]);

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>;

  // The funnel counts stage SETS, not single stages: someone hired was also
  // reached and interviewed, and a funnel that forgets that reads as if nobody
  // ever got through.
  const funnel = [
    ['Applicants', m.total, m.total],
    ['Called', m.called, m.total],
    ['Reached', m.reached, m.called],
    ['Interviewed', m.interviewed, m.reached],
    ['Hired', m.hired, m.interviewed],
  ];

  return (
    <div>
      <PageHead title="Recruitment" />

      {m.total === 0 ? (
        <div className={`${CARD} p-12 text-center text-gray-400 text-sm`}>
          Nothing to show yet. <Link to="/recruitment/applicants" className="text-gray-900 font-medium underline">Import a list</Link> or add the first CV you receive.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Tile icon={Users} label="Applicants" value={m.total} sub={`${m.canStart} can start now`} to="/recruitment/applicants?stage=all" />
            <Tile icon={PhoneCall} label="Still to call" value={m.toCall} tone="bg-blue-50 text-blue-600" sub={`${pct(m.called, m.total)}% of the pile worked`} to="/recruitment/applicants?stage=cv_received" />
            <Tile icon={CalendarCheck} label="Interviews booked" value={m.thisWeek} tone="bg-amber-50 text-amber-600" sub="next 7 days" to="/recruitment/interviews" />
            <Tile icon={UserCheck} label="Hired" value={m.hired} tone="bg-emerald-50 text-emerald-600" sub={m.hired ? `1 per ${Math.round(m.total / m.hired)} applicants` : 'none yet'} to="/recruitment/applicants?stage=hired" />
            <Tile icon={Briefcase} label="Open positions" value={m.openPositions.length} sub={`${m.openPositions.reduce((n, p) => n + (p.openings || 1), 0)} seats to fill`} to="/recruitment/positions" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`${CARD} lg:col-span-2 p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Hiring funnel</h3>
              <div className="space-y-3">
                {funnel.map(([label, n, of], i) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-gray-700">{label}</span>
                    <span className="flex-1 h-7 rounded-lg bg-gray-100 overflow-hidden">
                      <span className="block h-full rounded-lg bg-gray-900" style={{ width: `${m.total > 0 ? Math.max(1, (n / m.total) * 100) : 0}%` }} />
                    </span>
                    <span className="w-14 shrink-0 text-right text-sm font-bold text-gray-900">{n}</span>
                    <span className="w-16 shrink-0 text-right text-xs text-gray-400">{i === 0 ? '' : `${pct(n, of)}% on`}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${CARD} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Where they came from</h3>
              <div className="space-y-3">
                {m.sources.map(([label, n]) => <BarRow key={label} label={label} count={n} of={m.total} />)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`${CARD} lg:col-span-2 p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-4">Pipeline</h3>
              <div className="space-y-3">
                {STAGES.map(([k, label]) => (
                  <BarRow key={k} label={label} count={m.byStage[k] || 0} of={m.total}
                    onClick={() => navigate(`/recruitment/applicants?stage=${k}`)} />
                ))}
              </div>
              {m.noPhone > 0 && <p className="mt-4 text-xs text-gray-400">{m.noPhone} of these have no usable phone number and cannot be called.</p>}
            </div>

            <div className="space-y-5">
              <div className={`${CARD} p-5`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-gray-900">Next interviews</h3>
                  <Link to="/recruitment/interviews" className="text-xs font-medium text-gray-500 hover:text-gray-900">All</Link>
                </div>
                {m.upcoming.length === 0 && <p className="text-sm text-gray-400">None booked.</p>}
                <div className="space-y-2">
                  {m.upcoming.slice(0, 5).map(i => (
                    <Link key={i.id} to={`/recruitment/interviews/${i.id}`} className="block rounded-xl border border-gray-100 px-3 py-2.5 hover:border-gray-300">
                      <p className="text-sm font-medium text-gray-900 truncate">{i.applicantName}</p>
                      <p className="text-xs text-gray-500">{dayTime(i.scheduledAt)}{i.interviewer ? ` · ${i.interviewer}` : ''}</p>
                    </Link>
                  ))}
                </div>
              </div>

              {m.done.length > 0 && (
                <div className={`${CARD} p-5`}>
                  <h3 className="text-sm font-bold text-gray-900 mb-4">Scored</h3>
                  <div className="space-y-2">
                    {m.done.slice(0, 5).map(i => (
                      <Link key={i.id} to={`/recruitment/interviews/${i.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5 hover:border-gray-300">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900 truncate">{i.applicantName}</span>
                          <span className="block text-xs text-gray-400">{scoreWord(i.totalScore)}</span>
                        </span>
                        <span className={`text-lg font-extrabold ${scoreTone(i.totalScore)}`}>{i.totalScore ?? '—'}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {m.openPositions.length > 0 && (
            <div className={`${CARD} p-5`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900">Open positions</h3>
                <Link to="/recruitment/positions" className="text-xs font-medium text-gray-500 hover:text-gray-900">Manage</Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {m.openPositions.map(p => (
                  <Link key={p.id} to={`/recruitment/applicants?position=${p.id}`} className="rounded-xl border border-gray-100 p-4 hover:border-gray-300">
                    <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{[p.department, p.location].filter(Boolean).join(' · ')}</p>
                    <p className="mt-3 text-xs text-gray-600">{p.applicantCount} applicants · {p.interviewedCount} interviewed · {p.hiredCount}/{p.openings} hired</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
