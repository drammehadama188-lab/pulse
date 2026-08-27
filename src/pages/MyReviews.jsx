import { useEffect, useState } from 'react'
import { FileText, Download, GraduationCap, Calendar, Flag, FolderOpen } from 'lucide-react'
import { api, getToken } from '../lib/api.js'
import { timeShort } from '../lib/format.js'
import { Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'

// Staff self-view — the signed-in person's OWN reviews, coaching and documents.
// Read-only: HR authors everything from the staff profile; this is the employee's
// window into their own record. Data is self-scoped on the server (/api/my/file),
// so no one can ever see another person's file here.

const DOC_LABEL = { cv: 'CV', contract: 'Contract', id: 'ID', warning: 'Warning', general: 'Document' }
const COACH_META = {
  meeting: { icon: Calendar, tone: 'brand', label: 'Meeting' },
  flag: { icon: Flag, tone: 'bad', label: 'Flag' },
  coaching: { icon: GraduationCap, tone: 'rest', label: 'Coaching' },
}

// Dates and times pin to Gambia (UTC), same as the shared format.js clock.
function dateLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
function whenLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) +
    ' · ' + timeShort(iso)
}
function DownloadLink({ id }) {
  return (
    <a href={`/api/agent-files/${id}/download?t=${getToken()}`} target="_blank" rel="noopener noreferrer"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]"
      title="Download">
      <Download size={18} />
    </a>
  )
}
function EmptyState({ children }) {
  return <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">{children}</Card>
}

export default function MyReviews() {
  const [data, setData] = useState(null)

  useEffect(() => {
    api('/my/file')
      .then(setData)
      .catch(() => setData({ reviews: [], documents: [], coaching: [] }))
  }, [])

  if (!data) {
    return (
      <PageSkeleton tiles={0} rows={6} />
    )
  }

  const { reviews = [], documents = [], coaching = [] } = data

  return (
    <div className="space-y-8">
      <div>
        <h1 className="t-page">Reviews</h1>
        <p className="mt-1 text-[var(--color-ink-faint)]">Your performance reviews and coaching notes.</p>
      </div>

      {/* Reviews */}
      <div>
        <SectionTitle>Performance reviews</SectionTitle>
        {reviews.length === 0 ? (
          <EmptyState>No reviews shared with you yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-brand)]" style={{ background: 'var(--color-brand-50)' }}>
                  <FileText size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-ink)]">{r.period ? `Review — ${r.period}` : r.name}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-faint)]">
                    {dateLabel(r.uploadedAt)}{r.uploadedBy ? ` · from ${r.uploadedBy}` : ''}
                  </div>
                </div>
                <DownloadLink id={r.id} />
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Coaching */}
      <div>
        <SectionTitle>Coaching &amp; meetings</SectionTitle>
        {coaching.length === 0 ? (
          <EmptyState>No coaching notes yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {coaching.map((c) => {
              const m = COACH_META[c.type] || COACH_META.coaching
              const upcoming = c.type === 'meeting' && c.datetime && new Date(c.datetime) > new Date()
              return (
                <Card key={c.id} className="flex items-start gap-3 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color: `var(--color-${m.tone})`, background: `var(--color-${m.tone}-bg)` }}>
                    <m.icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{c.title || m.label}</span>
                      <Pill tone={m.tone}>{m.label}</Pill>
                      {upcoming && <Pill tone="good" dot>Upcoming</Pill>}
                    </div>
                    {c.note && <div className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{c.note}</div>}
                    <div className="mt-1 text-[11.5px] text-[var(--color-ink-faint)]">
                      {c.datetime ? whenLabel(c.datetime) + ' · ' : ''}{c.createdBy ? `from ${c.createdBy}` : ''}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
