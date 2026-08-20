import { useMemo } from 'react';
import { Users, PhoneCall, CalendarCheck, UserCheck, Zap } from 'lucide-react';
import { STAGES, CALLED, REACHED, INTERVIEWED } from './stages.js';

// Recruitment Overview — the first screen of the hiring section (20 Aug 2026).
// Every number here is counted from the same applicant records the list works
// from, so a tile and a chip can never disagree. Nothing is stored twice and
// there is no separate dashboard endpoint to fall out of date.

const pct = (n, of) => (of > 0 ? Math.round((n / of) * 100) : 0);

function Tile({ icon: Icon, label, value, sub, tone = 'bg-gray-100 text-gray-600' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17} strokeWidth={2.2} /></span>
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

// A row of a breakdown: name, bar, count. Used for both channels and roles so
// the two read the same way.
function BarRow({ label, count, of, onClick }) {
  const width = of > 0 ? Math.max(2, (count / of) * 100) : 0;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`w-full flex items-center gap-3 text-left ${onClick ? 'group' : ''}`}>
      <span className={`w-40 shrink-0 truncate text-sm text-gray-700 ${onClick ? 'group-hover:text-gray-900' : ''}`}>{label}</span>
      <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <span className="block h-full rounded-full bg-gray-900/80" style={{ width: `${width}%` }} />
      </span>
      <span className="w-16 shrink-0 text-right text-sm font-semibold text-gray-900">{count}</span>
      <span className="w-10 shrink-0 text-right text-xs text-gray-400">{pct(count, of)}%</span>
    </Tag>
  );
}

export default function Overview({ applicants, loading, onOpenStage }) {
  const m = useMemo(() => {
    const total = applicants.length;
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

    return {
      total,
      toCall: byStage.cv_received || 0,
      called: inSet(CALLED),
      reached: inSet(REACHED),
      interviewed: inSet(INTERVIEWED),
      hired: byStage.hired || 0,
      canStart: applicants.filter(a => a.startNow === true).length,
      noPhone: applicants.filter(a => a.phoneValid === false).length,
      byStage,
      sources: group(a => a.source),
      roles: group(a => a.role),
    };
  }, [applicants]);

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (m.total === 0) {
    return <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">No applicants yet. Import a list or add the first CV you receive.</div>;
  }

  // The funnel is built from stage sets, not single stages: someone who was
  // hired was also reached and interviewed, and a funnel that forgets that
  // reads as if nobody ever got through.
  const funnel = [
    ['Applicants', m.total, m.total],
    ['Called', m.called, m.total],
    ['Reached', m.reached, m.called],
    ['Interviewed', m.interviewed, m.reached],
    ['Hired', m.hired, m.interviewed],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Tile icon={Users} label="Applicants" value={m.total} sub={`${m.canStart} can start now`} />
        <Tile icon={PhoneCall} label="Still to call" value={m.toCall} tone="bg-blue-50 text-blue-600" sub={`${pct(m.called, m.total)}% of the pile worked`} />
        <Tile icon={Zap} label="Reached" value={m.reached} tone="bg-orange-50 text-orange-600" sub={`of ${m.called} called`} />
        <Tile icon={CalendarCheck} label="Interviewed" value={m.interviewed} tone="bg-amber-50 text-amber-600" sub={`${pct(m.interviewed, m.reached)}% of reached`} />
        <Tile icon={UserCheck} label="Hired" value={m.hired} tone="bg-emerald-50 text-emerald-600" sub={m.total ? `1 hire per ${m.hired ? Math.round(m.total / m.hired) : '—'} applicants` : ''} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5">
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

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Where they came from</h3>
          <div className="space-y-3">
            {m.sources.map(([label, n]) => <BarRow key={label} label={label} count={n} of={m.total} />)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Pipeline</h3>
          <div className="space-y-3">
            {STAGES.map(([k, label]) => (
              <BarRow key={k} label={label} count={m.byStage[k] || 0} of={m.total} onClick={() => onOpenStage(k)} />
            ))}
          </div>
          {m.noPhone > 0 && <p className="mt-4 text-xs text-gray-400">{m.noPhone} of these have no usable phone number and cannot be called.</p>}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Applying for</h3>
          <div className="space-y-3">
            {m.roles.map(([label, n]) => <BarRow key={label} label={label} count={n} of={m.total} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
