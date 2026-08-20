// Shared bits across the Recruitment pages, so a date or a score looks the
// same on every screen in the department.
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
// <input type="datetime-local"> wants local time with no zone on it.
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
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${m.chip}`}>{m.label}</span>;
}

export const RECOMMENDATION = {
  strong_yes: ['Strong yes', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  yes: ['Yes', 'bg-green-50 text-green-700 border-green-200'],
  unsure: ['Unsure', 'bg-amber-50 text-amber-700 border-amber-200'],
  no: ['No', 'bg-rose-50 text-rose-700 border-rose-200'],
};

// One scale everywhere: a score out of 100 reads the same on the interview
// screen, the interview list and the reports.
export const scoreTone = (n) =>
  n == null ? 'text-gray-400' : n >= 80 ? 'text-emerald-600' : n >= 60 ? 'text-amber-600' : 'text-rose-600';
export const scoreWord = (n) =>
  n == null ? '' : n >= 90 ? 'Excellent' : n >= 80 ? 'Very good' : n >= 65 ? 'Good' : n >= 50 ? 'Average' : 'Weak';

export function PageHead({ title, count, children }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
      <h1 className="text-3xl font-bold text-gray-900">
        {title}{count != null && <span className="ml-2 text-lg font-semibold text-gray-400">{count}</span>}
      </h1>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

export const CARD = 'bg-white rounded-2xl border border-gray-100';
export const BTN = 'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium';
export const BTN_LIGHT = `${BTN} bg-white border border-gray-200 text-gray-800 hover:bg-gray-50`;
export const BTN_DARK = `${BTN} bg-gray-900 text-white hover:bg-gray-800`;
