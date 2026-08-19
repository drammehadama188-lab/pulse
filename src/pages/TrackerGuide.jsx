import { useState } from 'react'
import {
  MapPin, History, Bell, Hexagon, FileText, Power, Fuel, PlayCircle,
  ChevronDown, ShieldAlert,
} from 'lucide-react'
import { Card, Pill } from '../components/ui.jsx'

// Tracker Guide — the product, taught to staff the way a dev reads docs
// (Adama 19 Aug: "a page that tells them about the tracker functions").
// Every feature listed here was verified against the customer app's code:
// nothing is promised that the app does not do. Statuses are honest:
// Live = customers have it today; Launching = decided and coming, check
// before promising; Pilot = being tested, not for sale.

const FEATURES = [
  {
    icon: MapPin, title: 'Live map', status: 'Live', tone: 'good',
    what: 'Every vehicle on one map, updating live. Each vehicle shows as Moving, Idle, Parked or Offline, with its speed. A vehicle going over the limit is flagged as Overspeeding. From a vehicle you can open its spot in Google Maps, share the location, or call the driver.',
    show: 'Open the map and tap a moving vehicle. Let the customer watch it move on its own for a few seconds. That moment sells the product.',
    qa: [
      ['Is it really live?', 'Yes. While the vehicle moves, its position keeps updating on its own. No refresh needed.'],
      ['Can I watch it from abroad?', 'Yes. The app works anywhere with internet. Many of our customers are in the diaspora watching vehicles in Gambia.'],
    ],
  },
  {
    icon: History, title: 'Trip replay', status: 'Live', tone: 'good',
    what: 'Pick a vehicle, a date and a time range, and watch the whole route play back on the map. Stops and idle time show along the way, so the owner sees where the vehicle went, where it stayed, and for how long.',
    show: 'Replay yesterday for one vehicle. Owners of commercial vehicles react strongest to this one: it answers "where was my car all day" without a single phone call.',
    qa: [
      ['Can I see last week?', 'Yes. Pick any past date and time range.'],
    ],
  },
  {
    icon: Bell, title: 'Alerts', status: 'Live', tone: 'good',
    what: 'Push alerts straight to the phone: power cut, towing detected, vibration, speeding, low battery, SOS, engine on and off, and zone entry and exit. The customer chooses which alerts they want in Alert Preferences.',
    show: 'The power cut alert is the theft story. The tracker is wired to the vehicle and has its own backup battery inside. If a thief pulls the wires, the owner gets the alert and the tracker keeps reporting on its battery.',
    qa: [
      ['Will it spam me?', 'No. Alerts are off by default and the customer picks only the ones they want.'],
      ['What if the car is stolen?', 'They call our support line. We see the vehicle live and work with them. The tracker keeps reporting even with the vehicle power cut.'],
    ],
  },
  {
    icon: Hexagon, title: 'Geofence zones', status: 'Live', tone: 'good',
    what: 'The customer draws a zone on the map, like their home, the garage or the city. When a vehicle enters or leaves the zone they get an alert.',
    show: 'Draw a zone around the office while the customer watches. Explain: "if your car leaves this area at night, your phone rings."',
    qa: [
      ['How many zones can I make?', 'As many as they need. Each vehicle alerts on the zones it is linked to.'],
    ],
  },
  {
    icon: FileText, title: 'Reports', status: 'Live', tone: 'good',
    what: 'Ready-made reports per vehicle: Trips (distance and duration), Stops (where and how long), Geofence events, Speeding, Odometer, Engine hours, Ignition on and off, and a Daily summary with one row per vehicle per day.',
    show: 'For business owners, open Engine hours and Daily summary. That is the fleet story: fuel talk, driver talk and billing talk all start from these two.',
    qa: [
      ['Can a business get a monthly overview?', 'Yes. The Daily summary report covers every vehicle, day by day.'],
    ],
  },
  {
    icon: Power, title: 'Engine cut', status: 'Launching', tone: 'rest',
    what: 'A relay wired to the vehicle lets the owner block the engine from the app by holding the cut button. For safety it only works while the vehicle is parked, never while driving. Sold as a yearly add-on on the premium plan.',
    show: 'Do not promise this in a pitch yet. Hardware is in stock and the rollout is being planned. If a customer asks, take their name and tell the office. It is fine to say it is coming.',
    qa: [
      ['Can it stop a moving car?', 'No, and that is deliberate. Cutting a moving engine is dangerous. It blocks the engine from starting while parked.'],
    ],
  },
  {
    icon: Fuel, title: 'Fuel monitoring', status: 'Pilot', tone: 'rest',
    what: 'A fuel sensor that reads the tank level without opening it, being tested on real vehicles now. The goal: owners see fuel level and refills against trips, and theft or leakage shows up in the numbers.',
    show: 'Not for sale. Do not mention it in pitches unless the customer brings up fuel theft, and then only as "we are testing something for that".',
    qa: [],
  },
]

function Feature({ f }) {
  const [open, setOpen] = useState(false)
  const Icon = f.icon
  return (
    <Card className="p-5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}>
          <Icon size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-base font-bold text-[var(--color-ink)]">{f.title}</span>
            <Pill tone={f.tone} dot>{f.status}</Pill>
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-[var(--color-ink-soft)]">{f.what}</span>
        </span>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-[var(--color-ink-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-line-soft)] pt-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">How to show it</div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{f.show}</p>
          </div>
          {f.qa.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">Customers ask</div>
              <div className="mt-1.5 space-y-2">
                {f.qa.map(([q, a], i) => (
                  <div key={i} className="rounded-xl bg-[var(--color-fill)] px-3.5 py-2.5">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">{q}</p>
                    <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function TrackerGuide() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-ink)] md:text-3xl">Tracker Guide</h1>
        <p className="mt-1 text-[var(--color-ink-faint)]">What the tracker does, how to show it, and what customers ask.</p>
      </div>

      {/* The product in three sentences */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}>
            <ShieldAlert size={19} />
          </span>
          <div className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <p><span className="font-bold text-[var(--color-ink)]">The product:</span> a GPS tracker installed in the vehicle, wired to the vehicle's power with its own backup battery, with a SIM inside sending live data. The customer watches everything in the Damia Tracker app on their phone.</p>
            <p className="mt-2">It is a yearly subscription. Renewals go through the office.</p>
          </div>
        </div>
      </Card>

      {/* Demo tip */}
      <Card className="flex items-start gap-3 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}>
          <PlayCircle size={19} />
        </span>
        <div className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
          <p className="font-bold text-[var(--color-ink)]">Demoing to a customer</p>
          <p className="mt-1">Ask the office for today's demo link. It opens the real app, read only, with demo vehicles, and each link works for 60 minutes. Never demo with a real customer's account.</p>
        </div>
      </Card>

      <div className="space-y-3">
        {FEATURES.map((f) => <Feature key={f.title} f={f} />)}
      </div>
    </div>
  )
}
