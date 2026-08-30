import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Upload, Check, ArrowLeft, FileText, CheckCircle2 } from 'lucide-react'
import { api } from '../lib/api.js'

// Add employee — Adama's 30 Aug design: the record is BUILT IN STEPS, and a
// step you cannot finish today does not stop you hiring somebody.
//
// 🔒 IT IS A PAGE (/people/new), not a panel over one (his call, 30 Aug). Six
// steps of a record is a piece of work, not an interruption: as a page it gets
// the sidebar, the ground and the same max-w-[1440px] frame every other page
// sits in, for free — which is most of what was wrong when it was a modal.
//
// The old form was one cramped modal with a "Sales agent / Manager" toggle at
// the top, which meant two things at once: it decided the job title AND it
// decided Pulse access. 🔒 Those are separate here, and the wizard says so —
// a Sales Agent can be an Employee, a Manager or an Admin, but only if that
// access is granted deliberately.
//
// 🔒 NOTHING IS INVENTED AND NOTHING IS BLOCKING. Missing documents become
// onboarding items rather than a wall in front of creating the person, which is
// the whole reason the old form got half-filled and abandoned.

const STEPS = [
  ['personal', 'Personal'],
  ['employment', 'Employment'],
  ['contract', 'Contract & probation'],
  ['pay', 'Pay'],
  ['documents', 'Documents'],
  ['access', 'Access'],
]
const DEPARTMENTS = ['Sales', 'Customer Service', 'Operations', 'Marketing', 'Training', 'Management', 'Leadership']
const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Fixed term', 'Contractor', 'Intern']
const TITLES = ['Sales Agent', 'Senior Sales Agent', 'Sales Intern', 'Customer Service Supervisor', 'Assistant Manager', 'Team Lead', 'Lead Technician', 'Technician', 'Office Cleaner', 'Manager']
// 🔒 Required means "the file HR must end up holding", not "you cannot proceed".
const DOC_SLOTS = [
  { key: 'contract', label: 'Employment contract', required: true },
  { key: 'id', label: 'ID / Passport', required: true },
  { key: 'policies', label: 'Signed company policies', required: false },
]
const DAY_KEYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']]
const DEFAULT_WEEK = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false }

const EMAIL = /^\S+@\S+\.\S+$/
const today = () => new Date().toISOString().slice(0, 10)
const addMonths = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  if (isNaN(d) || !n) return ''
  d.setUTCMonth(d.getUTCMonth() + Number(n))
  return d.toISOString().slice(0, 10)
}
const pretty = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const readAsBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(new Error(`Could not read ${file.name}`))
  r.readAsDataURL(file)
})

// His design: small caps, letter-spaced, faint. In a dense two-column form the
// label has to separate itself from the value under it without competing with
// it. DESIGN.md now says so, and the check was narrowed to the table headings
// it was always named for rather than the page being bent around it.
const L = 'mb-2 block text-[10.5px] font-semibold uppercase tracking-[0.7px] text-[var(--color-ink-faint)]'
const HELP = 'mt-1.5 block text-[11.5px] text-[var(--color-ink-faint)]'

function Row({ children }) {
  return <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">{children}</div>
}
function Note({ tone = 'quiet', title, children }) {
  // 🔒 --color-fill (#f2f4f8) is the ONE neutral grey in the theme, and it was
  // doing every surface in here. Pulse's language for a quiet blue panel is
  // --color-brand-50; amber stays amber.
  const c = tone === 'warn'
    ? { background: 'var(--color-pill-leave-bg)', color: 'var(--color-pill-leave)' }
    : { background: 'var(--color-brand-50)', color: 'var(--color-brand)' }
  return (
    <div className="rounded-[10px] p-4" style={{ background: c.background }}>
      <p className="text-[12.5px] font-semibold" style={{ color: c.color }}>{title}</p>
      {children && <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-soft)]">{children}</p>}
    </div>
  )
}

// `initialStep` exists so every step can be rendered and checked. A step that
// only appears after two Continues is exactly the kind that ships blank and
// nobody notices for a week.
export default function AddEmployeeWizard({ onCreated, initialStep = 0 }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(initialStep)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [people, setPeople] = useState([])
  const [roles, setRoles] = useState(null) // null = not allowed to grant / not loaded
  const fileInput = useRef(null)

  const [v, setV] = useState({
    name: '', email: '', personalEmail: '', phone: '', address: '',
    title: 'Sales Agent', department: 'Sales', manager: '', employmentType: 'Full-time',
    joined: today(), week: { ...DEFAULT_WEEK }, start: '09:00', end: '17:00',
    contractMonths: '', onProbation: true, probationMonths: '3',
    baseSalary: '', transport: '', commission: '', target: '5',
    roleId: '',
  })
  // 🔴 THE MESSAGE DIES THE MOMENT YOU TOUCH THE FORM. The error was computed
  // only when Continue was pressed and nothing cleared it afterwards, so a
  // message stayed on screen after the field had been fixed — Adama typed a
  // perfectly good address and the page still said "That personal email is not
  // valid" (30 Aug). A validation message that outlives the problem is worse
  // than none: it sends you looking for a fault that is not there.
  const set = (k, val) => {
    setV((p) => ({ ...p, [k]: val }))
    setError('')
  }
  const on = (k) => (e) => set(k, e.target.value)

  const [docs, setDocs] = useState({})   // slot key → File
  const [extra, setExtra] = useState([]) // other files

  useEffect(() => {
    api('/hr/employees').then((d) => setPeople((d.employees || []).map((e) => e.name))).catch(() => setPeople([]))
    // Only the CEO may grant access, so only the CEO is offered the picker.
    api('/roles').then((d) => setRoles((d.roles || []).filter((r) => r.id !== 'owner'))).catch(() => setRoles(null))
  }, [])

  const probationEnd = v.onProbation ? addMonths(v.joined, v.probationMonths) : ''
  const contractEnd = Number(v.contractMonths) > 0 ? addMonths(v.joined, v.contractMonths) : ''
  const isContractor = v.employmentType === 'Contractor'
  const scheduleLabel = useMemo(() => {
    const days = DAY_KEYS.filter(([k]) => v.week[k]).map(([, l]) => l)
    if (!days.length) return 'No working days set'
    return `${days.length > 2 && days.join() === 'Mon,Tue,Wed,Thu,Fri' ? 'Mon–Fri' : days.join(', ')} · ${v.start}–${v.end}`
  }, [v.week, v.start, v.end])

  // 🔑 A step is only blocked by something that would make the RECORD wrong —
  // a missing name, an email that is not an email. Everything else can be
  // finished later, which is what the header promises.
  function problemWith(i) {
    if (i === 0) {
      if (!v.name.trim()) return 'Enter their full name'
      // 🔒 THE WORK EMAIL COMES LATER (Adama 30 Aug): it is created once the
      // letter is out, and the sign-in is sent then. It never blocks hiring
      // somebody, and 🔒 the PERSONAL email is never promoted into a sign-in —
      // it is contact on file.
      // 🔴 TEST WHAT WE WOULD SEND, NOT WHAT WAS TYPED. This trimmed to decide
      // WHETHER to check, then tested the raw value — so an address pasted with
      // a trailing space was rejected as invalid while looking perfectly right
      // on screen (Adama 30 Aug). Everything is trimmed once, here and on the
      // way to the server.
      if (v.email.trim() && !EMAIL.test(v.email.trim())) return 'That work email is not valid'
      if (v.personalEmail.trim() && !EMAIL.test(v.personalEmail.trim())) return 'That personal email is not valid'
    }
    if (i === 1) {
      if (!v.title.trim()) return 'Give the job title'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.joined)) return 'Pick the start date'
    }
    return ''
  }
  const next = () => {
    const p = problemWith(step)
    if (p) return setError(p)
    setError('')
    setStep((n) => Math.min(STEPS.length - 1, n + 1))
  }
  const back = () => { setError(''); setStep((n) => Math.max(0, n - 1)) }
  const goTo = (i) => {
    if (i <= step) { setError(''); return setStep(i) }
    for (let k = step; k < i; k++) { const p = problemWith(k); if (p) { setStep(k); return setError(p) } }
    setError('')
    setStep(i)
  }

  async function create() {
    for (let i = 0; i < STEPS.length; i++) { const p = problemWith(i); if (p) { setStep(i); return setError(p) } }
    setBusy(true)
    setError('')
    try {
      const week = {}
      for (const [k] of DAY_KEYS) week[k] = v.week[k] ? { start: v.start, end: v.end } : null
      const r = await api('/staff', { method: 'POST', body: {
        type: /manager|lead|supervisor/i.test(v.title) ? 'manager' : 'agent',
        name: v.name.trim(), email: v.email.trim(), personalEmail: v.personalEmail.trim(),
        title: v.title.trim(), department: v.department, manager: v.manager,
        employmentType: v.employmentType, joined: v.joined,
        schedule: isContractor ? null : week,
        contractMonths: v.contractMonths, probationMonths: v.onProbation ? v.probationMonths : 0,
        baseSalary: v.baseSalary, transport: v.transport, commission: v.commission, target: v.target,
        phone: v.phone.trim(), address: v.address.trim(),
        roleId: roles ? v.roleId : '',
      } })

      // The person exists now. Files attach to them; 🔒 a failed upload never
      // un-creates somebody — it is reported and the file stays outstanding.
      const queued = [
        ...Object.entries(docs).filter(([, f]) => f).map(([key, f]) => ({ f, category: key })),
        ...extra.map((f) => ({ f, category: 'general' })),
      ]
      const failed = []
      for (const { f, category } of queued) {
        try {
          await api('/agent-files', { method: 'POST', body: {
            agent: r.staff.name, name: f.name, mimeType: f.type, category,
            base64: await readAsBase64(f),
          } })
        } catch { failed.push(f.name) }
      }
      const missing = DOC_SLOTS.filter((d) => d.required && !docs[d.key]).map((d) => d.label)
      setDone({ ...r.staff, invited: r.invited, missing, failed })
      onCreated?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Shell title="Employee created" subtitle={`${done.name} is on the team.`}>
        <Body>
        <div className="mx-auto max-w-[560px] py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' }}>
            <CheckCircle2 size={28} />
          </span>
          <p className="mt-4 text-[15px] font-semibold text-[var(--color-ink)]">{done.name} is set up</p>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{done.email ? `They sign in with ${done.email}` : 'No work email yet — no sign-in.'}</p>
          <div className="mt-5 space-y-3 text-left">
            <Note title={!done.email ? 'No sign-in yet' : done.invited ? 'Invite sent' : 'Invite could not be sent'}>
              {!done.email
                ? 'Their record is on the roster, on payroll and on a schedule. Add the work email to their record when the letter goes out, then send the sign-in from there.'
                : done.invited
                  ? 'They have an email with a link to choose their password. It lasts 60 minutes — open their profile and press Reset password to send another.'
                  : 'The account exists. Open their profile and press Reset password to email them a link.'}
            </Note>
            {done.failed.length > 0 && (
              <Note tone="warn" title={`${done.failed.length} file could not be uploaded`}>
                {done.failed.join(', ')} — add {done.failed.length === 1 ? 'it' : 'them'} from their Documents tab.
              </Note>
            )}
            {done.missing.length > 0 && (
              <Note tone="warn" title="Still outstanding">
                {done.missing.join(' · ')} — waiting on their onboarding checklist.
              </Note>
            )}
          </div>
        </div>
        </Body>
        <Footer
          left={<Link to={`/people/${done.username}`} className="btn-secondary inline-flex items-center gap-2 hover:bg-[var(--color-soft)]">Open their record</Link>}
          right={<Link to="/people" className="btn-primary">Back to employees</Link>}
        />
      </Shell>
    )
  }

  const id = STEPS[step][0]
  return (
    <Shell
      title="Add employee"
      subtitle="Build the employee record in steps. You can finish missing items later."
      action={<Link to="/people" className="btn-secondary hover:bg-[var(--color-soft)]">Cancel</Link>}
    >
      <Steps>
      <div className="flex flex-wrap gap-2">
        {STEPS.map(([k, label], i) => (
          <button key={k} onClick={() => goTo(i)}
            className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
            style={i === step
              ? { background: 'var(--color-brand-50)', color: 'var(--color-brand)' }
              : { background: 'var(--color-fill)', color: i < step ? 'var(--color-ink-soft)' : 'var(--color-ink-faint)' }}>
            {i < step && <Check size={11} className="mr-1 inline align-middle" />}{label}
          </button>
        ))}
      </div>
      </Steps>
      <Body>

      {id === 'personal' && (
        <Section title="Personal" line="Who they are and how to reach them.">
          <Row>
            <label className="block">
              <span className={L}>Full name</span>
              <input value={v.name} onChange={on('name')} placeholder="e.g. Modou Njie" className="field w-full" />
            </label>
            <label className="block">
              <span className={L}>Phone</span>
              <input value={v.phone} onChange={on('phone')} placeholder="e.g. 3XX XX XX" className="field w-full" />
            </label>
            <label className="block">
              <span className={L}>Work email <span className="font-medium normal-case tracking-normal text-[var(--color-ink-faint)]">— optional</span></span>
              <input value={v.email} onChange={on('email')} placeholder="Created later" className="field w-full" />
              <span className={HELP}>Add it once their letter is out. Their sign-in is sent then, from their record.</span>
            </label>
            <label className="block">
              <span className={L}>Personal email</span>
              <input value={v.personalEmail} onChange={on('personalEmail')} placeholder="name@gmail.com" className="field w-full" />
              <span className={HELP}>On file for contact only. Never a sign-in.</span>
            </label>
          </Row>
          <label className="mt-4 block">
            <span className={L}>Address</span>
            <input value={v.address} onChange={on('address')} placeholder="e.g. Bakau, New Town Road" className="field w-full" />
          </label>
        </Section>
      )}

      {id === 'employment' && (
        <Section title="Employment" line="Define the job, department and employment arrangement.">
          <Row>
            <label className="block">
              <span className={L}>Job title</span>
              <input list="pulse-titles" value={v.title} onChange={on('title')} className="field w-full" />
              <datalist id="pulse-titles">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
              <span className={HELP}>Job title = what they do. Department = where they belong.</span>
            </label>
            <label className="block">
              <span className={L}>Department</span>
              <select value={v.department} onChange={on('department')} className="field w-full">
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={L}>Reports to</span>
              <select value={v.manager} onChange={on('manager')} className="field w-full">
                <option value="">Not set yet</option>
                {people.map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={L}>Employment type</span>
              <select value={v.employmentType} onChange={on('employmentType')} className="field w-full">
                {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={L}>Start date</span>
              <input type="date" value={v.joined} onChange={on('joined')} className="field w-full" />
            </label>
            <div className="block">
              <span className={L}>Work schedule</span>
              {isContractor ? (
                <p className="field w-full text-[var(--color-ink-faint)]">No schedule — contractors do not check in</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_KEYS.map(([k, label]) => (
                      <button key={k} type="button"
                        onClick={() => setV((p) => ({ ...p, week: { ...p.week, [k]: !p.week[k] } }))}
                        className="rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors"
                        style={v.week[k]
                          ? { background: 'var(--color-brand-50)', color: 'var(--color-brand)' }
                          : { background: 'var(--color-fill)', color: 'var(--color-ink-faint)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input type="time" value={v.start} onChange={on('start')} className="field" />
                    <span className="text-[12px] text-[var(--color-ink-faint)]">to</span>
                    <input type="time" value={v.end} onChange={on('end')} className="field" />
                  </div>
                  <span className={HELP}>{scheduleLabel}</span>
                </>
              )}
            </div>
          </Row>
          <div className="mt-6">
            <Note title="Job role and Pulse access are separate">
              A Sales Agent can be an Employee, Manager or Admin only if you explicitly grant that access. You do that on the last step.
            </Note>
          </div>
        </Section>
      )}

      {id === 'contract' && (
        <Section title="Contract &amp; probation" line="How long the arrangement runs, and when it gets reviewed.">
          <Row>
            <label className="block">
              <span className={L}>Contract length</span>
              <select value={v.contractMonths} onChange={on('contractMonths')} className="field w-full">
                <option value="">Indefinite</option>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
              </select>
              <span className={HELP}>{contractEnd ? `Ends ${pretty(contractEnd)}` : 'No end date.'}</span>
            </label>
            <div className="block">
              <span className={L}>Contract ends</span>
              <p className="field w-full text-[var(--color-ink-soft)]">{contractEnd ? pretty(contractEnd) : 'No end date'}</p>
            </div>
          </Row>

          <h3 className="mt-7 text-[15px] font-semibold text-[var(--color-ink)]">Probation</h3>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">Is this employee starting on probation?</p>
          <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
            <div className="flex items-end gap-2">
              {[[true, 'Yes'], [false, 'No']].map(([val, label]) => (
                <button key={label} type="button" onClick={() => set('onProbation', val)}
                  className="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors"
                  style={v.onProbation === val
                    ? { background: 'var(--color-brand)', color: '#ffffff' }
                    : { background: 'var(--color-fill)', color: 'var(--color-ink-soft)' }}>
                  {label}
                </button>
              ))}
            </div>
            <label className="block">
              <span className={L}>Length</span>
              <select value={v.probationMonths} onChange={on('probationMonths')} disabled={!v.onProbation} className="field w-full disabled:opacity-50">
                {[1, 3, 6].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <div className="block">
              <span className={L}>Review date</span>
              <p className="field w-full text-[var(--color-ink-soft)]">{probationEnd ? pretty(probationEnd) : '—'}</p>
            </div>
            <div className="block">
              <span className={L}>Status</span>
              <p className="field w-full text-[var(--color-ink-soft)]">{v.onProbation ? 'On probation' : 'Active'}</p>
            </div>
          </div>

          {v.onProbation && (
            <div className="mt-5">
              <Note tone="warn" title="The probation review lands in HR reminders on its own.">
                It appears as this person&rsquo;s next HR milestone from the day it is set. They can be created before anything is reviewed.
              </Note>
            </div>
          )}
        </Section>
      )}

      {id === 'pay' && (
        <Section title="Pay" line="What they are paid. Payroll stays the only place this can be changed later.">
          <Row>
            <label className="block">
              <span className={L}>Base salary (D)</span>
              <input type="number" min="0" value={v.baseSalary} onChange={on('baseSalary')} placeholder="e.g. 6000" className="field w-full" />
            </label>
            <label className="block">
              <span className={L}>Transport allowance (D)</span>
              <input type="number" min="0" value={v.transport} onChange={on('transport')} placeholder="0" className="field w-full" />
            </label>
            <label className="block">
              <span className={L}>Commission on target (D)</span>
              <input type="number" min="0" value={v.commission} onChange={on('commission')} placeholder="0" className="field w-full" />
              <span className={HELP}>Paid only when the monthly target is met.</span>
            </label>
            <label className="block">
              <span className={L}>Monthly target (sales)</span>
              <input type="number" min="0" value={v.target} onChange={on('target')} className="field w-full" />
            </label>
          </Row>
          <div className="mt-6">
            <Note title="Guaranteed monthly pay">
              D{((Number(v.baseSalary) || 0) + (Number(v.transport) || 0)).toLocaleString()} — base plus transport.
              Commission is on top and only when the target is met.
            </Note>
          </div>
        </Section>
      )}

      {id === 'documents' && (
        <Section title="Documents" line="Add employee documents now, or track them as outstanding onboarding items.">
          <button type="button" onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--color-line-control)] px-6 py-10 transition-colors hover:border-[var(--color-brand-soft)]"
            style={{ background: 'var(--color-paper)' }}>
            <Upload size={20} className="text-[var(--color-brand)]" />
            <span className="text-[13px] font-semibold text-[var(--color-ink)]">Drop files here or choose files</span>
            <span className="text-[11.5px] text-[var(--color-ink-faint)]">PDF, JPG or PNG · up to 10 MB</span>
          </button>
          <input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={(e) => { setExtra((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = '' }} />

          <h3 className="mt-7 text-[13px] font-semibold text-[var(--color-ink)]">Employment documents</h3>
          {/* One bordered list with hairline dividers — the same shape as an
              Employees row. Three separate boxes was a third pattern for the
              same job. */}
          <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--color-line)]">
            {DOC_SLOTS.map((d) => (
              <div key={d.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-soft)] px-4 py-3.5 transition-colors last:border-0 hover:bg-[var(--color-row-hover)]">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{d.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink-faint)]">{d.required ? 'Required' : 'Optional'}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-[12px] font-medium truncate max-w-[220px]"
                    style={{ color: docs[d.key] ? 'var(--color-pill-active)' : d.required ? 'var(--color-pill-leave)' : 'var(--color-ink-faint)' }}>
                    {docs[d.key] ? docs[d.key].name : 'Not uploaded'}
                  </span>
                  <label className="cursor-pointer text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">
                    {docs[d.key] ? 'Replace' : 'Upload'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setDocs((p) => ({ ...p, [d.key]: f })); e.target.value = '' }} />
                  </label>
                </span>
              </div>
            ))}
          </div>

          <h3 className="mt-7 text-[13px] font-semibold text-[var(--color-ink)]">Other documents</h3>
          <div className="mt-3 rounded-[10px] border border-[var(--color-line)] px-4 py-3.5">
            {extra.length === 0
              ? <p className="text-[12.5px] text-[var(--color-ink-soft)]">Certificates, licences, references or other employee files</p>
              : (
                <ul className="space-y-2">
                  {extra.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-[var(--color-ink-soft)]">
                        <FileText size={13} className="shrink-0 text-[var(--color-ink-faint)]" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <button onClick={() => setExtra((p) => p.filter((_, k) => k !== i))}
                        className="text-[12px] font-semibold text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)]">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <div className="mt-6">
            <Note title="Missing documents do not block employee creation.">
              Anything still required is added to their onboarding checklist.
            </Note>
          </div>
        </Section>
      )}

      {id === 'access' && (
        <Section title="Access" line="What they can see and do inside Pulse.">
          {!v.email.trim() && (
            <div className="mb-5">
              {/* A role can be set now; it simply cannot be used until there is
                  a work email to sign in with. Saying so beats a granted role
                  that appears to do nothing. */}
              <Note title="No sign-in until the work email exists">
                A role can be chosen now, but nobody can sign in without a work email. Add it on their record when the letter goes out and send the invite from there.
              </Note>
            </div>
          )}
          {roles ? (
            <>
              <label className="block max-w-[420px]">
                <span className={L}>Pulse access role</span>
                <select value={v.roleId} onChange={on('roleId')} className="field w-full">
                  <option value="">No access — record only</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <span className={HELP}>Permissions belong to the role. Change the role and everyone on it changes with it.</span>
              </label>
              <div className="mt-6">
                <Note title="No access is a real answer">
                  Someone can exist on the roster, be paid and be scheduled without ever signing in.
                </Note>
              </div>
            </>
          ) : (
            <Note title="Pulse access is granted separately">
              Only the CEO can grant an access role. This person is created as a record, and access is given from Settings → Team &amp; access.
            </Note>
          )}

          <div className="mt-7 rounded-[10px] border border-[var(--color-line)] p-5">
            <p className="text-[13px] font-semibold text-[var(--color-ink)]">Ready to create</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              {[['Name', v.name || '—'], ['Sign-in', v.email || 'None yet'],
                ['Role', `${v.title || '—'} · ${v.department}`], ['Type', v.employmentType],
                ['Starts', pretty(v.joined)], ['Reports to', v.manager || 'Not set yet'],
                ['Probation', v.onProbation ? `${v.probationMonths} months, review ${pretty(probationEnd)}` : 'None'],
                ['Contract', contractEnd ? `Ends ${pretty(contractEnd)}` : 'Indefinite'],
                ['Guaranteed pay', `D${((Number(v.baseSalary) || 0) + (Number(v.transport) || 0)).toLocaleString()} a month`],
                ['Documents', `${Object.values(docs).filter(Boolean).length + extra.length} attached`]].map(([k, val]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-[var(--color-line-soft)] py-1.5 last:border-0">
                    <dt className="text-[var(--color-ink-faint)]">{k}</dt>
                    <dd className="text-right font-medium text-[var(--color-ink)]">{val}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </Section>
      )}

      {error && <p className="mt-5 text-[12.5px] font-medium text-[var(--color-stage-out)]">{error}</p>}
      </Body>

      <Footer
        left={step > 0 && (
          <button onClick={back} className="btn-secondary inline-flex items-center gap-2 hover:bg-[var(--color-soft)]">
            <ArrowLeft size={15} /> Back
          </button>
        )}
        middle={`Step ${step + 1} of ${STEPS.length}`}
        right={step === STEPS.length - 1
          ? <button onClick={create} disabled={busy} className="btn-primary disabled:opacity-60">{busy ? 'Creating…' : 'Create employee'}</button>
          : <button onClick={next} className="btn-primary">Continue</button>}
      />
    </Shell>
  )
}

function Section({ title, line, children }) {
  return (
    <div>
      <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{title}</h2>
      <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">{line}</p>
      <div className="mt-6">{children}</div>
    </div>
  )
}

// The page frame. 🔒 A page header the way every other Pulse page has one
// (t-page title + one support line), then ONE card holding the steps: a header
// band with the step chips, the body, and the footer bar. AppLayout already
// supplies the sidebar, the --color-paper ground and the max-w-[1440px] / px-8
// frame, so none of that is re-invented here.
function Shell({ title, subtitle, action, children }) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page text-[var(--color-ink)]">{title}</h1>
          <p className="t-support mt-2">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="card overflow-hidden">{children}</div>
    </div>
  )
}

// The step chips live in the card's header band.
function Steps({ children }) {
  return (
    <div className="border-b border-[var(--color-line-soft)] px-5 py-4 md:px-7" style={{ background: 'var(--color-paper)' }}>
      {children}
    </div>
  )
}
function Body({ children }) {
  return <div className="px-5 py-7 md:px-7">{children}</div>
}
function Footer({ left, middle, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] px-5 py-4 md:px-7"
      style={{ background: 'var(--color-paper)' }}>
      <span className="min-w-[90px]">{left}</span>
      {middle && <span className="text-[12px] text-[var(--color-ink-faint)]">{middle}</span>}
      <span className="min-w-[90px] text-right">{right}</span>
    </div>
  )
}
