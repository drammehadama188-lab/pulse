// Renders every page and every employee tab with realistic data.
//
// This exists because a blank white page shipped: an edit deleted a small
// component while five call sites still used it. `vite build` does not catch
// an undefined component — it is a runtime ReferenceError — and loading the
// module is not enough either. The only thing that catches it is rendering.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.sessionStorage = { getItem: () => 'tok', setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const { createServer } = await import(`${ROOT}/node_modules/vite/dist/node/index.js`);
const React = (await import(`${ROOT}/node_modules/react/index.js`)).default;
const { renderToStaticMarkup } = await import(`${ROOT}/node_modules/react-dom/server.node.js`);
const { MemoryRouter } = await import(`${ROOT}/node_modules/react-router-dom/dist/index.mjs`);
const vite = await createServer({
  root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
  // Pages read the signed-in user from context; the stub supplies one.
  resolve: { alias: [{ find: /.*\/context\/AuthContext\.jsx$/, replacement: join(ROOT, 'test/fixtures/auth-stub.jsx') }] },
});

let failed = 0;
const render = (label, el) => {
  try {
    renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
    return true;
  } catch (err) {
    failed++;
    console.error(`✗ ${label}: ${String(err.message).split('\n')[0]}`);
    return false;
  }
};

// 1. Every page module must load and render its first paint.
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = `${d}/${f}`;
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsx') ? [p] : [];
});
const pages = walk(`${ROOT}/src/pages`).map((p) => p.replace(ROOT, ''));
let rendered = 0;
for (const file of pages) {
  let mod;
  try {
    mod = await vite.ssrLoadModule(file);
  } catch (err) {
    failed++;
    console.error(`✗ ${file} failed to load: ${String(err.message).split('\n')[0]}`);
    continue;
  }
  if (typeof mod.default !== 'function') continue;
  if (render(file, React.createElement(mod.default))) rendered++;
}
console.log(`✓ ${rendered} page(s) render their first paint`);

// 2. The employee tabs, with data — this is where the blank page came from.
const tabs = await vite.ssrLoadModule('/src/pages/employee/tabs.jsx');
const person = {
  username: 'kaddy', name: 'Kaddy Bojang', title: 'Senior Sales Agent', department: 'Sales',
  email: 'k@damia.gm', phone: '+220 700 0000', address: 'Banjul', joined: '2025-03-12',
  employment: 'Full-time', schedule: 'Mon – Fri', reportsTo: 'Adama Damia',
};
// The Attendance tab is rendered through its VIEW, not the fetching shell:
// a self-fetching component server-renders as a skeleton and would prove
// nothing. This payload is the shape /api/hr/employee/:username/attendance
// returns — keep them in step.
const shift0 = { start: '08:00', end: '17:00' };
const attMonth = {
  month: '2026-08',
  today: '2026-08-27',
  attendanceStart: '2026-07-07',
  days: [
    { date: '2026-08-20', status: 'worked', checkIn: '2026-08-20T08:05:00Z', checkOut: '2026-08-20T17:00:00Z', workedMinutes: 535, overtimeMinutes: 0, missingCheckout: false, late: false, leaveType: null, scheduled: shift0, scheduledMinutes: 540, fixedByName: null, fixReason: '' },
    { date: '2026-08-21', status: 'late', checkIn: '2026-08-21T09:03:00Z', checkOut: '2026-08-21T17:03:00Z', workedMinutes: 480, overtimeMinutes: 3, missingCheckout: false, late: true, leaveType: null, scheduled: shift0, scheduledMinutes: 540, fixedByName: 'Adama Damia', fixReason: 'Forgot to clock out' },
    { date: '2026-08-22', status: 'absent', checkIn: null, checkOut: null, workedMinutes: null, overtimeMinutes: 0, missingCheckout: false, late: false, leaveType: null, scheduled: shift0, scheduledMinutes: 540, fixedByName: null, fixReason: '' },
    { date: '2026-08-25', status: 'worked', checkIn: '2026-08-25T08:20:00Z', checkOut: null, workedMinutes: null, overtimeMinutes: 0, missingCheckout: true, late: false, leaveType: null, scheduled: shift0, scheduledMinutes: 540, fixedByName: null, fixReason: '' },
    { date: '2026-08-26', status: 'leave', checkIn: null, checkOut: null, workedMinutes: null, overtimeMinutes: 0, missingCheckout: false, late: false, leaveType: 'Annual', scheduled: shift0, scheduledMinutes: 540, fixedByName: null, fixReason: '' },
    { date: '2026-08-27', status: 'today', checkIn: null, checkOut: null, workedMinutes: null, overtimeMinutes: 0, missingCheckout: false, late: false, leaveType: null, scheduled: shift0, scheduledMinutes: 540, fixedByName: null, fixReason: '' },
    { date: '2026-08-29', status: 'off', checkIn: null, checkOut: null, workedMinutes: null, overtimeMinutes: 0, missingCheckout: false, late: false, leaveType: null, scheduled: null, scheduledMinutes: 0, fixedByName: null, fixReason: '' },
  ],
  summary: {
    scheduledDays: 19, present: 13, late: 2, absent: 3, leave: 3,
    workedMinutes: 4990, scheduledMinutes: 9120, overtimeMinutes: 341,
    missingCheckouts: 1, ratePct: 68, latePctOfAttended: 10.5,
  },
};
const noop = () => {};
const cases = [
  ['JobPay', React.createElement(tabs.JobPay, { e: person, pay: { base: 6500, transport: 1000, commission: 0 }, contract: { type: 'Permanent', start: '2025-03-12', end: null, noticePeriod: '1 month', document: null } })],
  ['JobPay without pay', React.createElement(tabs.JobPay, { e: person, pay: null, contract: { type: 'Permanent', start: null, end: null, noticePeriod: '', document: null } })],
  ['Attendance', React.createElement(tabs.AttendanceMonth, { username: 'kaddy', d: attMonth, error: '', month: '2026-08', onMonth: noop, onReload: noop })],
  ['Attendance empty', React.createElement(tabs.AttendanceMonth, { username: 'kaddy', month: '2026-08', error: '', onMonth: noop, onReload: noop, d: { ...attMonth, days: [], summary: { ...attMonth.summary, scheduledDays: 0, present: 0, late: 0, absent: 0, leave: 0, workedMinutes: 0, scheduledMinutes: 0, overtimeMinutes: 0, missingCheckouts: 0, ratePct: null, latePctOfAttended: null } } })],
  ['Attendance loading', React.createElement(tabs.AttendanceMonth, { username: 'kaddy', d: null, error: '', month: '2026-08', onMonth: noop, onReload: noop })],
  ['Attendance failed', React.createElement(tabs.AttendanceMonth, { username: 'kaddy', d: null, error: 'Server said no', month: '2026-08', onMonth: noop, onReload: noop })],
  ['Documents', React.createElement(tabs.Documents, { documents: [{ id: '1', name: 'Contract.pdf', category: 'contract', sizeBytes: 2048, uploadedAt: '2026-01-05', uploadedBy: 'Adama' }], onUpload() {}, uploading: false })],
  ['Documents empty', React.createElement(tabs.Documents, { documents: [], onUpload() {}, uploading: false })],
  ['Notes', React.createElement(tabs.Notes, { notes: [{ kind: 'Coaching', title: 'Call quality', text: 'Good', by: 'Adama', at: '2026-08-01' }], username: 'kaddy' })],
  ['Notes empty', React.createElement(tabs.Notes, { notes: [], username: 'kaddy' })],
  ['History', React.createElement(tabs.History, { history: [{ date: '2025-03-12', event: 'Joined' }] })],
  ['History empty', React.createElement(tabs.History, { history: [] })],
];
let tabsOk = 0;
for (const [label, el] of cases) if (render(`tab ${label}`, el)) tabsOk++;
console.log(`✓ ${tabsOk} of ${cases.length} employee tab states render`);

await vite.close();
if (failed) {
  console.error(`\n✗ ${failed} render failure(s) — this is what a blank page looks like before it ships.`);
  process.exit(1);
}
console.log('\n✓ Render: every page and tab paints.');
