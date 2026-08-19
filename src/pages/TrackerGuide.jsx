import { useState } from 'react'
import { CheckCircle2, Quote } from 'lucide-react'
import { Card } from '../components/ui.jsx'

// Tracker Guide — the product taught as a short course (Adama 19 Aug: "a page
// that tells them about the tracker functions like learning a dev"; 19 Aug v2
// after "write up and design so bad": lessons, pitch lines and say-it scripts
// instead of paragraph cards). Every claim verified against the customer app's
// code. Nothing here promises what the app does not do.

const STORE = 'tracker-guide-learned'
const readLearned = () => { try { return new Set(JSON.parse(localStorage.getItem(STORE) || '[]')) } catch { return new Set() } }

const LESSONS = [
  {
    id: 'product', name: 'What you are selling',
    pitch: 'You always know where your vehicle is. Even if it is stolen.',
    points: [
      'A small box installed in the vehicle, wired to its power, out of sight.',
      'It has its own backup battery. Pulling the wires does not kill it.',
      'A SIM inside sends live data to the Damia Tracker app on the phone.',
      'Yearly subscription. Renewals go through the office.',
    ],
    say: 'You open the app and see your car, live, wherever you are in the world.',
  },
  {
    id: 'map', name: 'Live map',
    pitch: 'Every vehicle, live on one map.',
    points: [
      'Each vehicle shows as Moving, Idle, Parked or Offline, with its live speed.',
      'Going over the speed limit flags the vehicle as Overspeeding right away.',
      'From any vehicle: open the spot in Google Maps, share it, or call the driver.',
    ],
    show: 'Tap a moving vehicle and let the customer watch it move. Say nothing for a few seconds. That moment sells.',
    ask: [
      ['Is it really live?', 'Yes. It updates on its own while the vehicle moves. No refreshing.'],
      ['Can I watch from abroad?', 'Yes, anywhere with internet. Many owners watch from the diaspora.'],
    ],
  },
  {
    id: 'replay', name: 'Trip replay',
    pitch: 'Where was my car all day? Answered in one minute.',
    points: [
      'Pick a vehicle, a day and a time range.',
      'The whole route plays back on the map, with every stop and every idle.',
    ],
    show: 'Replay yesterday for one vehicle. Commercial owners react strongest: no more calling the driver to ask where he went.',
    ask: [
      ['Can I see last week?', 'Yes. Any past date and time range.'],
    ],
  },
  {
    id: 'alerts', name: 'Alerts',
    pitch: 'The car calls for help by itself.',
    points: [
      'Power cut, towing, vibration, speeding, low battery, SOS, engine on and off, zone entry and exit.',
      'Pushed straight to the phone. The customer picks which ones in Alert Preferences, so no spam.',
    ],
    say: 'If a thief pulls the wires, your phone rings. And the tracker keeps reporting on its own battery.',
    ask: [
      ['What if my car is stolen?', 'Call our support line. We see the vehicle live and work with you until it is recovered.'],
    ],
  },
  {
    id: 'zones', name: 'Geofence zones',
    pitch: 'Your phone rings if the car leaves the area.',
    points: [
      'The customer draws a zone on the map: home, the garage, the city.',
      'Any vehicle entering or leaving the zone sends an alert.',
    ],
    show: 'Draw a zone around where you are standing while they watch, then explain: if your car leaves this area at night, your phone rings.',
    ask: [
      ['How many zones can I make?', 'As many as you need.'],
    ],
  },
  {
    id: 'reports', name: 'Reports',
    pitch: 'The whole fleet on paper, without hiring a clerk.',
    points: [
      'Trips, Stops, Geofence, Speeding, Odometer, Engine hours, Ignition, Daily summary.',
      'Daily summary gives one row per vehicle per day. Engine hours shows how long each engine ran.',
    ],
    show: 'For a business owner, open Engine hours and Daily summary. Fuel talk, driver talk and billing talk all start from those two.',
  },
  {
    id: 'cut', name: 'Engine cut', status: 'Coming, do not promise it',
    pitch: 'Block the engine from the phone. Only while parked.',
    points: [
      'A relay wired into the vehicle lets the owner block the engine from the app.',
      'For safety it never works while driving. It stops a parked car from starting.',
      'Sold as a yearly add-on on the premium plan. Hardware is in stock, rollout being planned.',
    ],
    show: 'Do not sell it yet. If a customer asks, take their name and tell the office. Saying it is coming is fine.',
  },
  {
    id: 'fuel', name: 'Fuel monitoring', status: 'Testing, not for sale',
    pitch: 'Fuel theft shows up in the numbers.',
    points: [
      'A sensor reads the tank level without opening the tank. Being tested on real vehicles now.',
      'Only mention it if the customer raises fuel theft, and then only as: we are testing something for that.',
    ],
  },
  {
    id: 'demo', name: 'Demoing to a customer',
    pitch: 'Demo with the demo link. Never with a real customer’s account.',
    points: [
      'Ask the office for today’s demo link. It opens the real app, read only, with demo vehicles.',
      'Each link works for 60 minutes, so get it fresh before the meeting.',
    ],
    show: 'Practice the live map and trip replay on the demo link until you can do both without thinking.',
  },
]

const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]'

function Lesson({ n, l, learned, onToggle }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${learned ? 'bg-emerald-100 text-emerald-700' : 'text-[var(--color-brand)]'}`} style={learned ? undefined : { background: 'var(--color-brand-50)' }}>
          {learned ? <CheckCircle2 size={18} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{l.name}</span>
            {l.status && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">{l.status}</span>}
          </div>
          <p className="mt-1 text-lg font-extrabold leading-snug tracking-tight text-[var(--color-ink)] sm:text-xl">{l.pitch}</p>

          <ul className="mt-3 space-y-1.5">
            {l.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {l.say && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border-l-4 border-[var(--color-brand)] px-4 py-3" style={{ background: 'var(--color-brand-50)' }}>
              <Quote size={14} className="mt-0.5 shrink-0 text-[var(--color-brand)]" />
              <div>
                <div className={LABEL}>Say it to the customer</div>
                <p className="mt-0.5 text-sm font-semibold leading-relaxed text-[var(--color-ink)]">{l.say}</p>
              </div>
            </div>
          )}

          {l.show && (
            <div className="mt-4">
              <div className={LABEL}>Show it</div>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-ink)]">{l.show}</p>
            </div>
          )}

          {l.ask?.length > 0 && (
            <div className="mt-4">
              <div className={LABEL}>They will ask</div>
              <div className="mt-1 space-y-1">
                {l.ask.map(([q, a], i) => (
                  <p key={i} className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    <span className="font-semibold text-[var(--color-ink)]">{q}</span> {a}
                  </p>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onToggle}
            className={`mt-4 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${learned ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}
          >
            {learned ? 'Learned' : 'Mark as learned'}
          </button>
        </div>
      </div>
    </Card>
  )
}

export default function TrackerGuide() {
  const [learned, setLearned] = useState(readLearned)
  const toggle = (id) => setLearned((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    localStorage.setItem(STORE, JSON.stringify([...next]))
    return next
  })
  const done = LESSONS.filter((l) => learned.has(l.id)).length

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-ink)] md:text-3xl">Tracker Guide</h1>
        <p className="mt-1 text-[var(--color-ink-faint)]">{LESSONS.length} short lessons. Learn them and you can sell the tracker.</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / LESSONS.length) * 100}%` }} />
          </div>
          <span className="shrink-0 text-xs font-bold text-[var(--color-ink-soft)]">{done} of {LESSONS.length} learned</span>
        </div>
      </div>

      {LESSONS.map((l, i) => (
        <Lesson key={l.id} n={i + 1} l={l} learned={learned.has(l.id)} onToggle={() => toggle(l.id)} />
      ))}
    </div>
  )
}
