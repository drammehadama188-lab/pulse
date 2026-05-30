import { Card } from '../../components/ui.jsx'

// Clean placeholder for a department that's wired into Pulse but not built out yet.
// Each department gets fleshed out one at a time; this keeps the nav honest in the meantime.
export default function DepartmentShell({ icon: Icon, title, blurb }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Department</p>
      </div>

      <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-mint-tile)] text-[var(--color-brand)]">
          {Icon && <Icon size={30} strokeWidth={2} />}
        </div>
        <div>
          <div className="text-lg font-bold text-[var(--color-ink)]">Being set up</div>
          <p className="mx-auto mt-1.5 max-w-sm text-[var(--color-ink-soft)]">
            {blurb || `The ${title} department is being built fresh in Pulse. It’ll come online here soon.`}
          </p>
        </div>
      </Card>
    </div>
  )
}
