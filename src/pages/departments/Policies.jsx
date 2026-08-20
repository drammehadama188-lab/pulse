import { BookOpen, Download, ExternalLink } from 'lucide-react'
import { Card } from '../../components/ui.jsx'

// Company policies. First document online: THE BLUE BOOK — the Damia Security
// Solutions employee handbook, approved by the CEO. The PDF is served as a
// static asset (public/docs/blue-book.pdf) and shown inline with a download.
// Links are plain anchors (the shared Button renders a <button>, which can't
// carry href/download), styled to match the Button look.
const BLUE_BOOK_URL = '/docs/blue-book.pdf'

const linkBtn =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all focus-ring active:scale-[0.98]'
const linkPrimary = `${linkBtn} bg-[var(--color-brand)] text-white shadow-[0_6px_16px_rgba(214,41,79,0.25)] hover:bg-[var(--color-brand-600)]`
const linkOutline = `${linkBtn} border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]`

export default function Policies() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[27px]">Policies</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Company</p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-[var(--color-line-soft)] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--color-mint-tile)] text-[var(--color-brand)]">
              <BookOpen size={24} strokeWidth={2} />
            </div>
            <div>
              <div className="text-lg font-bold text-[var(--color-ink)]">The Blue Book</div>
              <p className="mt-0.5 max-w-xl text-sm text-[var(--color-ink-soft)]">
                Damia Security Solutions employee handbook — working hours, leave,
                conduct and benefits. The authoritative company policy.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <a className={linkOutline} href={BLUE_BOOK_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={18} strokeWidth={2.2} />
              Open
            </a>
            <a className={linkPrimary} href={BLUE_BOOK_URL} download="The Blue Book.pdf">
              <Download size={18} strokeWidth={2.2} />
              Download
            </a>
          </div>
        </div>

        <object data={BLUE_BOOK_URL} type="application/pdf" className="h-[70vh] w-full bg-[var(--color-line-soft)]">
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-[var(--color-ink-soft)]">Your browser can’t preview the PDF here.</p>
            <a className={linkPrimary} href={BLUE_BOOK_URL} download="The Blue Book.pdf">
              <Download size={18} strokeWidth={2.2} />
              Download The Blue Book
            </a>
          </div>
        </object>
      </Card>
    </div>
  )
}
