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
const rule = (name, bad, skip = () => false) => {
  const hits = files.filter((f) => !skip(f) && bad.test(body(f)));
  console.log(`${hits.length ? '✗' : '✓'} ${name}${hits.length ? ` — ${hits.length} file(s): ${hits.slice(0, 3).map((h) => h.split('/').pop()).join(', ')}` : ''}`);
  return hits.length;
};
// Comments talk ABOUT the rules; they are not breaches of them.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const body = (f) => strip(readFileSync(f, 'utf8'));

let bad = 0;
bad += rule('no 700 weight anywhere', /font-bold|font-extrabold|font-\[7/);
bad += rule('no 14px body text (body is 13)', /text-sm\b/);
bad += rule('no uppercase table headings', /uppercase[^"']*tracking[^"']*text-\[var\(--color-ink-faint\)\]/);
bad += rule('no pill-shaped buttons', /rounded-full[^"']*(px-5|px-6)[^"']*font-semibold/);
bad += rule('no 12px card radius', /rounded-xl|rounded-2xl|rounded-3xl/);
bad += rule('no heavy shadows outside the token', /shadow-\[0_6px|shadow-2xl/);
bad += rule('no pure black text', /text-black|#000\b|#000000/);

// The product rules Adama set on 21 Aug (DESIGN.md). Same file, one check —
// two competing checkers would be the very drift these rules exist to stop.
bad += rule(
  'one pagination everywhere (default 25, 10/25/50)',
  /(\bsetPage\b|\bpageSize\b|per page|PAGE_SIZES?\b)/,
  (f) => f.endsWith('ui/Pager.jsx') || /from '.*ui\/Pager\.jsx'/.test(readFileSync(f, 'utf8')),
);
bad += rule(
  'no bare empty state ("No data.")',
  /["'>]\s*(No data|No results|Nothing to show)\.?\s*["'<]/,
);
bad += rule(
  'colour comes from the tokens, not hex in a page',
  /#[0-9a-fA-F]{6}\b[\s\S]*?#[0-9a-fA-F]{6}\b[\s\S]*?#[0-9a-fA-F]{6}\b/,
  (f) => f.endsWith('ui.jsx'),
);
bad += rule(
  "colour meaning comes from the tokens, not Tailwind's palette",
  /\b(?:bg|text|border|ring|fill|stroke|divide|outline|from|to|via)-(?:blue|sky|cyan|green|emerald|teal|lime|red|rose|amber|yellow|orange|purple|violet|indigo|fuchsia|pink|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/,
);
bad += rule(
  'spacing is 8 / 12 / 16 / 24 / 32 / 40',
  /\b(?:padding|margin|gap):\s*(?:[0-9]+px\s+)?(?:5|7|9|11|13|15|17|18|19|21|22|23|25|26|27|28|29|30|31)px/,
);
const css = readFileSync(`${ROOT}/src/index.css`, 'utf8');
console.log(/--color-ink: #172033/.test(css) ? '✓ primary ink is his #172033' : '✗ ink token wrong');
console.log(/Inter/.test(css) ? '✓ Inter is the font' : '✗ font wrong');
if (bad) {
  console.error(`\n✗ ${bad} breach(es) of the design rules. DESIGN.md is the rulebook, src/design.js the numbers, src/index.css the colours.`);
  process.exit(1);
}
console.log('\n✓ Design rules: every page follows them.');
