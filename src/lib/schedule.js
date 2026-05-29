// Default weekly shift for staff. (v1: one default for everyone; per-person/editable later.)
// Gambia work week: Mon–Sat working, Sunday off. The Gambia is GMT so local date == server UTC date.

export const SHIFT = { start: '09:00', end: '17:00' }
export const WORKDAYS = [1, 2, 3, 4, 5] // 0=Sun … 6=Sat → Mon–Fri (Blue Book: normal week)
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Per-day shift (Mon–Sun). null = day off. Blue Book: normal week Mon–Fri 9–5; up to 6 days
// may be required (1 rest day). Per-person/role schedules can extend this later.
export const SCHEDULE = {
  1: { start: '09:00', end: '17:00' },
  2: { start: '09:00', end: '17:00' },
  3: { start: '09:00', end: '17:00' },
  4: { start: '09:00', end: '17:00' },
  5: { start: '09:00', end: '17:00' },
  6: null,
  0: null,
}
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon … Sun

export function shiftFor(dow) {
  return SCHEDULE[dow] || null
}
export function isWorkday(dow) {
  return !!SCHEDULE[dow]
}

export function ymd(d) {
  const z = new Date(d)
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`
}

// the 7 days (Mon→Sun) of the week containing `ref`
export function weekDays(ref = new Date()) {
  const d = new Date(ref)
  const mondayOffset = (d.getDay() + 6) % 7 // 0 if Monday
  const monday = new Date(d)
  monday.setDate(d.getDate() - mondayOffset)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    return x
  })
}
