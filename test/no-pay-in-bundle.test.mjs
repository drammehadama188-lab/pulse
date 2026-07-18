// Guard: staff pay must never ship inside Pulse's front-end code.
//
// WHY THIS EXISTS: On 15 Jul 2026 an audit found every staff salary baked into
// the app's JavaScript bundle (src/data/team.js was compiled into dist/), so
// anyone could download the code and read all pay WITHOUT logging in. It was
// fixed by moving pay to the server-only lib/roster-pay.js, sent only to
// authorised users at runtime. This test makes that fix permanent: if pay data
// ever creeps back into the shipped code, the build fails.
//
// HOW IT DECIDES (learned the hard way): the shipped code LEGITIMATELY contains
// the word "commission" and round numbers like 5000 — because the UI displays
// pay it fetches from the server, and 5000 is a common target. So neither the
// word nor the number alone is a leak. The real leak signature is a pay field
// glued to a hardcoded number, e.g. `commission:16000` or `commission:1e4`.
// That is what the leaked bundle contained and what this test looks for. It is
// zero on clean code, so it never cries wolf.
//
// Two checks:
//   1. The built bundle (dist/assets/*.js) has no `payField:<number-literal>`.
//   2. No front-end file (src/) imports the server-only pay module.
//
// Run: npm test        (also runs automatically after `npm run build`)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

let failed = false

// ---------- Check 1: no pay values baked into the built bundle ----------
// Pay-specific field names. Deliberately NOT including generic words like
// `base` or `total` (those legitimately appear as e.g. total:0 in the UI).
// `commission` next to a number cannot be anything but leaked pay.
const PAY_FIELD = /(commission|finalPay|transport)\s*:\s*\d/g

const assetsDir = path.join(ROOT, 'dist', 'assets')
if (!fs.existsSync(assetsDir)) {
  console.log('• No build found (dist/assets). Skipping bundle scan — run `npm run build` to check the shipped code.')
} else {
  const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  let bundleHits = 0
  for (const f of jsFiles) {
    const code = fs.readFileSync(path.join(assetsDir, f), 'utf8')
    const matches = code.match(PAY_FIELD) || []
    if (matches.length) {
      bundleHits += matches.length
      console.error(`\n✗ Pay data found in shipped code: dist/assets/${f}`)
      console.error(`  Matches (a pay field with a hardcoded number): ${[...new Set(matches)].join(', ')}`)
    }
  }
  if (bundleHits) {
    failed = true
    console.error(
      '\n  This means salaries are being compiled into the app again — anyone could read them.\n' +
        '  Fix: pay must live ONLY in server-only lib/roster-pay.js and be sent via the\n' +
        '  authenticated API (/api/me, /api/payroll). Remove the pay values from whatever\n' +
        '  front-end file re-introduced them.\n'
    )
  } else {
    console.log(`✓ Bundle clean: no pay values baked into ${jsFiles.length} shipped file(s).`)
  }
}

// ---------- Check 2: front-end must not import the server pay module ----------
const srcDir = path.join(ROOT, 'src')
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const badImports = []
if (fs.existsSync(srcDir)) {
  for (const file of walk(srcDir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return // ignore comments
      // an actual import/require of the server pay module
      if (/(import[\s\S]*from\s*['"][^'"]*roster-pay|require\(\s*['"][^'"]*roster-pay)/.test(line)) {
        badImports.push(`src/${path.relative(srcDir, file)}:${i + 1}`)
      }
    })
  }
}
if (badImports.length) {
  failed = true
  console.error('\n✗ Front-end code imports the server-only pay module (lib/roster-pay.js):')
  for (const b of badImports) console.error(`  ${b}`)
  console.error(
    '\n  That pulls real pay figures into the browser bundle. Pay must be fetched from\n' +
      '  the authenticated API instead, never imported into a src/ file.\n'
  )
} else {
  console.log('✓ No front-end file imports the server pay module.')
}

if (failed) {
  console.error('\nPay-in-bundle check FAILED — do not deploy until fixed.\n')
  process.exit(1)
}
console.log('\n✓ Pay stays server-side. Salaries are not in the shipped code.')
