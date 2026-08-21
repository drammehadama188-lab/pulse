// Warm UI kit — soft, rounded, friendly building blocks.
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

const AVATAR_TONES = [
  ['#e6f6f0', '#1aa179'],
  ['#d6f0e9', '#26a69a'],
  ['#fbf0dd', '#d98a23'],
  ['#efecfb', '#6f5bd6'],
  ['#fbe9e6', '#d65745'],
  ['#fdebef', '#d6294f'],
]
function toneFor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_TONES.length
  return AVATAR_TONES[h]
}
function initials(name = '') {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

export function Avatar({ name, size = 40, src }) {
  const [bg, fg] = toneFor(name)
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  )
}

const TONES = {
  good: 'text-[var(--color-good)] bg-[var(--color-good-bg)]',
  warn: 'text-[var(--color-warn)] bg-[var(--color-warn-bg)]',
  rest: 'text-[var(--color-rest)] bg-[var(--color-rest-bg)]',
  bad: 'text-[var(--color-bad)] bg-[var(--color-bad-bg)]',
  brand: 'text-[var(--color-brand)] bg-[var(--color-brand-50)]',
  neutral: 'text-[var(--color-ink-soft)] bg-[var(--color-fill)]',
}

export function Pill({ tone = 'neutral', children, dot = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${TONES[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Card({ className = '', children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export function StatCard({ icon: Icon, label, value, sub, tone = 'brand' }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">{label}</span>
        {Icon && (
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONES[tone]}`}>
            <Icon size={18} strokeWidth={2.2} />
          </span>
        )}
      </div>
      <div className="text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">{value}</div>
      {sub && <div className="text-[13px] text-[var(--color-ink-faint)]">{sub}</div>}
    </Card>
  )
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  ...rest
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-[8px] font-medium transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'h-9 px-3.5 text-[13px]', md: 'h-[42px] px-[18px] text-[13px]', lg: 'h-[46px] px-6 text-[13px]' }
  const variants = {
    primary:
      'bg-[var(--color-brand)] text-white shadow-[0_2px_5px_rgba(37,99,235,0.12)] hover:bg-[var(--color-brand-600)]',
    ghost:
      'bg-[var(--color-line-soft)] text-[var(--color-ink)] hover:bg-[var(--color-line)]',
    outline:
      'border border-[var(--color-line-control)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-soft)]',
    good: 'bg-[var(--color-good)] text-white hover:brightness-95',
    danger: 'bg-[var(--color-bad-bg)] text-[var(--color-bad)] hover:brightness-97',
  }
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {Icon && <Icon size={18} strokeWidth={2.2} />}
      {children}
    </button>
  )
}

export function Spinner({ size = 22 }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-[var(--color-brand-100)] border-t-[var(--color-brand)]"
      style={{ width: size, height: size }}
    />
  )
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold text-[var(--color-ink)]">{children}</h2>
      {action}
    </div>
  )
}

// 🔒 Inputs: 42px, 8px radius, 13/400, a control-weight border, and a focus
// glow you can barely see. A resting field is never blue.
const FIELD_CLS =
  'focus-ring w-full rounded-[8px] border border-[var(--color-line-control)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[13px] text-[var(--color-ink)] outline-none transition-colors placeholder:text-[#a1aaba]'

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-[var(--color-ink)]">{label}</span>
      {children}
    </label>
  )
}
export function Input(props) {
  return <input {...props} className={`${FIELD_CLS} ${props.className || ''}`} />
}
export function Textarea(props) {
  return <textarea {...props} className={`${FIELD_CLS} resize-none ${props.className || ''}`} />
}
export function Select({ options = [], children, ...props }) {
  return (
    <select {...props} className={`${FIELD_CLS} ${props.className || ''}`}>
      {children}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

// Dropdown that draws its own menu instead of the browser's default popup
// (Adama 3 Aug: "fix the google dropdown") — same look as PeriodPicker.
// Options: strings, or { value, label } objects. onChange gets the VALUE.
export function MenuSelect({ value, onChange, options = [], placeholder = 'Choose…' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }))
  const current = opts.find((o) => String(o.value) === String(value))
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${FIELD_CLS} flex items-center justify-between gap-2 text-left`}>
        <span className={current ? '' : 'text-[var(--color-ink-faint)]'}>{current ? current.label : placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 text-[var(--color-ink-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white p-1.5 shadow-xl">
          {opts.map((o) => {
            const active = String(o.value) === String(value)
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${active ? 'bg-blue-50 font-semibold text-blue-600' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'}`}
              >
                {o.label}
                {active && <Check size={15} className="shrink-0 text-blue-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-lg' }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(20,24,40,0.45)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`card w-full ${maxWidth} max-h-[92vh] overflow-y-auto rounded-b-none rounded-t-3xl sm:rounded-lg rise`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
          <h3 className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--color-line-soft)] px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onCancel, onConfirm, title, message, confirmLabel = 'Delete', busy }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size={16} /> : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[var(--color-ink-soft)]">{message}</p>
    </Modal>
  )
}
