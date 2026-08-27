export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || name
}

export function timeShort(iso) {
  if (!iso) return '—'
  // Company clock = Gambia = GMT. Render in UTC so a 09:05 check-in reads
  // 09:05 for everyone — including Adama viewing from the US. This is THE
  // clock for the whole app (Adama 27 Aug: "all the times should be
  // gambian") — never format a timestamp with a page-local helper.
  const d = new Date(iso)
  return isNaN(d) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

export function dateLong(d = new Date()) {
  // Same Gambia pin as timeShort — near midnight a viewer abroad would
  // otherwise see yesterday's (or tomorrow's) date.
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

export function dateShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// money in Gambian Dalasi
export function dalasi(n) {
  if (n == null) return '—'
  return 'D' + Number(n).toLocaleString('en-GB')
}
