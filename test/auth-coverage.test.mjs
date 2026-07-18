// Auth-coverage guard for Pulse.
//
// WHY THIS EXISTS: Pulse routes opt into authentication by putting the `auth`
// middleware in their chain, e.g. app.get('/api/foo', auth, handler). Any /api
// route that FORGETS `auth` is served to anyone on the internet with no login.
// That is the exact class of bug that once left staff data publicly readable.
// A soft "remember to add auth" rule is not reliable; this test makes it a
// mechanical check that fails the build.
//
// HOW: static analysis. It reads server.js, finds every app.METHOD('/api/...')
// registration, and asserts each one either (a) has `auth` in its middleware
// chain, or (b) is on the PUBLIC allowlist below with a stated reason. A new
// unprotected route fails; a stale allowlist entry (route renamed/removed) also
// fails, so the allowlist can't silently rot.
//
// LIMITATION (be honest): this proves the middleware is WIRED IN, not that it
// works. It does not boot the server. It catches "forgot the guard", which is
// the real-world failure mode. Behaviour of `auth` itself is covered by it
// being the single shared gate used by ~125 routes.
//
// Run: npm test   (or: node test/auth-coverage.test.mjs)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(__dirname, '..', 'server.js')

// Routes that are PUBLIC or use an alternate auth mechanism instead of the
// `auth` middleware. Every entry needs a reason. Adding a route here is a
// deliberate, reviewable act — that is the point.
// Key format: "METHOD /exact/path/as/written/in/server.js"
const ALLOWLIST = {
  'POST /api/login':
    'Public: issues the session token — this is how a user authenticates.',
  'GET /api/password-link/:token':
    'Public: emailed set-password link; the one-time token in the URL is the credential.',
  'POST /api/password-link/:token':
    'Public: submits a new password via the emailed token; token is validated inside.',
  'GET /api/integrations/kpi-targets':
    'Alternate auth: shared-secret header x-pulse-key (PULSE_SYNC_KEY), machine-to-machine bridge.',
  'GET /api/agent-files/:id/download':
    'Alternate auth: validates the session token from ?t= inline, because a browser download link cannot set the Authorization header.',
}

const src = fs.readFileSync(SERVER, 'utf8').split('\n')
const routeRx = /app\.(get|post|put|patch|delete)\(\s*(['"`])(.*?)\2\s*(.*)/

const routes = []
src.forEach((line, idx) => {
  const m = routeRx.exec(line)
  if (!m) return
  const [, method, , routePath, rest] = m
  routes.push({
    line: idx + 1,
    method: method.toUpperCase(),
    path: routePath,
    // `\bauth\b` matches the standalone middleware, not requireCeo/notViewAs etc.
    hasAuth: /\bauth\b/.test(rest),
  })
})

const apiRoutes = routes.filter((r) => r.path.startsWith('/api'))

const unprotected = []
const seenAllowlist = new Set()
for (const r of apiRoutes) {
  const key = `${r.method} ${r.path}`
  if (r.hasAuth) continue
  if (key in ALLOWLIST) {
    seenAllowlist.add(key)
    continue
  }
  unprotected.push(r)
}

const staleAllowlist = Object.keys(ALLOWLIST).filter((k) => !seenAllowlist.has(k))

let failed = false

if (unprotected.length) {
  failed = true
  console.error(`\n✗ ${unprotected.length} /api route(s) have NO auth and are PUBLIC:\n`)
  for (const r of unprotected) {
    console.error(`  server.js:${r.line}  ${r.method} ${r.path}`)
  }
  console.error(
    '\n  Fix: add the `auth` middleware to the route chain, e.g.\n' +
      "    app.get('" + unprotected[0].path + "', auth, /* ...handler */)\n" +
      '  If the route is intentionally public or uses another auth mechanism,\n' +
      '  add it to ALLOWLIST in this file WITH a reason.\n'
  )
}

if (staleAllowlist.length) {
  failed = true
  console.error(`\n✗ ${staleAllowlist.length} ALLOWLIST entr(y/ies) no longer match a route (renamed or removed):\n`)
  for (const k of staleAllowlist) console.error(`  ${k}`)
  console.error('\n  Fix: remove the stale entry from ALLOWLIST in this file.\n')
}

if (failed) {
  console.error(`Auth-coverage check FAILED. ${apiRoutes.length} /api routes scanned.\n`)
  process.exit(1)
}

console.log(
  `✓ Auth-coverage OK: all ${apiRoutes.length} /api routes are authenticated ` +
    `(${apiRoutes.length - seenAllowlist.size} via auth middleware, ${seenAllowlist.size} allowlisted public/alternate-auth).`
)
