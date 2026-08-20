import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CARD, PageHead } from './ui.jsx';

// Interviews on a month. Booking happens on the interview itself; this is for
// seeing the week ahead without opening every record.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar() {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  useEffect(() => {
    api('/interviews').then(d => setInterviews(d.interviews || [])).catch(() => setInterviews([])).finally(() => setLoading(false));
  }, []);

  const byDay = useMemo(() => {
    const map = {};
    for (const i of interviews) {
      const d = new Date(i.scheduledAt || '');
      if (isNaN(d)) continue;
      (map[keyOf(d)] = map[keyOf(d)] || []).push(i);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
    return map;
  }, [interviews]);

  // Weeks start Monday. The grid always shows whole weeks so the columns line
  // up with the day names.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const todayKey = keyOf(new Date());
  const monthLabel = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shift = (n) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div>
      <PageHead title="Calendar">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"><ChevronLeft size={16} /></button>
          <span className="px-3 text-sm font-semibold text-gray-900 w-40 text-center">{monthLabel}</span>
          <button onClick={() => shift(1)} className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"><ChevronRight size={16} /></button>
        </div>
      </PageHead>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAYS.map(d => <div key={d} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const k = keyOf(d);
              const list = byDay[k] || [];
              const otherMonth = d.getMonth() !== month.getMonth();
              return (
                <div key={i} className={`min-h-[104px] border-b border-r border-gray-50 p-2 ${otherMonth ? 'bg-gray-50/40' : ''}`}>
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${k === todayKey ? 'bg-gray-900 text-white' : otherMonth ? 'text-gray-300' : 'text-gray-600'}`}>
                    {d.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {list.map(iv => (
                      <Link key={iv.id} to={`/recruitment/interviews/${iv.id}`}
                        className={`block truncate rounded-md px-1.5 py-1 text-[11px] font-medium ${iv.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
                        {new Date(iv.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} {iv.applicantName}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && interviews.length === 0 && (
        <p className="mt-4 text-sm text-gray-400">Nothing booked yet. Book an interview from an applicant's page.</p>
      )}
    </div>
  );
}
