// The Recruitment design system (Adama's rules, 20 Aug 2026).
//
// Cards: white, 1px #E8EAF0 border, 12px radius, no real shadow. Cards do NOT
// nest — inside one, use space and a hairline divider instead of drawing
// another box. Colour lives in the small icon square and in status, never as
// big saturated blocks. Bold marks hierarchy, not decoration.
import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
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
export const BTN_PRIMARY = `${BTN} bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)]`;
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
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="t-card text-[var(--color-ink)]">{title}</h2>
      {action}
    </div>
  );
}

// KPI card: the NUMBER is the card. The label and the change sit under it in
// a lighter weight, and the icon is small and calm — it labels the card, it
// does not compete with the figure. Height is deliberately tight: whitespace
// belongs between cards, not underneath their contents.
export function Kpi({ icon: Icon, label, value, delta, deltaLabel = 'in the last 7 days', tint = 'var(--color-fill)', ink = 'var(--color-ink-soft)', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  const props = onClick ? { onClick, type: 'button' } : {};
  return (
    <Tag {...props} className={`card card-quiet w-full p-4 text-left ${onClick ? 'hover:border-[var(--color-ink-faint)]' : ''}`}>
      <span className="flex items-center gap-2">
        {Icon && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]" style={{ background: tint, color: ink }}>
            <Icon size={13} strokeWidth={2.2} />
          </span>
        )}
        <span className="truncate text-[12.5px] font-medium text-[var(--color-ink-soft)]">{label}</span>
      </span>
      <span className="mt-2 block text-[30px] font-semibold leading-none tracking-[-0.025em] text-[var(--color-ink)]">{value}</span>
      {delta !== undefined && (
        <span className="mt-1.5 block text-[12px] text-[var(--color-ink-faint)]">
          {delta > 0 ? <span className="font-semibold text-[var(--color-good)]">+{delta} </span>
            : delta < 0 ? <span className="font-semibold text-[var(--color-bad)]">−{Math.abs(delta)} </span>
              : <span>No change </span>}
          {deltaLabel}
        </span>
      )}
    </Tag>
  );
}

// Eight weekly points is enough to say "going up" without pretending to be a
// chart: a line, a soft fill under it, and a dot on where things stand now.
// No axes, no grid, no tooltip — Reports is where analysis happens.
export function Sparkline({ points = [], color = 'var(--color-ink-faint)', width = 132, height = 40 }) {
  if (points.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const y = (p) => height - (p / max) * (height - 8) - 4;
  const path = points.map((p, i) => `${i * step},${y(p)}`).join(' ');
  const last = { x: (points.length - 1) * step, y: y(points[points.length - 1]) };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polygon points={`0,${height} ${path} ${width},${height}`} fill={color} opacity="0.08" />
      <polyline points={path} stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.75" fill={color} />
    </svg>
  );
}

// Donut with the total in the middle. Segments carry the colour, the legend
// carries the numbers — a legend nobody can read is decoration. A hairline gap
// keeps two segments from reading as one.
export function Donut({ slices = [], total = 0, size = 150, thickness = 18 }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const len = total > 0 ? Math.max(0, (s.value / total) * c - gap) : 0;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += total > 0 ? (s.value / total) * c : 0;
          return el;
        })}
      </g>
      <text x="50%" y="48%" textAnchor="middle" className="fill-[var(--color-ink)]" style={{ fontSize: 24, fontWeight: 600 }}>{total}</text>
      <text x="50%" y="63%" textAnchor="middle" className="fill-[var(--color-ink-faint)]" style={{ fontSize: 11.5 }}>Total</text>
    </svg>
  );
}

// A window over the numbers: the KPI changes, the pipeline deltas and the
// activity all follow whatever is chosen here.
export const RANGES = [
  ['7d', 'Last 7 days', 7],
  ['30d', 'Last 30 days', 30],
  ['90d', 'Last 90 days', 90],
];
export function RangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const days = RANGES.find(r => r[0] === value)?.[2] || 7;
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 24 * 3600 * 1000);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">
        <Calendar size={15} className="text-[var(--color-ink-faint)]" />
        {fmt(from)} – {fmt(to)}, {to.getFullYear()}
        <ChevronDown size={15} className="text-[var(--color-ink-faint)]" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-48 overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-lift)]">
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" onMouseDown={() => { onChange(k); setOpen(false); }}
              className={`block w-full rounded-[8px] px-3 py-2.5 text-left text-[13px] font-semibold ${value === k ? 'bg-[var(--color-brand-50)] text-[var(--color-brand)]' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One row of a list card: tinted icon, what happened, when. Used by activity
// and by anything else that is a feed, so feeds all look the same.
export function FeedRow({ icon: Icon, tint, ink, title, line, meta, to, as: Tag = 'div', ...rest }) {
  return (
    <Tag {...rest} className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      {Icon && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ background: tint, color: ink }}>
          <Icon size={14} strokeWidth={2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="t-body block truncate font-semibold text-[var(--color-ink)] group-hover:underline">{title}</span>
        {line && <span className="t-support mt-0.5 block truncate">{line}</span>}
      </span>
      {meta && <span className="t-support shrink-0 whitespace-nowrap text-[12px]">{meta}</span>}
    </Tag>
  );
}

// Empty state that keeps a card the same height as its neighbours instead of
// collapsing into a tall white nothing.
export function Empty({ children }) {
  return <p className="py-6 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">{children}</p>;
}
