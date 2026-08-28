import { UserX, FileText } from 'lucide-react'

// The file of somebody who has left (Adama 28 Aug: "after it ended maybe just
// one page summarised everything including their attendance and all, and the
// page says dismissed, that is his file").
//
// 🔒 ONE PAGE, NOT A HUNT THROUGH TABS. While a person is here the record is a
// working surface: this month's attendance, this month's targets, editable
// cards. Once they have gone none of that is live, and the questions change to
// how long were they here, did they finish the term, why did it end, what were
// they like, and is anything outstanding. This answers those in that order.
//
// 🔒 Attendance is summed across the WHOLE employment. The month view is empty
// for a leaver and reads as though they never came to work.
const CARD = 'card'
const day = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })
const hours = (mins) => `${Math.floor((mins || 0) / 60)}h ${String((mins || 0) % 60).padStart(2, '0')}m`

const Fact = ({ label, value, tone }) => (
  <div>
    <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
    <p className="mt-1 text-[13px] font-medium" style={{ color: tone || 'var(--color-ink)' }}>{value}</p>
  </div>
)

export default function LeaverFile({ file, e, notes = [], documents = [], onTab }) {
  if (!file) return null
  const x = file.exit
  const att = file.attendance || {}
  const outstanding = (file.checklist || []).filter((i) => !i.done && !i.na)
  // A dismissal is the reason somebody opens this page. It leads.
  const why = x ? `${x.type} · ${x.reason}` : (e.leftReason || 'Left the team')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="t-card">{e.name}'s file</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          Everything about their time here, on one page. Nothing is editable: they have left.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-[var(--color-stage-out)] bg-[var(--color-bad-bg)] px-4 py-3">
        <UserX size={15} className="mt-0.5 shrink-0 text-[var(--color-stage-out)]" />
        <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
          <b className="font-medium">{x ? x.type : 'Left the team'} — last day {day(file.last)}</b>
          <span className="mt-0.5 block text-[12.5px] text-[var(--color-ink-soft)]">{why}</span>
        </span>
      </div>

      {/* How long they were here, and whether they finished what they signed. */}
      <div className={`${CARD} grid grid-cols-2 gap-y-4 p-5 sm:grid-cols-4`}>
        <Fact label="Started" value={day(file.first)} />
        <Fact label="Left" value={day(file.last)} />
        <Fact label="Time served" value={file.monthsServed ? `${file.monthsServed} month${file.monthsServed === 1 ? '' : 's'}` : `${file.daysServed || 0} days`} />
        <Fact
          label="Contract"
          value={file.contractEnd
            ? (file.finishedTerm ? `Ran to ${day(file.contractEnd)}` : `Ended before ${day(file.contractEnd)}`)
            : 'No end date'}
          tone={file.contractEnd && !file.finishedTerm ? 'var(--color-stage-out)' : undefined}
        />
      </div>

      {/* Attendance for the whole employment, not the month they left in. */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="t-card">Attendance, whole employment</h2>
          <button onClick={() => onTab?.('Attendance')} className="text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">
            Day by day
          </button>
        </div>
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-5">
          <Fact label="Attendance rate" value={att.ratePct == null ? '—' : `${att.ratePct}%`}
            tone={att.ratePct != null && att.ratePct < 80 ? 'var(--color-stage-out)' : undefined} />
          <Fact label="Days present" value={`${att.present || 0} of ${att.scheduledDays || 0}`} />
          <Fact label="Late arrivals" value={att.late || 0}
            tone={att.late ? 'var(--color-pill-leave)' : undefined} />
          <Fact label="Absences" value={att.absent || 0}
            tone={att.absent ? 'var(--color-stage-out)' : undefined} />
          <Fact label="Hours worked" value={hours(att.workedMinutes)} />
        </div>
      </div>

      {/* The settlement, where the viewer may see pay. */}
      {x?.payAmount != null && (
        <div className={`${CARD} p-5`}>
          <h2 className="t-card">Final pay</h2>
          <p className="mt-2 text-[19px] font-semibold text-[var(--color-ink)]">D{money(x.payAmount)}</p>
          {(x.payBasis?.lines || []).map((l) => (
            <p key={l.label} className="text-[12px] text-[var(--color-ink-faint)]">
              {l.label}{l.monthly ? `: D${l.monthly.toLocaleString()} ÷ ${x.payBasis.monthDays} × ${x.payBasis.workedDays}` : ''} = D{money(l.amount)}
            </p>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-y-4 border-t border-[var(--color-line)] pt-3 sm:grid-cols-3">
            <Fact label="Notice" value={x.notice} />
            <Fact label="Rehire" value={x.rehire ? 'Would rehire' : 'Would not rehire'}
              tone={x.rehire ? undefined : 'var(--color-stage-out)'} />
            <Fact label="Recorded by" value={x.by || '—'} />
          </div>
          {x.note && <p className="mt-3 text-[13px] text-[var(--color-ink-soft)]">{x.note}</p>}
        </div>
      )}

      {/* 🔑 Everything ever written about them, on the page that says why they
          left. It was all on another tab, so the reason for a dismissal and the
          warnings that led to it never appeared together. */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="t-card">Warnings, coaching and notes</h2>
          <span className="text-[12.5px] text-[var(--color-ink-soft)]">{notes.length || 'none'}</span>
        </div>
        {notes.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            Nothing was written about them while they were here. For a dismissal that is worth knowing: the file holds the exit reason and nothing before it.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-line-soft)]">
            {notes.map((n, i) => (
              <div key={i} className="py-3">
                <p className="text-[13px] text-[var(--color-ink)]">
                  <span className="font-medium">{n.kind}</span>{n.title ? ` · ${n.title}` : ''}
                </p>
                {n.text && <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{n.text}</p>}
                <p className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">{n.by ? `${n.by} · ` : ''}{n.at ? day(n.at) : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${CARD} p-5`}>
          <h2 className="t-card">Documents</h2>
          {documents.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--color-ink-soft)]">Nothing on file.</p>
          ) : (
            <div className="mt-2 divide-y divide-[var(--color-line-soft)]">
              {documents.map((f) => (
                <p key={f.id} className="flex items-center gap-2 py-2 text-[13px] text-[var(--color-ink)]">
                  <FileText size={14} className="shrink-0 text-[var(--color-ink-faint)]" /> {f.name}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className={`${CARD} p-5`}>
          <h2 className="t-card">Offboarding</h2>
          {outstanding.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--color-ink-soft)]">Nothing outstanding.</p>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-[var(--color-stage-out)]">{outstanding.length} still to do</p>
              <div className="mt-1 divide-y divide-[var(--color-line-soft)]">
                {outstanding.map((i) => (
                  <p key={i.label} className="py-2 text-[13px] text-[var(--color-ink)]">{i.label}</p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
