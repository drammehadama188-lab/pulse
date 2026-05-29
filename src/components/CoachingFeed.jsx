import { useEffect, useState } from 'react'
import { Calendar, Flag, GraduationCap } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Pill, SectionTitle } from './ui.jsx'

const META = {
  meeting: { icon: Calendar, tone: 'brand', label: 'Meeting' },
  flag: { icon: Flag, tone: 'bad', label: 'Flag' },
  coaching: { icon: GraduationCap, tone: 'rest', label: 'Coaching' },
}

function whenLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function CoachingFeed({ title = 'Coaching & meetings' }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    api('/coaching').then(({ coaching }) => setItems(coaching)).catch(() => setItems([]))
  }, [])

  if (!items || items.length === 0) return null

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-3">
        {items.map((c) => {
          const m = META[c.type] || META.coaching
          const upcoming = c.type === 'meeting' && c.datetime && new Date(c.datetime) > new Date()
          return (
            <Card key={c.id} className="flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color: `var(--color-${m.tone})`, background: `var(--color-${m.tone}-bg)` }}>
                <m.icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-[var(--color-ink)]">{c.title || m.label}</span>
                  <Pill tone={m.tone}>{m.label}</Pill>
                  {upcoming && <Pill tone="good" dot>Upcoming</Pill>}
                </div>
                {c.note && <div className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{c.note}</div>}
                <div className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  {c.datetime ? whenLabel(c.datetime) + ' · ' : ''}from {c.createdBy}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
