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
  // 09:05 for everyone — including Adama viewing from the US.
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

export function dateLong(d = new Date()) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function dateShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// money in Gambian Dalasi
export function dalasi(n) {
  if (n == null) return '—'
  return 'D' + Number(n).toLocaleString('en-GB')
}
