import { useState, useEffect, useMemo } from 'react'
import { api } from '../lib/api.js'
import PerformanceBoard from './departments/PerformanceBoard.jsx'
import HRTeam from './departments/HRTeam.jsx'

// Performance section. Two views:
//  • "Performance" — the manager's operating-system board (PerformanceBoard).
//  • "KPI Settings" — reuses the existing HRTeam KPI-rules editor unchanged.
export default function Performance() {
  const [tab, setTab] = useState('performance')
  const [warnings, setWarnings] = useState([])
  // 🔒 The people scored here are the LIVE roster — the same list Employees
  // shows. It used to be the static src/data/team.js seed file, so anyone hired
  // or moved in Pulse never appeared on the board at all, and a leaver could
  // still be ranked on it.
  const [roster, setRoster] = useState(null)
  const [rosterFailed, setRosterFailed] = useState(false)

  useEffect(() => {
    api('/warnings').then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]))
    api('/hr/employees')
      .then((d) => setRoster((d.employees || []).map((e) => ({
        username: e.username, name: e.name, role: e.title || '', type: e.department || 'Other', status: e.status,
      }))))
      .catch(() => { setRoster([]); setRosterFailed(true) })
  }, [])

  const warningsByAgent = useMemo(() => {
    const map = {}
    warnings.forEach((w) => { (map[w.agent] = map[w.agent] || []).push(w) })
    return map
  }, [warnings])

  const tabs = [
    { id: 'performance', label: 'Performance' },
    { id: 'kpi', label: 'KPI Settings' },
  ]

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-page">Performance</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Who is performing and who isn’t — click anyone to open their full performance page</p>
      </div>

      <div className="flex gap-1 rounded-full bg-[var(--color-fill)] p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${tab === t.id ? 'bg-white text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink-soft)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rosterFailed && <p className="text-[13px] text-[var(--color-bad)]">Could not load the team. The board is empty rather than out of date.</p>}

      {tab === 'performance'
        ? <PerformanceBoard team={roster || []} warningsByAgent={warningsByAgent} />
        : <HRTeam only={['kpi']} title="KPI Settings" subtitle="Rules and targets per role" />}
    </div>
  )
}
