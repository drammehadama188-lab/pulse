import { useState } from 'react';
import { Calendar, ChevronDown, Download } from 'lucide-react';

const defaultPeriods = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
];

export default function TimePeriodSelector({ selected, onChange, showExport = true, exportFormats = ['PDF', 'CSV', 'EXCEL'], periods }) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const timePeriods = periods || defaultPeriods;
  const label = timePeriods.find((p) => p.value === selected)?.label || (selected === 'custom' ? 'Custom Range' : 'Select period');

  return (
    <div className="flex items-center gap-3">
      {/* Period Dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-3 px-4 py-2.5 bg-white border border-[var(--color-line)] rounded-xl text-sm text-[var(--color-ink)] hover:border-[var(--color-ink-faint)] transition-colors min-w-[180px]"
        >
          <Calendar size={16} className="text-[var(--color-ink-faint)]" />
          <span className="flex-1 text-left">{label}</span>
          <ChevronDown size={16} className={`text-[var(--color-ink-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-full right-0 mt-1 bg-white border border-[var(--color-line)] rounded-xl shadow-lg z-30 w-72">
            {timePeriods.map((period) => (
              <button
                key={period.value}
                onClick={() => { onChange(period.value); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--color-fill)] transition-colors ${selected === period.value ? 'bg-blue-50 text-blue-600' : 'text-[var(--color-ink-soft)]'}`}
              >
                <Calendar size={14} className="text-[var(--color-ink-faint)]" />
                {period.label}
              </button>
            ))}
            <div className="border-t border-[var(--color-line)] p-4">
              <p className="text-sm font-medium text-[var(--color-ink-soft)] mb-3">Custom Range</p>
              <div className="space-y-2">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-line)] rounded-lg text-sm" />
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-line)] rounded-lg text-sm" />
                <button onClick={() => { onChange('custom', { from: customFrom, to: customTo }); setOpen(false); }}
                  disabled={!customFrom || !customTo}
                  className="w-full py-2.5 bg-[var(--color-ink)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-ink)] disabled:bg-[var(--color-ink-faint)] disabled:cursor-not-allowed">
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Export */}
      {showExport && (
        <div className="flex items-center gap-1 border border-[var(--color-line)] rounded-xl overflow-hidden">
          {exportFormats.map((fmt) => (
            <button key={fmt}
              className="px-3 py-2 text-xs font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)] transition-colors border-r border-[var(--color-line)] last:border-0 flex items-center gap-1">
              <Download size={12} /> {fmt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
