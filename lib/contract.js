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

// 🔒 THE ENTITY IS THE LEGAL ONE. "Damia Security Solutions Ltd" is who
// employs people and signs contracts; "Damia Tracker" is what we trade as
// (Adama 30 Aug). "Gambia" is not part of either name — it appears in this
// document only as the JURISDICTION (Laws of The Gambia, Gambian public
// holidays), which is correct and stays.
export const LEGAL_ENTITY = 'DAMIA SECURITY SOLUTIONS LTD'
export const LEGAL_ENTITY_MIXED = 'Damia Security Solutions Ltd'
export const TRADING_AS = 'Damia Tracker'
// 🔒 His LEGAL name signs contracts. "Damia" is a nickname he uses (Adama,
// 30 Aug); it is not what goes on an employment agreement.
export const SIGNATORY = 'Adama Drammeh'
export const SIGNATORY_TITLE = 'Managing Director'

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
  p.push({ t: `This agreement is made between **${LEGAL_ENTITY}**, trading as ${TRADING_AS} (hereafter referred to as the Employer) on the one part and **${u.name || BLANK}** (hereafter referred to as the Employee) who will be employed as a **${(u.title || BLANK).toUpperCase()}** for the duration as stipulated in the Duration clause below.` })
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
  p.push({ k: 'Non-Disclosure', t: `The Employee will not reveal, to any other person or company, any of ${LEGAL_ENTITY_MIXED}'s trade secrets including financial records, customer data, operation tools and manuals, business policies, vendor agreements, training practices, and any and all records kept by the business or any of its employees.` })
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
  /* 🔒 A signature block has to make three things obvious: WHERE you sign, WHO
     is signing, and WHEN. The old one ran the names, the rule and the labels
     together into a single line, so it read as one long stroke with words
     scattered around it (Adama 30 Aug: "the signature part is a bit
     confusing"). Each party now gets a column: space, rule, then who. */
  .sign{margin-top:52px;width:100%;border-collapse:separate;border-spacing:32px 0;table-layout:fixed}
  .sign th{text-align:left;font-size:10pt;letter-spacing:1px;text-transform:uppercase;color:#555;padding-bottom:8px;font-weight:normal}
  .sign .space{height:64px}
  .sign .rule{border-bottom:1px solid #111}
  .sign .who{padding-top:8px;font-size:11pt;line-height:1.4;vertical-align:top}
  .sign .who b{display:block}
  .sign .date{padding-top:22px;font-size:11pt;color:#333;vertical-align:top}
  .cc{margin-top:40px;font-size:10pt;color:#555}
</style></head><body>
${body}
<table class="sign">
  <tr><th>Employer</th><th>Employee</th></tr>
  <tr><td class="space rule"></td><td class="space rule"></td></tr>
  <tr>
    <td class="who"><b>${esc(SIGNATORY)}</b>${esc(SIGNATORY_TITLE)}<br>${esc(LEGAL_ENTITY_MIXED)}</td>
    <td class="who"><b>${esc(name) || '____________'}</b>${esc(title)}</td>
  </tr>
  <tr><td class="date">Date: ____________</td><td class="date">Date: ____________</td></tr>
</table>
<p class="cc">Cc: HR, FC, File</p>
</body></html>`
}

// ---------- the PDF ----------
// 🔒 A CONTRACT IS A PDF. It was being issued as .html, which nobody attaches
// to an email and nobody can sign (Adama 30 Aug: "so it's not in PDF"). Same
// blocks, same wording — only the rendering differs, so the document on screen
// and the document that goes out cannot drift apart.
//
// Built with pdfkit's stock Times faces: no font files to ship, no Chromium on
// the droplet, and a serif that suits an agreement.
export async function contractPdf(u, opts = {}) {
  const { default: PDFDocument } = await import('pdfkit')
  const { blocks, name, title } = buildContract(u, opts)

  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 } })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const W = doc.page.width - 128
  const BODY = 10.5
  // A run of text where **this** is bold, laid out as one flowing paragraph.
  const rich = (text, opts2 = {}) => {
    const parts = String(text).split(/\*\*(.+?)\*\*/g)
    parts.forEach((part, i) => {
      if (!part) return
      doc.font(i % 2 ? 'Times-Bold' : 'Times-Roman').fontSize(BODY)
        .text(part, { continued: i < parts.length - 1, align: 'justify', ...opts2 })
    })
    // A paragraph that ended mid-run still has to be closed.
    if (parts.length % 2 === 0) doc.text('', { continued: false })
  }

  blocks.forEach((b) => {
    if (b.h) {
      doc.font('Times-Bold').fontSize(15).text(b.h, { align: 'center', characterSpacing: 1 })
      doc.moveDown(1.4)
      return
    }
    if (b.list) {
      doc.font('Times-Bold').fontSize(BODY).text(`${b.k}:`)
      doc.moveDown(0.3)
      b.list.forEach((l) => {
        doc.font('Times-Roman').fontSize(BODY).text('•  ', { continued: true, indent: 14 })
        rich(l, { indent: 14 })
      })
      doc.moveDown(0.8)
      return
    }
    if (b.k) {
      doc.font('Times-Bold').fontSize(BODY).text(`${b.k}: `, { continued: true })
      rich(b.t)
    } else {
      rich(b.t)
    }
    doc.moveDown(0.8)
  })

  // 🔒 The signature block never splits across a page break — half a signature
  // block on its own page is how a contract comes back signed in the wrong
  // place.
  const NEEDED = 210
  if (doc.y + NEEDED > doc.page.height - 64) doc.addPage()
  doc.moveDown(2)

  const left = 64
  const right = 64 + W / 2 + 12
  const colW = W / 2 - 12
  const label = (x, t) => doc.font('Times-Roman').fontSize(8.5).fillColor('#555')
    .text(t.toUpperCase(), x, doc.y, { width: colW, characterSpacing: 1 }).fillColor('#000')
  const top = doc.y
  label(left, 'Employer')
  doc.y = top
  label(right, 'Employee')

  const ruleY = top + 78
  doc.moveTo(left, ruleY).lineTo(left + colW, ruleY).lineWidth(0.75).stroke()
  doc.moveTo(right, ruleY).lineTo(right + colW, ruleY).stroke()

  const who = (x, lines) => {
    let y = ruleY + 8
    lines.forEach((l, i) => {
      doc.font(i === 0 ? 'Times-Bold' : 'Times-Roman').fontSize(10).text(l, x, y, { width: colW })
      y = doc.y
    })
    return y
  }
  const yA = who(left, [SIGNATORY, SIGNATORY_TITLE, LEGAL_ENTITY_MIXED])
  const yB = who(right, [name || '____________', title])
  const dateY = Math.max(yA, yB) + 18
  doc.font('Times-Roman').fontSize(10).text('Date: ____________', left, dateY, { width: colW })
  doc.text('Date: ____________', right, dateY, { width: colW })

  doc.font('Times-Roman').fontSize(8.5).fillColor('#555')
    .text('Cc: HR, FC, File', left, dateY + 30, { width: W })

  doc.end()
  return done
}
