import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowLeft, UserX } from 'lucide-react';
import { pastStaff } from '../data/team';
import { rosterPrivate } from '../lib/pay';

// Past-staff profile — the company record for someone who has left. Everything
// here is REAL: the exit summary comes from the pastStaff roster, and the
// month-by-month pay is matched out of payrollHistory (the recorded ledger).
// Bulk "not itemised" ledger lines are never attributed to a person, and when
// no itemised pay exists for them we say so rather than invent a figure.

const slugify = (n) => n.toLowerCase().replace(/\s+/g, '-');
const norm = (n) => (n || '').toLowerCase().replace(/\s+/g, '');
const money = (n) => `D${(Number(n) || 0).toLocaleString()}`;

function pastCategory(reason) {
  const r = (reason || '').toLowerCase();
  if (/terminat|let go|dismiss|fired/.test(r)) return { label: 'Terminated', cls: 'bg-red-100 text-red-700' };
  if (/contract end/.test(r)) return { label: 'Contract Ended', cls: 'bg-blue-100 text-blue-700' };
  if (/training|intern|trainee|not confirmed|not converted|probation/.test(r)) return { label: 'Training/Internship', cls: 'bg-orange-100 text-orange-700' };
  if (/left|resign|voluntar/.test(r)) return { label: 'Resigned', cls: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]' };
  return { label: 'Former staff', cls: 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]' };
}

function Field({ label, value, accent }) {
  return (
    <div>
      <p className="text-[11.5px] font-medium text-[var(--color-ink-faint)] mb-1">{label}</p>
      <p className={`text-[13px] font-medium ${accent || 'text-[var(--color-ink)]'}`}>{value ?? <span className="text-[var(--color-ink-faint)] font-normal">—</span>}</p>
    </div>
  );
}

export default function PastStaffProfile() {
  const { slug } = useParams();
  const navigate = useNavigate();
  // Pay + ledger come from the payroll-gated endpoint, never the bundle. A
  // viewer without payroll power gets empty data → pay shows "—".
  const [priv, setPriv] = useState(null);
  useEffect(() => { rosterPrivate().then(setPriv).catch(() => setPriv({ pastStaff: [], payrollHistory: [] })); }, []);
  const person = pastStaff.find((p) => slugify(p.name) === slug);
  const privPerson = (priv?.pastStaff || []).find((p) => slugify(p.name) === slug) || {};

  if (!person) {
    return (
      <div>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[13px] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6"><ArrowLeft size={14} /> Back</button>
        <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-10 text-center text-[var(--color-ink-faint)]">Former employee not found.</div>
      </div>
    );
  }

  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const cat = pastCategory(person.reason);
  const nameKey = norm(person.name);

  // Month-by-month pay matched out of the recorded ledger (itemised lines only).
  const payLines = (priv?.payrollHistory || []).flatMap((m) =>
    (m.people || [])
      .filter((pl) => !pl.unallocated)
      .filter((pl) => {
        const k = norm(pl.name);
        return k && (k === nameKey || nameKey.includes(k) || k.includes(nameKey));
      })
      .map((pl) => ({ month: m.month, amount: pl.amount, note: pl.note }))
  );
  const totalPaid = payLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[13px] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] mb-6"><ArrowLeft size={14} /> Back</button>

      {/* Identity */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 mb-4">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-[var(--color-ink-faint)] to-[var(--color-ink-soft)] flex items-center justify-center text-white text-[18px] font-semibold shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="t-page">{person.name}</h1>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${cat.cls}`}>{cat.label}</span>
            </div>
            <p className="text-[var(--color-ink-soft)]">{person.role}</p>
            <p className="text-[11px] text-[var(--color-ink-faint)] mt-1 flex items-center gap-1.5"><UserX size={12} /> Left {person.date || '—'}</p>
          </div>
        </div>
      </div>

      {/* Exit summary */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 mb-4">
        <h2 className="text-base font-semibold text-[var(--color-ink)] mb-5">Exit record</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          <Field label="Left" value={person.date} />
          <Field label="Monthly pay" value={privPerson.pay > 0 ? money(privPerson.pay) : '—'} />
          <Field label="Final settlement" value={privPerson.finalPay > 0 ? money(privPerson.finalPay) : '—'} />
          <Field label="Total recorded paid" value={payLines.length ? money(totalPaid) : '—'} />
        </div>
        <div className="mt-5">
          <Field label="Reason for leaving" value={person.reason} />
        </div>
      </div>

      {/* Pay history (real ledger lines only) */}
      <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5">
        <h2 className="text-base font-semibold text-[var(--color-ink)] mb-1">Pay history</h2>
        <p className="text-[13px] text-[var(--color-ink-soft)] mb-5">What was actually recorded as paid, month by month.</p>
        {payLines.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-faint)] py-5 text-center">No itemised monthly pay on record for this person. (Their pay may have been recorded only in combined team totals.)</p>
        ) : (
          <div className="divide-y divide-[var(--color-line-soft)]">
            {payLines.map((l, i) => (
              <div key={i} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--color-ink)]">{l.month}</p>
                  {l.note && <p className="text-[11.5px] text-[var(--color-ink-soft)] mt-0.5">{l.note}</p>}
                </div>
                <p className={`text-[13px] font-semibold shrink-0 ${l.amount > 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'}`}>{money(l.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
