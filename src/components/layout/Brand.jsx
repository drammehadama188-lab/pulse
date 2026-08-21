export function Brand({ compact = false, onDark = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: onDark ? 'var(--color-damia)' : 'var(--color-mint-tile)' }}
      >
        {/* Pulse flame */}
        <svg width="17" height="23" viewBox="0 0 120 160" className={onDark ? 'text-white' : 'text-[var(--color-damia)]'} aria-hidden>
          <path
            d="M78 10 C 46 44 44 72 60 96 C 70 111 66 122 50 130 C 60 112 46 102 52 80 C 58 54 70 30 78 10 Z"
            fill="currentColor"
          />
          <path
            d="M56 92 C 32 118 32 140 48 154 C 41 140 52 130 60 122 C 71 112 68 96 56 92 Z"
            fill="currentColor"
          />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className={`text-[16px] font-semibold tracking-tight ${onDark ? 'text-white' : 'text-[var(--color-ink)]'}`}>
            Pulse
          </div>
          <div className={`-mt-0.5 text-[9px] font-semibold ${onDark ? 'text-white/60' : 'text-[var(--color-ink-faint)]'}`}>
            by Damia Tracker
          </div>
        </div>
      )}
    </div>
  )
}
