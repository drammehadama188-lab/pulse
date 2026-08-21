import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pageEnding } from '../../design.js'

// HOW A LIST ENDS — the one pagination for Pulse (DESIGN.md, "List pages").
// Default 25, switchable to 10 / 25 / 50, the same shape on every page. Three
// pages used to hand-roll this three different ways.
export function usePager(items, initial = pageEnding.rows) {
  const [size, setSize] = useState(initial)
  const [page, setPage] = useState(1)
  const total = items?.length || 0
  const pageCount = Math.max(1, Math.ceil(total / size))
  const safe = Math.min(page, pageCount)
  // A filter that shrinks the list must not leave an empty page showing.
  useEffect(() => { if (page > pageCount) setPage(1) }, [page, pageCount])
  const slice = useMemo(
    () => (items || []).slice((safe - 1) * size, safe * size),
    [items, safe, size],
  )
  return {
    slice,
    props: {
      total, size, page: safe, pageCount,
      onSize: (n) => { setSize(n); setPage(1) },
      onPage: setPage,
    },
    reset: () => setPage(1),
  }
}

// First, last, and a window around the current page — a 500-row list must not
// print fifty buttons.
function numbers(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const out = new Set([1, pageCount, page, page - 1, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => out.add(n))
  if (page >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((n) => out.add(n))
  const nums = [...out].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b)
  const withGaps = []
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) withGaps.push('…')
    withGaps.push(n)
  })
  return withGaps
}

export default function Pager({ total, size, page, pageCount, onSize, onPage, noun = 'rows', compact = false }) {
  if (!total) return null
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  return (
    <div className={`flex flex-wrap items-center gap-3 border-t border-[var(--color-line-soft)] ${compact ? 'px-4 py-2.5' : 'px-5 py-3.5'}`}>
      <span className="text-[12.5px] text-[var(--color-ink-soft)] tabular-nums">
        {from}–{to} of {total} {noun}
      </span>

      {!compact && (
        <select
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
          className="rounded-[8px] border border-[var(--color-line-control)] bg-[var(--color-surface)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink-soft)]"
        >
          {pageEnding.options.map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      )}

      {pageCount > 1 && (
        <span className="ml-auto flex items-center gap-1.5">
          <Btn label="Previous" disabled={page === 1} onClick={() => onPage(Math.max(1, page - 1))}>
            <ChevronLeft size={15} />
          </Btn>
          {numbers(page, pageCount).map((n, i) => (
            n === '…'
              ? <span key={`gap${i}`} className="px-1 text-[12.5px] text-[var(--color-ink-muted)]">…</span>
              : <Btn key={n} label={`Page ${n}`} active={n === page} onClick={() => onPage(n)}>{n}</Btn>
          ))}
          <Btn label="Next" disabled={page === pageCount} onClick={() => onPage(Math.min(pageCount, page + 1))}>
            <ChevronRight size={15} />
          </Btn>
        </span>
      )}
    </div>
  )
}

function Btn({ children, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-w-[34px] items-center justify-center rounded-[8px] border px-2 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'
      }`}
    >
      {children}
    </button>
  )
}
