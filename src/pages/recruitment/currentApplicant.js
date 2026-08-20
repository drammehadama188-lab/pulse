import { useSyncExternalStore } from 'react'

// Who the sidebar is currently looking at. The applicant's pages live in the
// rail (Adama, 20 Aug: "the profiles should have a page in the side bars"), and
// the rail is rendered far away from the page that knows the name — so the page
// publishes it here and the sidebar subscribes.
//
// Deliberately tiny: no context provider wrapping the app for one string.
let current = null
const listeners = new Set()

export function setCurrentApplicant(next) {
  // Same person, same interview: skip the re-render.
  if (current?.id === next?.id && current?.name === next?.name && current?.interviewId === next?.interviewId) return
  current = next
  listeners.forEach((l) => l())
}

export function useCurrentApplicant() {
  // Pulse renders in the browser only, so the "server" snapshot is the same
  // value — returning null there would make this untestable outside one.
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => current,
    () => current,
  )
}

// The pages a person has. `to` is built against their id.
export const APPLICANT_PAGES = [
  ['overview', 'Overview'],
  ['cv', 'CV'],
  ['interview', 'Interview'],
  ['notes', 'Notes'],
  ['activity', 'Activity'],
]
