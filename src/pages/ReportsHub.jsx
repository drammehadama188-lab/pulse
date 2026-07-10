import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import WeeklyReport from './WeeklyReport.jsx'
import BusinessReport from './BusinessReport.jsx'
import Reports from './Reports.jsx'

// REPORTS — one place, separated into areas inside (Adama 10 Jul): the shared
// Weekly report, the CEO's monthly Business report, and the Month story.
export default function ReportsHub() {
  const { user, hasPower } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isOwner = user?.username === 'adama'
  const canWeekly = user?.isTeamLead || hasPower('hr')

  const tabs = [
    ...(canWeekly ? [['weekly', 'Weekly']] : []),
    ...(isOwner ? [['business', 'Business']] : []),
    ['month', 'Month'],
  ]
  const urlTab = new URLSearchParams(location.search).get('tab')
  const [tab, setTab] = useState(tabs.some(([k]) => k === urlTab) ? urlTab : tabs[0][0])
  const pick = (k) => { setTab(k); navigate(`/reports?tab=${k}`, { replace: true }) }

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-1">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => pick(k)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === k ? 'bg-[var(--color-ink)] text-white' : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>{label}</button>
        ))}
      </div>
      {tab === 'weekly' && canWeekly && <WeeklyReport />}
      {tab === 'business' && isOwner && <BusinessReport />}
      {tab === 'month' && <Reports />}
    </div>
  )
}
