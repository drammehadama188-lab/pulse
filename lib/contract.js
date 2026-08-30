// THE CONTRACT, COMPOSED FROM THE RECORD (Adama 30 Aug).
//
// 🔒 THE WORDING IS HIS, NOT INVENTED. Every clause below is lifted from the
// employment agreements already in HR/team — Momodou Lamin Keita's Team Lead
// agreement is the structural model. Nothing here is drafted legal language;
// the only things that change are the FACTS, and they come from the employee
// record so the contract and the record cannot disagree.
//
// 🔒 A FACT THAT IS NOT KNOWN IS A BLANK LINE, never a guess. An employment
// contract with an invented salary or start date is worse than an unfinished
// one, because the unfinished one is obviously unfinished.

const BLANK = '____________'
const money = (n) => `GMD ${Number(n || 0).toLocaleString('en-GB')}`
const words = (n) => {
  const N = Number(n) || 0
  const ones = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const under1000 = (x) => {
    if (x < 20) return ones[x]
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? `-${ones[x % 10]}` : '')
    return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` and ${under1000(x % 100)}` : ''}`
  }
  if (N === 0) return 'Zero'
  if (N < 1000) return under1000(N)
  const th = Math.floor(N / 1000), rest = N % 1000
  return `${under1000(th)} Thousand${rest ? ` ${under1000(rest)}` : ''}`
}
export const longDate = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return isNaN(d) ? BLANK : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const addMonthsIso = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (isNaN(d) || !n) return ''
  d.setUTCMonth(d.getUTCMonth() + Number(n))
  d.setUTCDate(d.getUTCDate() - 1) // "both dates inclusive"
  return d.toISOString().slice(0, 10)
}
const DAY_NAME = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 0: 'Sunday' }
const hhmm = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''))
  if (!m) return BLANK
  const h = Number(m[1])
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// What the contract cannot be written without. 🔑 Separate from
// missingForComplete: a record can be complete enough to activate and still not
// carry everything a contract has to state.
export function missingForContract(u, week) {
  const gaps = []
  if (!String(u.name || '').trim()) gaps.push('Full name')
  if (!String(u.title || '').trim()) gaps.push('Job title')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(u.joined || ''))) gaps.push('Start date')
  if (!(Number(u.pay?.base) > 0)) gaps.push('Base salary')
  if (!week || !Object.values(week).some(Boolean)) gaps.push('Work schedule')
  return gaps
}

export function buildContract(u, { week = {}, manager = '' } = {}) {
  const base = Number(u.pay?.base) || 0
  const transport = Number(u.pay?.transport) || 0
  const commission = Number(u.pay?.commission) || 0
  const guaranteed = base + transport
  const months = /^(\d+)-month/.exec(String(u.contract || ''))?.[1]
  const fixed = Number(months) > 0
  const start = u.joined
  const end = fixed ? addMonthsIso(start, months) : ''
  const days = Object.entries(week).filter(([, v]) => v).map(([k]) => Number(k)).sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
  const shift = Object.values(week).find(Boolean) || null
  const hours = days.length
    ? `${DAY_NAME[days[0]]} to ${DAY_NAME[days[days.length - 1]]}, ${hhmm(shift?.start)} to ${hhmm(shift?.end)}`
    : BLANK
  const probMonths = (() => {
    if (!u.probationEnd || !start) return 0
    const a = new Date(`${start}T00:00:00Z`), b = new Date(`${u.probationEnd}T00:00:00Z`)
    if (isNaN(a) || isNaN(b)) return 0
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  })()

  const p = []
  p.push({ h: 'CONTRACT OF EMPLOYMENT' })
  p.push({ t: `This agreement is made between **DAMIA TRACKER GAMBIA** (hereafter referred to as the Employer) on the one part and **${u.name || BLANK}** (hereafter referred to as the Employee) who will be employed as a **${(u.title || BLANK).toUpperCase()}** for the duration as stipulated in the Duration clause below.` })
  p.push({ k: 'Position', t: `The Employee is employed as ${u.title || BLANK}${u.department ? ` in the ${u.department} department` : ''}${manager ? `, reporting to ${manager}` : ''}. Duties will be as communicated by Management and set out in the role's objectives. This position is transferable/changeable at the discretion of the Employer in agreement with the Employee.` })
  p.push({ k: 'Salary', t: `The Employer shall pay the Employee a Basic Monthly Salary of **${money(base)} (${words(base)} Dalasis)**.${transport ? ` In addition, a monthly transport allowance of **${money(transport)} (${words(transport)} Dalasis)** is payable, bringing guaranteed monthly pay to **${money(guaranteed)}**.` : ''} All remuneration is subject to lawful statutory deductions as required by the Laws of The Gambia for PAYE (Pay As You Earn) and Social Security NPF deductions.` })
  if (commission) {
    p.push({ k: 'Commission and Performance Incentives', t: `In addition to the basic salary, the Employee shall be eligible for commission of up to **${money(commission)} (${words(commission)} Dalasis)** per month, based on performance targets set by the Company from time to time${Number(u.target) ? `, currently ${u.target} per month` : ''}. Commission structures, targets, and payment schedules will be communicated separately by Management and may be revised at the discretion of the Company. Commission is not a guaranteed payment.` })
    p.push({ k: 'Earning Potential', list: [
      `Base Salary: ${money(base)}`,
      ...(transport ? [`Transport Allowance: ${money(transport)}`] : []),
      `Commission: up to ${money(commission)}`,
      `**Potential Total Monthly Earnings: up to ${money(guaranteed + commission)}**`,
    ] })
  }
  p.push({ k: 'Deductions', t: 'The remuneration will be subjected to all lawful deductions as mentioned in the Salary clause.' })
  if (probMonths > 0) {
    p.push({ k: 'Probation', t: `The first **${probMonths} (${words(probMonths)}) month${probMonths > 1 ? 's' : ''}** of this agreement shall be a probationary period, ending on **${longDate(u.probationEnd)}**, during which either party may terminate this agreement by giving one (1) week's notice. Confirmation in the role follows a satisfactory review at the end of that period.` })
  }
  p.push({ k: 'Confirmation', t: "During the period of your employment, either party may terminate this agreement by giving One (1) month's notice." })
  if (fixed) {
    p.push({ k: 'Notice', t: 'One month prior to the end of this agreement shall be considered automatically as notice given by either party (Employer or Employee) to end this agreement. The Employer may extend this contract for a period determined at his discretion.' })
  }
  p.push({ k: 'Hours of Work', t: `The normal working hours will be ${hours}. However, due to operational reasons you may be required to work extra hours or days (up to six days a week with at least one rest day) as determined by management. You will be entitled to the normal official holidays of The Gambia. However, should the demands of the operation require you to work on your day off or any official holiday, then these days can subsequently be taken as off days whenever the operation of the business permits.` })
  p.push({ k: 'Company Property', t: 'Any items issued by the Employer to the Employee remain the property of the Employer. The Employee shall return these items upon completion of this agreement and shall be held responsible for any damages (except normal wear and tear).' })
  p.push({ k: 'Company Rules and Regulations', t: 'The Employer will ensure the Employee thoroughly reads, understands and signs the House Rules and Regulations (The Blue Book), and the Employee shall acknowledge receipt and acceptance of these Rules and Regulations. The Employee binds him/herself through this agreement to comply with these Rules and Regulations.' })
  p.push({ k: 'Non-Disclosure', t: "The Employee will not reveal, to any other person or company, any of Damia Tracker Gambia's trade secrets including financial records, customer data, operation tools and manuals, business policies, vendor agreements, training practices, and any and all records kept by the business or any of its employees." })
  p.push({ k: 'Termination', t: 'Termination shall be in accordance with the Labour Act as stipulated in the House Rules and Regulations. The Employer reserves the right to terminate employment immediately, without notice, for gross misconduct.' })
  p.push({ k: 'Duration', t: fixed
    ? `This agreement is valid for a fixed period of **${months} (${words(months)}) Month${Number(months) > 1 ? 's' : ''}** (from **${longDate(start)}** to **${longDate(end)}**, both dates inclusive, unless terminated as stipulated above).`
    : `This agreement takes effect from **${longDate(start)}** and continues until terminated in accordance with the clauses above.` })
  p.push({ k: 'Leave Entitlement', t: 'In line with Company policy, paid annual leave applies only after twelve (12) months of continuous service. Any leave during this period is at the discretion of the Employer and to be taken at a date convenient to both parties.' })
  p.push({ t: 'By signing this contract, you agree that you have no underlying or current medical issues that may affect the job. You should disclose any issues to the HR/Admin Office in writing for review by the General Manager.' })
  p.push({ t: "The application of the Employer's and Employee's signatures to this contract signifies that both parties have accepted this agreement and that the Employee has read and understood all articles." })
  return { blocks: p, name: u.name || '', title: u.title || '' }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

// One printable page. Kept deliberately plain: it is a legal document, and it
// has to look the same printed as it does on screen.
export function contractHtml(u, opts = {}) {
  const { blocks, name, title } = buildContract(u, opts)
  const body = blocks.map((b) => {
    if (b.h) return `<h1>${esc(b.h)}</h1>`
    if (b.list) return `<p><strong>${esc(b.k)}:</strong></p><ul>${b.list.map((l) => `<li>${bold(l)}</li>`).join('')}</ul>`
    if (b.k) return `<p><strong>${esc(b.k)}:</strong> ${bold(b.t)}</p>`
    return `<p>${bold(b.t)}</p>`
  }).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Contract of Employment — ${esc(name)}</title>
<style>
  body{font:12pt/1.6 Georgia,'Times New Roman',serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px}
  h1{font-size:16pt;text-align:center;letter-spacing:1px;margin-bottom:28px}
  p{margin:0 0 14px} ul{margin:0 0 14px 20px} li{margin-bottom:4px}
  .sign{margin-top:44px;width:100%;border-collapse:collapse}
  .sign td{padding-top:34px;font-size:11pt;vertical-align:bottom;width:33%}
  .line{border-top:1px solid #111;padding-top:6px}
  .cc{margin-top:26px;font-size:10pt;color:#555}
</style></head><body>
${body}
<table class="sign">
  <tr><td>Damia Adama<br>Managing Director</td><td>WITNESS</td><td>${esc(name)}<br>${esc(title)}</td></tr>
  <tr><td class="line">Employer's Signature</td><td class="line">Witness Signature</td><td class="line">Employee's Signature</td></tr>
</table>
<p class="cc">Dated: ____________<br>Cc: HR, FC, File</p>
</body></html>`
}
