import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Upload, Check, ArrowLeft, FileText, CheckCircle2, Mail } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageSkeleton } from './ui/Skeleton.jsx'
// 🔒 The house dropdown. A native <select> hands the OS its own menu — a
// different font, a different blue, a check in the wrong place — so one control
// on the page never belongs to the product (Adama 30 Aug).
import { MenuSelect } from './ui.jsx'

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

// 🔒 THE ARRANGEMENT IS ONE CONVERSATION (Adama 30 Aug): "i select the type,
// let's say full time, then i go to probation and employment — that makes no
// sense." Employment type, contract length and probation are the SAME decision:
// the type is what says whether there is an end date at all, and the start date
// is what both the contract end and the probation review are counted from.
// Splitting them put the cause on one page and its effect on another.
const STEPS = [
  ['personal', 'Personal'],
  ['employment', 'Employment'],
  ['pay', 'Pay'],
  // 🔒 AFTER PAY, BEFORE DOCUMENTS (Adama 30 Aug). The contract states the pay,
  // so it cannot be written until pay is decided; and it becomes one of their
  // documents, so it comes before the step that collects them.
  ['contract', 'Contract'],
  ['documents', 'Documents'],
]
// 🔒 ACCESS IS NOT PART OF BUILDING THE RECORD (Adama 30 Aug): "i can save
// after completing without giving her access yet or activating her. that button
// to activate her access is the end — after she has signed and returned and i
// feel we have everything."
// So the wizard finishes at Documents. Granting a role and activating somebody
// are one deliberate act, taken later from their record, when the signed
// contract is back.
// 🔒 The TYPE decides whether there is an end date. Asking "Full-time" and then
// "contract length: 3/6/12/24 months" on the next page is the contradiction he
// caught — full-time permanent and fixed term are the same axis, asked twice.
const FIXED_TERM_TYPES = ['Fixed term', 'Intern', 'Contractor']
// Probation belongs to employment. A contractor is not on probation; they are
// on a contract, and it either runs or it does not.
const PROBATION_TYPES = ['Full-time', 'Part-time', 'Fixed term', 'Intern']
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
      {children ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-soft)]">{children}</p> : null}
    </div>
  )
}

// `initialStep` exists so every step can be rendered and checked. A step that
// only appears after two Continues is exactly the kind that ships blank and
// nobody notices for a week.
export default function AddEmployeeWizard({ onCreated, initialStep = 0 }) {
  const navigate = useNavigate()
  // 🔒 The record is created on step 1 and SAVED AFTER EVERY STEP. Closing the
  // page costs nothing: /people/:username/continue picks the same draft back
  // up (Adama 30 Aug — "rather than starting each time i close it").
  const { username: resumeUsername } = useParams()
  const [username, setUsername] = useState(resumeUsername || null)
  const [missing, setMissing] = useState([])
  const [step, setStep] = useState(initialStep)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [people, setPeople] = useState([])
  const fileInput = useRef(null)

  const [v, setV] = useState({
    name: '', email: '', personalEmail: '', phone: '', address: '',
    title: 'Sales Agent', department: 'Sales', manager: '', employmentType: 'Full-time',
    joined: today(), week: { ...DEFAULT_WEEK }, start: '09:00', end: '17:00',
    contractMonths: '', onProbation: true, probationMonths: '3',
    baseSalary: '', transport: '', commission: '', target: '5',
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

  const [contract, setContract] = useState(null)
  const [justIssued, setJustIssued] = useState(false)
  const [docs, setDocs] = useState({})   // slot key → File
  const [extra, setExtra] = useState([]) // other files

  // Picking a draft back up: refill the form from what is already saved.
  const [loading, setLoading] = useState(!!resumeUsername)
  useEffect(() => {
    if (!resumeUsername) return
    api(`/staff/${resumeUsername}/draft`)
      .then((d) => {
        const x = d.draft
        setV((p) => ({
          ...p,
          name: x.name, email: x.email, personalEmail: x.personalEmail, phone: x.phone, address: x.address,
          title: x.title, department: x.department || p.department, manager: x.manager,
          employmentType: x.employmentType || p.employmentType, joined: x.joined,
          week: x.week && Object.keys(x.week).length ? x.week : p.week,
          start: x.start, end: x.end,
          contractMonths: x.contractMonths, onProbation: Number(x.probationMonths) > 0,
          probationMonths: Number(x.probationMonths) > 0 ? x.probationMonths : p.probationMonths,
          baseSalary: x.baseSalary, transport: x.transport, commission: x.commission,
          target: x.target,
        }))
        setMissing(d.missing || [])
        // 🔒 Land where they stopped, not at the beginning. Back still works if
        // they want to go over something again.
        if (Number.isFinite(x.step)) setStep(Math.max(0, Math.min(STEPS.length - 1, x.step)))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [resumeUsername])

  // 🔑 Read from the SAVED record, not the form state — the contract has to be
  // the document that matches what is on file, not what is half-typed.
  useEffect(() => {
    if (STEPS[step][0] !== 'contract' || !username) return
    setContract(null)
    api(`/staff/${username}/contract`).then(setContract).catch((e) => setError(e.message))
  }, [step, username])

  useEffect(() => {
    api('/hr/employees').then((d) => setPeople((d.employees || []).map((e) => e.name))).catch(() => setPeople([]))
  }, [])

  const probationEnd = v.onProbation ? addMonths(v.joined, v.probationMonths) : ''
  // What is paid whatever happens, and what is paid when the target is met.
  const guaranteed = (Number(v.baseSalary) || 0) + (Number(v.transport) || 0)
  const onTarget = guaranteed + (Number(v.commission) || 0)
  const contractEnd = Number(v.contractMonths) > 0 ? addMonths(v.joined, v.contractMonths) : ''
  const isContractor = v.employmentType === 'Contractor'
  const isFixedTerm = FIXED_TERM_TYPES.includes(v.employmentType)
  const canProbate = PROBATION_TYPES.includes(v.employmentType)
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
      // A fixed term with no length is a contract with no end date, which is
      // the thing a fixed term is defined by.
      if (FIXED_TERM_TYPES.includes(v.employmentType) && !Number(v.contractMonths)) {
        return `${v.employmentType} needs a contract length`
      }
    }
    return ''
  }
  // Everything the record holds, in the shape both endpoints take.
  const payload = () => {
    const week = {}
    for (const [k] of DAY_KEYS) week[k] = v.week[k] ? { start: v.start, end: v.end } : null
    return {
      name: v.name.trim(), email: v.email.trim(), personalEmail: v.personalEmail.trim(),
      title: v.title.trim(), department: v.department, manager: v.manager,
      employmentType: v.employmentType, joined: v.joined,
      schedule: isContractor ? null : week,
      contractMonths: v.contractMonths, probationMonths: v.onProbation ? v.probationMonths : 0,
      baseSalary: v.baseSalary, transport: v.transport, commission: v.commission, target: v.target,
      phone: v.phone.trim(), address: v.address.trim(),
    }
  }

  // 🔒 SAVE, THEN MOVE. Step 1 creates the record as PENDING; every step after
  // updates it. Nothing typed is ever lost by closing the page, which is the
  // whole point — the record is being worked on, not started over.
  async function saveStep(landingOn = step) {
    setBusy(true)
    setError('')
    try {
      if (!username) {
        const r = await api('/staff', { method: 'POST', body: { ...payload(), step: landingOn, type: /manager|lead|supervisor/i.test(v.title) ? 'manager' : 'agent' } })
        setUsername(r.staff.username)
        onCreated?.()
      } else {
        const r = await api(`/staff/${username}/draft`, { method: 'PUT', body: { ...payload(), step: landingOn } })
        setMissing(r.missing || [])
      }
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const next = async () => {
    const p = problemWith(step)
    if (p) return setError(p)
    const landing = Math.min(STEPS.length - 1, step + 1)
    if (!(await saveStep(landing))) return
    setStep(landing)
  }
  const back = () => { setError(''); setStep((n) => Math.max(0, n - 1)) }
  const goTo = async (i) => {
    if (i === step) return
    if (i < step) { setError(''); await saveStep(i); return setStep(i) }
    for (let k = step; k < i; k++) { const p = problemWith(k); if (p) { setStep(k); return setError(p) } }
    if (!(await saveStep(i))) return
    setStep(i)
  }

  // "Complete — makes it all good." The record is finished. 🔒 It does NOT make
  // them an employee: Activate is its own decision, on its own day.
  async function finish() {
    for (let i = 0; i < STEPS.length; i++) { const p = problemWith(i); if (p) { setStep(i); return setError(p) } }
    if (!(await saveStep())) return
    setBusy(true)
    setError('')
    try {
      const who = username
      // Files attach to a person, so they go up once the record exists.
      // 🔒 A failed upload never un-creates somebody — it is reported and the
      // file stays outstanding.
      const queued = [
        ...Object.entries(docs).filter(([, f]) => f).map(([key, f]) => ({ f, category: key })),
        ...extra.map((f) => ({ f, category: 'general' })),
      ]
      const failed = []
      for (const { f, category } of queued) {
        try {
          await api('/agent-files', { method: 'POST', body: {
            agent: v.name.trim(), name: f.name, mimeType: f.type, category,
            // 🔒 A contract someone uploads is the copy that came BACK signed.
            ...(category === 'contract' ? { stage: 'signed' } : {}),
            base64: await readAsBase64(f),
          } })
        } catch { failed.push(f.name) }
      }
      const r = await api(`/staff/${who}/complete`, { method: 'POST', body: {} })
      const missingDocs = DOC_SLOTS.filter((d) => d.required && !docs[d.key] && !onFile(d.key)).map((d) => d.label)
      setDone({ username: who, name: v.name.trim(), email: v.email.trim(), status: r.status, missing: missingDocs, failed })
      onCreated?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // 🔒 ONE IDEA OF THE DOCUMENT. A contract generated on the previous step is
  // the employment contract — the Documents step must not go on asking for it
  // as though it were a different piece of paper.
  // 🔒 Both copies are kept and they answer different questions: the issued one
  // is what we sent, the signed one is the contract of record. Only the signed
  // one closes the item.
  const onFile = (key) => key === 'contract' && (Number(contract?.signed) > 0 || Number(contract?.issued) > 0)
  // Issued at any point, whether just now or on an earlier visit.
  const issuedNow = justIssued || Number(contract?.issued) > 0
  const todayLong = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const contractState = () => {
    if (docs.contract) return docs.contract.name
    if (Number(contract?.signed) > 0) return 'Signed copy on file'
    if (Number(contract?.issued) > 0) return 'Issued — awaiting the signed copy'
    return 'Not uploaded'
  }

  // 🔒 PULSE DOES NOT SEND THE CONTRACT. It used to post it from the server as
  // noreply@, which meant a contract arrived from an address nobody replies to,
  // Adama had no say in which account it came from, and the only sign anything
  // had happened was a line of text under an unchanged blue button (Adama
  // 30 Aug: "sending should open my email and i choose which email sends it ...
  // no indication except it's sent").
  //
  // So: the file is issued and filed HERE, and the mail is composed in HIS
  // email client, from whichever account he picks, where he can see it before
  // it goes and it lands in his sent items like every other letter.
  async function issueContract() {
    setBusy(true); setError('')
    try {
      const r = await api(`/staff/${username}/contract/file`, { method: 'POST', body: {} })
      setContract((c) => ({ ...c, issued: (Number(c?.issued) || 0) + 1 }))
      // 🔒 The PDF that was just filed is the PDF he attaches — the same bytes,
      // not a second rendering that could differ from the one on the record.
      const bin = atob(r.pdfBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Contract of Employment — ${v.name.trim() || 'employee'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setJustIssued(true)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  function openInEmail() {
    const first = (v.name.trim() || '').split(/\s+/)[0]
    const subject = 'Contract of Employment — Damia Security Solutions Ltd'
    const body = [
      `Dear ${first},`, '',
      'Please find your contract of employment attached.',
      'Read it carefully, and if you are happy with it, sign it and send a copy back to us.', '',
      'Adama Drammeh', 'CEO', 'Damia Security Solutions Ltd',
    ].join('\n')
    window.location.href = `mailto:${encodeURIComponent(contract.to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }


  if (loading) return <PageSkeleton tiles={0} rows={6} />

  if (done) {
    return (
      <Shell title={done.status === 'complete' ? 'Record complete' : 'Employee active'}
        subtitle={done.status === 'complete'
          ? `${done.name}'s record is finished. Activate them when they start.`
          : `${done.name} is on the team.`}>
        <Body>
        <div className="mx-auto max-w-[560px] py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' }}>
            <CheckCircle2 size={28} />
          </span>
          <p className="mt-4 text-[15px] font-semibold text-[var(--color-ink)]">
            {done.status === 'complete' ? `${done.name}'s record is complete` : `${done.name} is active`}
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{done.email ? `They sign in with ${done.email}` : 'No work email yet — no sign-in.'}</p>
          {done.status === 'complete' && (
            <div className="mt-5 text-left">
              <Note title="Complete, not employed yet">
                Not on payroll, not on a schedule, no sign-in. Activate them from Employees when the signed contract is back.
              </Note>
            </div>
          )}
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
          middle={error ? <span className="text-[12.5px] font-medium text-[var(--color-stage-out)]">{error}</span> : null}
          right={<Link to="/people" className="btn-primary">Back to employees</Link>}
        />
      </Shell>
    )
  }

  const id = STEPS[step][0]
  return (
    <Shell
      title={resumeUsername ? 'Continue employee record' : 'Add employee'}
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
            {i < step
              ? <Check size={11} className="mr-1 inline align-middle" />
              : <span className="mr-1.5 tabular-nums opacity-60">{i + 1}</span>}
            {label}
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
              <MenuSelect value={v.department} onChange={(x) => set('department', x)} options={DEPARTMENTS} />
            </label>
            <label className="block">
              <span className={L}>Reports to</span>
              <MenuSelect value={v.manager} onChange={(x) => set('manager', x)} placeholder="Not set yet"
                options={[{ value: '', label: 'Not set yet' }, ...people.map((n) => ({ value: n, label: n }))]} />
            </label>
            <label className="block">
              <span className={L}>Employment type</span>
              <MenuSelect value={v.employmentType} options={EMPLOYMENT_TYPES}
                onChange={(x) => {
                  // 🔒 The type owns these. Switching to a permanent type must
                  // not leave a 6-month contract length behind where nothing
                  // shows it any more, and a contractor is not on probation.
                  setV((p) => ({
                    ...p,
                    employmentType: x,
                    contractMonths: FIXED_TERM_TYPES.includes(x) ? p.contractMonths : '',
                    onProbation: PROBATION_TYPES.includes(x) ? p.onProbation : false,
                  }))
                  setError('')
                }} />
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

          {/* The contract. 🔒 Shown only when the TYPE says there is an end
              date — a permanent full-timer is not asked for a contract length,
              which is the contradiction that started this. */}
          <h3 className="mt-8 text-[15px] font-semibold text-[var(--color-ink)]">Contract</h3>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
            {isFixedTerm
              ? `${v.employmentType} runs for a set period. How long?`
              : `${v.employmentType} has no end date. Change the employment type above if it should.`}
          </p>
          {isFixedTerm && (
            <div className="mt-3">
              <Row>
                <label className="block">
                  <span className={L}>Length</span>
                  <MenuSelect value={v.contractMonths} onChange={(x) => set('contractMonths', x)}
                    options={[3, 6, 12, 24].map((m) => ({ value: String(m), label: `${m} months` }))} />
                </label>
                <div className="block">
                  <span className={L}>Contract ends</span>
                  <p className="field w-full text-[var(--color-ink-soft)]">{contractEnd ? pretty(contractEnd) : 'Pick a length'}</p>
                </div>
              </Row>
            </div>
          )}

          {canProbate && (
            <>
              <h3 className="mt-8 text-[15px] font-semibold text-[var(--color-ink)]">Probation</h3>
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
                {v.onProbation && (
                  <>
                    <label className="block">
                      <span className={L}>Length</span>
                      <MenuSelect value={v.probationMonths} onChange={(x) => set('probationMonths', x)}
                        options={[1, 3, 6].map((m) => ({ value: String(m), label: `${m} month${m > 1 ? 's' : ''}` }))} />
                    </label>
                    <div className="block">
                      <span className={L}>Review date</span>
                      <p className="field w-full text-[var(--color-ink-soft)]">{probationEnd ? pretty(probationEnd) : '—'}</p>
                    </div>
                    <div className="block">
                      <span className={L}>Status on activation</span>
                      <p className="field w-full text-[var(--color-ink-soft)]">On probation</p>
                    </div>
                  </>
                )}
              </div>
              {v.onProbation && (
                <div className="mt-5">
                  <Note tone="warn" title="The probation review lands in HR reminders on its own.">
                    It becomes this person&rsquo;s next HR milestone the day they are activated. Nothing is reviewed for you.
                  </Note>
                </div>
              )}
            </>
          )}

          <div className="mt-8">
            <Note title="Job role and Pulse access are separate">
              A {v.title || 'Sales Agent'} can be an Employee, Manager or Admin only if you explicitly grant that access. You do that on the last step.
            </Note>
          </div>
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
          {/* 🔑 BOTH NUMBERS. Base + transport alone is half the story — a
              package is agreed as "D7k base + D1k transport + D5k on target",
              so the on-target total is the figure the offer is actually made
              in. Showing only the guaranteed half made the page look like it
              was not adding up what had been typed (Adama 30 Aug). */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-[10px] p-4" style={{ background: 'var(--color-fill)' }}>
              <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">Guaranteed every month</p>
              <p className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums text-[var(--color-ink)]">D{guaranteed.toLocaleString()}</p>
              <p className="mt-2 text-[12px] text-[var(--color-ink-soft)]">
                D{(Number(v.baseSalary) || 0).toLocaleString()} base + D{(Number(v.transport) || 0).toLocaleString()} transport
              </p>
            </div>
            <div className="rounded-[10px] p-4" style={{ background: 'var(--color-brand-50)' }}>
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-brand)' }}>On target</p>
              <p className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums" style={{ color: 'var(--color-brand)' }}>D{onTarget.toLocaleString()}</p>
              <p className="mt-2 text-[12px] text-[var(--color-ink-soft)]">
                {Number(v.commission) > 0
                  ? `+ D${(Number(v.commission)).toLocaleString()} commission at ${Number(v.target) || 0} sales`
                  : 'No commission set — same as guaranteed'}
              </p>
            </div>
          </div>
        </Section>
      )}

      {id === 'contract' && (
        <Section title="Contract" line="Written from the record. Read it, then send it or keep a copy on their file.">
          {!username && <Note title="Save the earlier steps first">The contract is written from what is saved, so there is nothing to write yet.</Note>}

          {username && !contract && <p className="text-[13px] text-[var(--color-ink-soft)]">Writing the contract…</p>}

          {contract?.missing?.length > 0 && (
            <Note tone="warn" title="The contract cannot be written yet">
              Missing: {contract.missing.join(', ')}. Go back and fill those in — a contract with a blank salary or start date is worse than no contract.
            </Note>
          )}

          {contract && !contract.missing?.length && (
            <>
              {/* The document itself, exactly as it will be sent and filed.
                  🔒 Nothing can be sent that has not been shown here first. */}
              <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)]">
                <iframe title="Contract of employment" srcDoc={contract.html}
                  className="block h-[520px] w-full border-0 bg-white" />
              </div>

              {/* 🔒 Two steps, in the order they actually happen: get the
                  document, then write the mail. The second is deliberately
                  quiet until the first has been done — there is nothing to
                  attach before the contract has been issued. */}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button onClick={issueContract} disabled={busy} className="btn-primary disabled:opacity-60">
                  {busy ? 'Issuing…' : issuedNow ? 'Download the PDF again' : 'Issue contract & download PDF'}
                </button>
                <button onClick={openInEmail} disabled={!contract.to}
                  className={`inline-flex items-center gap-2 btn-secondary hover:bg-[var(--color-soft)] disabled:opacity-50 ${issuedNow ? '' : 'opacity-60'}`}>
                  <Mail size={15} /> Open in my email
                </button>
              </div>

              {issuedNow && (
                <p className="mt-4 text-[12.5px] font-medium" style={{ color: 'var(--color-pill-active)' }}>
                  Issued {todayLong()} · on their file
                </p>
              )}

              {!contract.to && (
                <p className="mt-4 text-[12.5px] font-medium" style={{ color: 'var(--color-pill-leave)' }}>
                  No personal email on their record — add one on the Personal step.
                </p>
              )}

            </>
          )}
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
                  <span className="text-[12px] font-medium truncate max-w-[240px]"
                    style={{ color: docs[d.key] || onFile(d.key) ? 'var(--color-pill-active)' : d.required ? 'var(--color-pill-leave)' : 'var(--color-ink-faint)' }}>
                    {d.key === 'contract' ? contractState() : docs[d.key] ? docs[d.key].name : 'Not uploaded'}
                  </span>
                  <label className="cursor-pointer text-[12.5px] font-semibold text-[var(--color-brand)] hover:underline">
                    {docs[d.key] ? 'Replace' : d.key === 'contract' && Number(contract?.issued) > 0 ? 'Upload signed' : 'Upload'}
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

          {/* The last step, so the record is worth showing whole before it is
              called complete. */}
          <div className="mt-7 rounded-[10px] border border-[var(--color-line)] p-5">
            <p className="text-[13px] font-semibold text-[var(--color-ink)]">Ready to complete</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              {[['Name', v.name || '—'], ['Sign-in', v.email || 'None yet'],
                ['Role', `${v.title || '—'} · ${v.department}`], ['Type', v.employmentType],
                ['Starts', pretty(v.joined)], ['Reports to', v.manager || 'Not set yet'],
                ['Probation', v.onProbation ? `${v.probationMonths} months, review ${pretty(probationEnd)}` : 'None'],
                ['Contract', contractEnd ? `Ends ${pretty(contractEnd)}` : 'Indefinite'],
                ['Guaranteed pay', `D${guaranteed.toLocaleString()} a month`],
                ['On target', onTarget > guaranteed ? `D${onTarget.toLocaleString()} a month` : 'No commission'],
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
          ? <button onClick={finish} disabled={busy} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save & complete'}</button>
          : <button onClick={next} disabled={busy} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save & continue'}</button>}
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
      {/* 🔴 No overflow-hidden. It rounds the bands nicely and then CLIPS every
          dropdown that opens near the bottom of the card. The bands round their
          own corners instead. */}
      <div className="card">{children}</div>
    </div>
  )
}

// The step chips live in the card's header band.
function Steps({ children }) {
  return (
    <div className="rounded-t-[11px] border-b border-[var(--color-line-soft)] px-5 py-4 md:px-7" style={{ background: 'var(--color-paper)' }}>
      {children}
    </div>
  )
}
function Body({ children }) {
  return <div className="px-5 py-7 md:px-7">{children}</div>
}
function Footer({ left, middle, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-b-[11px] border-t border-[var(--color-line)] px-5 py-4 md:px-7"
      style={{ background: 'var(--color-paper)' }}>
      <span className="min-w-[90px]">{left}</span>
      {middle && <span className="text-[12px] text-[var(--color-ink-faint)]">{middle}</span>}
      <span className="min-w-[90px] text-right">{right}</span>
    </div>
  )
}
