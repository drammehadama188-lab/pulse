export function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
        style={{
          background: 'linear-gradient(135deg, #2a5fe0, #1e4fcc 60%, #173a96)',
          boxShadow: '0 6px 16px rgba(30,79,204,0.28)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M2 12.5h4.2l2-5.5 3.4 11 2.4-7 1.6 3.5H22"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[16px] font-extrabold tracking-tight text-[var(--color-ink)]">
            Pulse
          </div>
          <div className="-mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
            by Damia
          </div>
        </div>
      )}
    </div>
  )
}
