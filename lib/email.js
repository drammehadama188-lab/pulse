// Outbound email for Pulse — same pattern as the admin app's lib/email.js:
// Resend's HTTPS API, not SMTP, because DigitalOcean blocks outbound 465/587
// from droplets (confirmed 7 May 2026). Pulse runs on the same droplet.
//
// Exposes sendMail({to, subject, text, html}) and emailConfigured().

const RESEND_API_URL = 'https://api.resend.com/emails'

// Same sender identity as the admin app (one company, one address) — only
// "Pulse" is added to the display name so staff know which app is talking.
export const MAIL_FROM = process.env.MAIL_FROM || '"Damia Tracker · Pulse" <noreply@damiatracker.com>'
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || 'info@damiatracker.com'

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY
}

export async function sendMail({ to, subject, text, html }) {
  // Dev kill-switch (same rule as admin, earned by the 4 Jul 2026 incident
  // where localhost emailed a real customer a dead link): OUTBOUND_EMAIL=off
  // in the LOCAL .env only — prod's .env doesn't set it, so prod sends.
  if (String(process.env.OUTBOUND_EMAIL || '').toLowerCase() === 'off') {
    console.log(`[email] BLOCKED by OUTBOUND_EMAIL=off — would have sent "${subject}" to ${to}`)
    return { blocked: true, id: null }
  }
  if (!emailConfigured()) throw new Error('Email is not set up on this server (RESEND_API_KEY missing)')
  const r = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
      reply_to: MAIL_REPLY_TO,
    }),
  })
  if (!r.ok) {
    const errText = await r.text().catch(() => '')
    throw new Error(`Resend send failed (${r.status}): ${errText}`)
  }
  return r.json()
}
