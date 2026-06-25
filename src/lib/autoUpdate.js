// Auto-update: makes the app pick up a new deploy without a manual hard reload.
//
// Problem it solves: the browser caches index.html, so opening/returning to the
// tab can run a previously-loaded build until you reload by hand.
//
// How it works: we read the build SIGNATURE of the code that is actually
// running (the hashed module-script URLs Vite put in the live document). When
// you focus / reveal the tab, we re-fetch index.html cache-busted and read its
// signature. In a production build the asset hashes change every deploy, so a
// new build has a different signature — and we reload once.
//
// Why it's correct for a cold open from cache: the running signature comes from
// the DOM (what the browser actually executed, possibly an old cached page),
// not from a fresh fetch — so a stale running build is detected against the
// fresh index.html and reloaded.
//
// Why it's safe:
//  - Dev: the entry is /src/main.jsx with no /assets/ hash, so both signatures
//    are empty and equal — it never reloads. Vite HMR handles live dev updates.
//  - It only checks on focus/visibility, never mid-interaction, so it won't
//    discard a form you're typing in.
//  - One reload per detected change (guarded by `reloading`).

const INDEX_URL = '/index.html'

let reloading = false

// Hashed module assets are what change between builds. Match Vite's emitted
// /assets/*.js module scripts; ignore /src/* (dev) so dev never triggers.
function signatureFromHtml(html) {
  const sig = new Set()
  const re = /<script[^>]*\bsrc="([^"]+)"[^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    if (m[1].includes('/assets/')) sig.add(m[1])
  }
  return [...sig].sort().join('|')
}

function runningSignature() {
  const sig = new Set()
  for (const el of document.querySelectorAll('script[src]')) {
    const src = el.getAttribute('src') || ''
    if (src.includes('/assets/')) sig.add(src)
  }
  return [...sig].sort().join('|')
}

async function check() {
  if (reloading) return
  if (document.visibilityState !== 'visible') return
  const running = runningSignature()
  if (!running) return // dev, or nothing hashed to compare — nothing to do
  let latest
  try {
    const res = await fetch(INDEX_URL, { cache: 'no-store' })
    if (!res.ok) return
    latest = signatureFromHtml(await res.text())
  } catch {
    return // offline / network blip — try again next focus
  }
  if (latest && latest !== running) {
    reloading = true
    window.location.reload()
  }
}

export function startAutoUpdate() {
  check()
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
}
