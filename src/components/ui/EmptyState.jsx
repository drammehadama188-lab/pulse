// An empty list still has to say something useful (DESIGN.md, "Empty states").
// Never "No data." — a title, one line of explanation, and the action that
// would fill it where one exists.
export default function EmptyState({ icon: Icon, title, line, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-fill)] text-[var(--color-ink-faint)]">
          <Icon size={20} />
        </span>
      )}
      <span className="text-[15px] font-semibold text-[var(--color-ink)]">{title}</span>
      {line && <span className="max-w-[420px] text-[13px] leading-relaxed text-[var(--color-ink-soft)]">{line}</span>}
      {action && <span className="mt-2">{action}</span>}
    </div>
  )
}
