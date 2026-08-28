#!/usr/bin/env node
/**
 * File the HR folders into each employee's Pulse record.
 *
 * The paperwork lived only in ~/Desktop/excel/HR/team/<Person>/ while Pulse
 * held one document in total (Adama, 27 Aug 2026). This walks those folders,
 * works out what each file IS from its name, and uploads it to that person's
 * Documents tab with the right label.
 *
 *   SEE THE PLAN (no sign-in, no network, nothing uploaded):
 *     node scripts/import-hr-documents.mjs --plan
 *
 *   DRY RUN against the live site — asks you to sign in, uploads nothing:
 *     node scripts/import-hr-documents.mjs
 *
 *   FOR REAL:
 *     node scripts/import-hr-documents.mjs --apply
 *
 * It asks for your Pulse sign-in — email or username, whichever you use —
 * and your password. The password is not shown as you
 * type, goes straight to Pulse over HTTPS, and is never stored, logged or
 * echoed. (PULSE_TOKEN=… still works if you would rather pass a token.)
 *
 * 🔒 SAFE BY DESIGN:
 *   - Reads your folders. Never moves, renames or deletes anything.
 *   - Dry run unless you pass --apply.
 *   - Skips a file already on that person's record (same name), so running it
 *     twice does not create duplicates.
 *   - Refuses to upload for anyone who is not on the live Pulse roster.
 *   - Photos, markdown drafts, .docx duplicates of a signed PDF, the company
 *     handbook and the draft termination letter are all left alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const ROOT = process.env.HR_ROOT || join(homedir(), 'Desktop/excel/HR/team');
const BASE = process.env.PULSE_URL || 'https://pulse.damiatracker.com';
let TOKEN = process.env.PULSE_TOKEN;
const APPLY = process.argv.includes('--apply');
// --plan needs no login and no network: it just shows what it would file.
const PLAN_ONLY = process.argv.includes('--plan');

// Asking here beats hunting for a token in the browser console. What is typed
// goes straight to Pulse over HTTPS and is never stored, echoed or logged.
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Mask what is typed, but only when this really is a terminal — piped or
    // redirected input has no cursor to move and would throw.
    const mask = hidden && process.stdout.isTTY;
    let onData;
    if (mask) {
      onData = () => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      if (onData) process.stdin.removeListener('data', onData);
      rl.close();
      if (mask) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function signIn() {
  // Pulse matches EITHER the username or the email (findUser), so whatever
  // he types on the sign-in page works here — no need to remember which.
  const username = await ask('Pulse email or username (whatever you sign in with): ');
  const password = await ask('Password (not shown): ', true);
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.error || `sign-in failed (HTTP ${res.status})`);
  console.log(`Signed in as ${data.user?.name || username}\n`);
  return data.token;
}

// Folder name -> the Pulse employee NAME. The upload API keys on the display
// name, so this mapping is the whole reason the import can be trusted: a typo
// here files someone's contract on the wrong person.
const FOLDER_TO_NAME = {
  Ebrima_Jallow: 'Ebrima Jallow',
  'Momodou lamin Keita': 'Momodou Lamin Keita',
  'Mustapha Kora': 'Mustapha Kora',
  Ramatoulie_Mboge: 'Ramatoulie Mboge',
  Sally_Saidy: 'Sally Saidy',
  Ya_Fatou_Sawanneh: 'Yafatou Sawaneh',
};

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
};

// A readable label from a filename: drop the extension, the "PDF " prefix
// some files carry, and tidy the spacing.
function tidy(fn) {
  return basename(fn, extname(fn)).replace(/^pdf\s+/i, '').replace(/\s+/g, ' ').trim();
}

// What a file IS, from what it is called. Returns null to leave it alone.
function classify(fn) {
  const low = fn.toLowerCase();
  const ext = extname(fn).toLowerCase();

  if (['.md', '.heic', '.jpg', '.jpeg', '.png'].includes(ext)) return null;
  // A draft termination is not a decision, and Pulse shows documents to
  // everyone with HR access. Adama: leave it out (27 Aug).
  if (low.includes('termination')) return null;
  if (low.includes('handbook')) return null; // company-wide, not personal

  if (low.includes('offer letter')) return ['Offer letter', 'contract'];
  if (low.includes('probation contr')) return ['Probation contract', 'contract'];
  if (low.includes('agreement') || low.includes('contract') || low.includes('contrct')) {
    return ['Employment contract', 'contract'];
  }
  if (low.includes('curriculum') || /\bcv\b/.test(low) || low.includes('_cv')) return ['CV', 'document'];
  if (low.includes('national id') || low.includes('id card')) return ['ID document', 'document'];
  if (low.includes('nda')) return ['NDA', 'document'];
  if (low.includes('role change')) return ['Role change letter', 'document'];
  if (low.includes('training arrangement')) return ['Training arrangement', 'document'];
  // Reviews keep their own period in the label: three files all called
  // "Performance review" would collide on the record and hide two of them.
  if (low.includes('review') || low.includes('performance')) {
    return [tidy(fn).replace(/^PDF\s+/i, ''), 'monthly-review'];
  }
  if (low.includes('officer') || low.includes('job description')) return ['Job description', 'document'];
  return [tidy(fn).slice(0, 60), 'general'];
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const main = async () => {
  console.log(PLAN_ONLY ? '── PLAN ONLY (no sign-in, no network, nothing uploaded) ──'
    : APPLY ? '── UPLOADING ──' : '── DRY RUN (nothing is uploaded) ──');
  if (!PLAN_ONLY && !TOKEN) TOKEN = await signIn();

  // Who really exists, and what each already has. Doing this first means a
  // name that does not match is caught before a single byte is sent.
  const roster = PLAN_ONLY ? [] : ((await api('/hr/employees')).employees || []);
  const byName = new Map(roster.map((e) => [e.name, e]));
  if (!PLAN_ONLY) console.log(`Live roster: ${roster.length} people\n`);

  const existing = new Map(); // name -> Set(labels already on the record)
  for (const e of roster) {
    try {
      const rec = await api(`/hr/employee/${encodeURIComponent(e.username)}`);
      existing.set(e.name, new Set((rec.documents || []).map((f) => f.name)));
    } catch { existing.set(e.name, new Set()); }
  }

  let uploaded = 0, skipped = 0, failed = 0;
  for (const folder of readdirSync(ROOT).sort()) {
    const dir = join(ROOT, folder);
    if (folder.startsWith('.') || !statSync(dir).isDirectory()) continue;
    const who = FOLDER_TO_NAME[folder];
    if (!who) { console.log(`\n${folder}\n   ✗ no mapping — skipped entirely`); continue; }
    if (!PLAN_ONLY && !byName.has(who)) { console.log(`\n${folder} -> ${who}\n   ✗ not on the live roster — skipped entirely`); continue; }
    console.log(`\n${folder} -> ${who}`);

    const files = walk(dir).sort();
    const usedLabels = new Set();
    // Where a .docx and a .pdf are the same document, the PDF is the record.
    const pdfStems = new Set(files.filter((f) => f.toLowerCase().endsWith('.pdf'))
      .map((f) => basename(f, extname(f)).toLowerCase().replace(/^pdf\s+/, '').trim()));

    for (const full of files) {
      const fn = basename(full);
      if (fn.startsWith('.')) continue;
      const what = classify(fn);
      if (!what) { console.log(`   ·  skip  ${fn}`); skipped++; continue; }
      const stem = basename(fn, extname(fn)).toLowerCase().trim();
      if (fn.toLowerCase().endsWith('.docx') && [...pdfStems].some((p) => p.includes(stem) || stem.includes(p))) {
        console.log(`   ·  skip  ${fn}  (the signed PDF is being filed)`);
        skipped++; continue;
      }
      let [label, category] = what;
      // Same label twice for one person hides a document. Fall back to the
      // file's own name, which is always distinct.
      if (usedLabels.has(label)) label = tidy(fn).slice(0, 60);
      usedLabels.add(label);
      if (existing.get(who)?.has(label)) {
        console.log(`   ·  have  ${label}`);
        skipped++; continue;
      }
      if (!APPLY || PLAN_ONLY) {
        console.log(`   +  would file  [${category}] ${label}   ← ${relative(ROOT, full)}`);
        uploaded++; continue;
      }
      try {
        await api('/agent-files', {
          method: 'POST',
          body: JSON.stringify({
            agent: who,
            name: label,
            category,
            mimeType: MIME[extname(fn).toLowerCase()] || 'application/octet-stream',
            base64: readFileSync(full).toString('base64'),
          }),
        });
        console.log(`   ✓  filed  [${category}] ${label}`);
        uploaded++;
      } catch (err) {
        console.log(`   ✗  FAILED ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${APPLY ? 'Filed' : 'Would file'}: ${uploaded}   Skipped: ${skipped}   Failed: ${failed}`);
  if (!APPLY) console.log('Nothing was uploaded. Re-run with --apply when this looks right.');
};

main().catch((e) => { console.error('\nStopped:', e.message); process.exit(1); });
