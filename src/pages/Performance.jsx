import { useState, useEffect, useMemo } from 'react'
import { team } from '../data/team'
import { api } from '../lib/api.js'
import PerformanceBoard from './departments/PerformanceBoard.jsx'
import HRTeam from './departments/HRTeam.jsx'

// Performance section. Two views:
//  • "Performance" — the manager's operating-system board (PerformanceBoard).
//  • "KPI Settings" — reuses the existing HRTeam KPI-rules editor unchanged.
export default function Performance() {
  const [tab, setTab] = useState('performance')
  const [warnings, setWarnings] = useState([])

  useEffect(() => {
    api('/warnings').then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]))
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
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">Performance</h1>
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

      {tab === 'performance'
        ? <PerformanceBoard team={team} warningsByAgent={warningsByAgent} />
        : <HRTeam only={['kpi']} title="KPI Settings" subtitle="Rules and targets per role" />}
    </div>
  )
}
