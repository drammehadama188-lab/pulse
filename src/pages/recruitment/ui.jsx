// The Recruitment design system (Adama's rules, 20 Aug 2026).
//
// Cards: white, 1px #E8EAF0 border, 12px radius, no real shadow. Cards do NOT
// nest — inside one, use space and a hairline divider instead of drawing
// another box. Colour lives in the small icon square and in status, never as
// big saturated blocks. Bold marks hierarchy, not decoration.
import { STAGES } from './stages.js';

export const shortDate = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const fullDate = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const dayTime = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
// "2m ago" for the activity line — a timestamp there is noise.
export const ago = (iso) => {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : shortDate(iso);
};
export const toLocalInput = (iso) => {
  const d = new Date(iso || '');
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const STAGE_META = Object.fromEntries(STAGES.map(([k, label, chip, dot]) => [k, { label, chip, dot }]));

export function StageChip({ stage }) {
  const m = STAGE_META[stage];
  if (!m) return null;
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-medium ${m.chip}`}>{m.label}</span>;
}

export const RECOMMENDATION = {
  strong_yes: ['Strong yes', 'bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)] border-transparent'],
  yes: ['Yes', 'bg-[var(--color-stage-short-bg)] text-[var(--color-stage-short)] border-transparent'],
  unsure: ['Unsure', 'bg-[var(--color-stage-interview-bg)] text-[var(--color-stage-interview)] border-transparent'],
  no: ['No', 'bg-[var(--color-stage-out-bg)] text-[var(--color-stage-out)] border-transparent'],
};

export const scoreTone = (n) =>
  n == null ? 'text-[var(--color-ink-faint)]'
    : n >= 80 ? 'text-[var(--color-stage-hired)]'
      : n >= 60 ? 'text-[var(--color-stage-interview)]'
        : 'text-[var(--color-stage-out)]';
export const scoreWord = (n) =>
  n == null ? '' : n >= 90 ? 'Excellent' : n >= 80 ? 'Very good' : n >= 65 ? 'Good' : n >= 50 ? 'Average' : 'Weak';

export const CARD = 'card';
export const BTN = 'inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[13.5px] font-semibold transition-colors';
export const BTN_LIGHT = `${BTN} bg-[var(--color-surface)] border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-fill)]`;
export const BTN_DARK = `${BTN} bg-[var(--color-ink)] text-white hover:opacity-90`;
export const INPUT = 'w-full rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-[13.5px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-ink-faint)] focus:outline-none';

export function PageHead({ title, count, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="t-page text-[var(--color-ink)]">
        {title}{count != null && <span className="ml-2 text-[18px] font-semibold text-[var(--color-ink-faint)]">{count}</span>}
      </h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// A card heading and its content sit 18–20px apart; the heading never becomes
// its own bordered strip.
export function CardHead({ title, action }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h2 className="t-card text-[var(--color-ink)]">{title}</h2>
      {action}
    </div>
  );
}

// KPI card: icon in a soft tinted square, label, number, and what moved in the
// last 7 days underneath. Same height whatever the content.
export function Kpi({ icon: Icon, label, value, delta, tint = 'var(--color-fill)', ink = 'var(--color-ink-soft)', to, onClick }) {
  const Tag = to ? 'a' : onClick ? 'button' : 'div';
  const props = to ? { href: to } : onClick ? { onClick, type: 'button' } : {};
  return (
    <Tag {...props} className={`card flex min-h-[116px] w-full flex-col justify-between p-5 text-left ${to || onClick ? 'hover:border-[var(--color-ink-faint)]' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="t-label">{label}</span>
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: tint, color: ink }}>
            <Icon size={17} strokeWidth={2} />
          </span>
        )}
      </div>
      <div>
        <div className="t-stat text-[var(--color-ink)]">{value}</div>
        {delta !== undefined && (
          <div className="mt-1 text-[12.5px] text-[var(--color-ink-faint)]">
            {delta > 0 ? <span className="text-[var(--color-good)]">↑ {delta}</span> : delta < 0 ? <span className="text-[var(--color-bad)]">↓ {Math.abs(delta)}</span> : <span>No change</span>}
            <span> from last 7 days</span>
          </div>
        )}
      </div>
    </Tag>
  );
}

// Eight weekly points is enough to say "going up" without pretending to be a
// chart. No axes, no grid, no tooltip — Reports is where analysis happens.
export function Sparkline({ points = [], color = 'var(--color-ink-faint)', width = 92, height = 26 }) {
  if (points.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i * step},${height - (p / max) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polyline points={d} stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Donut with the total in the middle. Segments carry the colour; the legend
// carries the numbers, because a legend nobody can read is decoration.
export function Donut({ slices = [], total = 0, size = 148, thickness = 16 }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const len = total > 0 ? (s.value / total) * c : 0;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle" className="fill-[var(--color-ink)]" style={{ fontSize: 24, fontWeight: 600 }}>{total}</text>
      <text x="50%" y="62%" textAnchor="middle" className="fill-[var(--color-ink-faint)]" style={{ fontSize: 11.5 }}>Total</text>
    </svg>
  );
}
