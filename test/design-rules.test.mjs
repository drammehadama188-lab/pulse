// The design rules, checked across every page rather than trusted. Each line
// is one of his rules turned into something a script can fail on.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = `${d}/${f}`;
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsx') ? [p] : [];
});
const files = walk(`${ROOT}/src`);
const rule = (name, bad) => {
  const hits = files.filter((f) => bad.test(readFileSync(f, 'utf8')));
  console.log(`${hits.length ? '✗' : '✓'} ${name}${hits.length ? ` — ${hits.length} file(s): ${hits.slice(0, 3).map((h) => h.split('/').pop()).join(', ')}` : ''}`);
  return hits.length;
};
let bad = 0;
bad += rule('no 700 weight anywhere', /font-bold|font-extrabold|font-\[7/);
bad += rule('no 14px body text (body is 13)', /text-sm\b/);
bad += rule('no uppercase table headings', /uppercase[^"']*tracking[^"']*text-\[var\(--color-ink-faint\)\]/);
bad += rule('no pill-shaped buttons', /rounded-full[^"']*(px-5|px-6)[^"']*font-semibold/);
bad += rule('no 12px card radius', /rounded-xl|rounded-2xl|rounded-3xl/);
bad += rule('no heavy shadows outside the token', /shadow-\[0_6px|shadow-2xl/);
bad += rule('no pure black text', /text-black|#000\b|#000000/);
const css = readFileSync(`${ROOT}/src/index.css`, 'utf8');
console.log(/--color-ink: #172033/.test(css) ? '✓ primary ink is his #172033' : '✗ ink token wrong');
console.log(/Inter/.test(css) ? '✓ Inter is the font' : '✗ font wrong');
if (bad) {
  console.error(`\n✗ ${bad} breach(es) of the design rules. src/index.css is the spec — see project_pulse_hr_dashboard_20aug in memory.`);
  process.exit(1);
}
console.log('\n✓ Design rules: every page follows them.');
