import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Card } from '../components/ui.jsx'

// Tracker Guide — the product taught as a short course (Adama 19 Aug: "a page
// that tells them about the tracker functions like learning a dev").
//
// v4, 19 Aug: the bold line under each heading now SAYS WHAT THE THING IS.
// Adama: "just explain what each is, stop with the cheeky your phone rings
// bull, these are new agents they do not know what these are". Slogans teach
// a new agent nothing. The bullets he approved are untouched.
//
// v3, 19 Aug: Adama cut the sales scaffolding — "all these are so badly
// written and make no sense, can be plain, just explain the functions and what
// each does". Gone: the "show it", "they will ask" and "say it to the
// customer" blocks. What is left is a heading, one line, and bullets that say
// what the function is and what it does.
//
// Engine cut and fuel monitoring were removed entirely ("all the testing this
// are so unnecessary" — neither is for sale). Put them back as normal lessons
// when they launch, not as "coming soon" cards.
//
// Every claim is verified against the customer app's code. Nothing here
// promises what the app does not do — and per Adama, the install is described
// honestly: hard to find, never guaranteed.

const STORE = 'tracker-guide-learned'
const readLearned = () => { try { return new Set(JSON.parse(localStorage.getItem(STORE) || '[]')) } catch { return new Set() } }

const LESSONS = [
  {
    id: 'product', name: 'What you are selling',
    what: 'A small GPS device fitted in the vehicle that shows the owner where it is at any time.',
    points: [
      "Wired into the vehicle's brain box. Not easily detected or removed, but we do not guarantee a thief will never find it.",
      'Its own backup battery keeps it reporting if the wires are pulled.',
      'A SIM inside sends live data to the Damia Tracker app on the phone.',
      'Works anywhere there is internet, including from abroad.',
      'Yearly subscription. Renewals go through the office.',
    ],
  },
  {
    id: 'map', name: 'Live map',
    what: 'One map showing every vehicle the customer owns, moving as they move.',
    points: [
      'Each vehicle shows as Moving, Idle, Parked or Offline, with its live speed.',
      'The map updates on its own while the vehicle moves. Nothing to refresh.',
      'Going over the speed limit flags the vehicle as Overspeeding right away.',
      'From any vehicle: open the spot in Google Maps, share the location, or call the driver.',
    ],
  },
  {
    id: 'replay', name: 'Trip replay',
    what: 'A playback of everywhere a vehicle went on a chosen day.',
    points: [
      'Pick a vehicle, a day and a time range.',
      'The whole route plays back on the map, with every stop and every idle.',
      'Any past date can be replayed, not only today.',
    ],
  },
  {
    id: 'alerts', name: 'Alerts',
    what: 'Messages the tracker sends to the phone on its own when something happens to the vehicle.',
    points: [
      'Alerts for power cut, towing, vibration, speeding, low battery, SOS, engine on and off, and zone entry and exit.',
      'Each one is pushed straight to the phone.',
      'The customer chooses which alerts they want in Alert Preferences.',
      'If the wires are cut, the power-cut alert fires and the tracker keeps reporting on its backup battery.',
    ],
  },
  {
    id: 'zones', name: 'Geofence zones',
    what: 'An area the customer draws on the map so they are told when a vehicle goes in or out of it.',
    points: [
      'The customer draws a zone on the map: home, the garage, the city.',
      'Any vehicle entering or leaving that zone sends an alert.',
      'As many zones as the customer needs.',
    ],
  },
  {
    id: 'reports', name: 'Reports',
    what: 'Summaries of how the vehicles were used over a chosen period, ready to read or print.',
    points: [
      'Reports available: Trips, Stops, Geofence, Speeding, Odometer, Engine hours, Ignition and Daily summary.',
      'Daily summary gives one row per vehicle per day.',
      'Engine hours shows how long each engine ran.',
    ],
  },
  {
    id: 'demo', name: 'Demoing to a customer',
    what: 'A temporary link that opens the real app with demo vehicles, for showing a customer.',
    points: [
      'Ask the office for today’s demo link. It opens the real app, read only, with demo vehicles.',
      'Each link works for 60 minutes, so get it fresh before the meeting.',
    ],
  },
]

function Lesson({ n, l, learned, onToggle }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${learned ? 'bg-emerald-100 text-emerald-700' : 'text-[var(--color-brand)]'}`} style={learned ? undefined : { background: 'var(--color-brand-50)' }}>
          {learned ? <CheckCircle2 size={18} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{l.name}</span>
          <p className="mt-1 text-lg font-extrabold leading-snug tracking-tight text-[var(--color-ink)] sm:text-xl">{l.what}</p>

          <ul className="mt-3 space-y-1.5">
            {l.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
                <span>{p}</span>
              </li>
            ))}
          </ul>

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
