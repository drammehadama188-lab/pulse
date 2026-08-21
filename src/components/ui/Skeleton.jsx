// LOADING — a skeleton shaped like the content that is coming, not the word
// "Loading…" (DESIGN.md). The page keeps its shape while it waits, so nothing
// jumps when the data lands. Full-page spinners are only for the app booting.

function Bar({ w = '100%', h = 12 }) {
  return (
    <span
      className="block animate-pulse rounded-[6px] bg-[var(--color-fill)]"
      style={{ width: w, height: h }}
    />
  )
}

// A page's first paint: title, a row of tiles, then the body it is waiting for.
export function PageSkeleton({ tiles = 4, rows = 6, table = true }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Bar w="220px" h={26} />
        <Bar w="320px" h={13} />
      </div>
      {tiles > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(tiles, 4)}, minmax(0, 1fr))` }}>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="card flex flex-col gap-3 p-5">
              <Bar w="45%" h={11} />
              <Bar w="60%" h={24} />
            </div>
          ))}
        </div>
      )}
      {table && <TableSkeleton rows={rows} />}
    </div>
  )
}

// The shape of a list while it loads: a header strip and its rows.
export function TableSkeleton({ rows = 6, cols = 4 }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] px-5 py-3">
        {Array.from({ length: cols }, (_, i) => <Bar key={i} w={i === 0 ? '30%' : '18%'} h={11} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-[var(--color-line-soft)] px-5 py-4 last:border-b-0">
          {Array.from({ length: cols }, (_, i) => <Bar key={i} w={i === 0 ? '30%' : '18%'} h={13} />)}
        </div>
      ))}
    </div>
  )
}

// A few lines inside a card that is already on screen.
export function LinesSkeleton({ lines = 3 }) {
  return (
    <div className="flex flex-col gap-2.5 p-5">
      {Array.from({ length: lines }, (_, i) => (
        <Bar key={i} w={i === lines - 1 ? '55%' : '100%'} h={13} />
      ))}
    </div>
  )
}

export default PageSkeleton
