import { useEffect, useMemo, useState } from 'react';
import { Target, Trash2, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, SectionTitle, Button, Field, Input, Select, Pill, Spinner } from '../components/ui.jsx';

// KPI Targets — the ONE place the company's goals are set (Adama 3 Jul:
// "Pulse should be responsible for changing the goals and it reflects in
// admin"). CEO-only. Each change is scheduled with an EFFECTIVE MONTH and
// appended to history — set "Retention 85% from August" today and every
// scorecard here plus admin's Subscriptions/Renewals pages switch to 85% when
// August arrives. Nothing rewrites the past.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymLabel(ym) {
  if (!/^\d{4}-\d{2}/.test(String(ym || ''))) return ym || '—';
  const [y, m] = ym.split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
}
function thisYm() { return new Date().toISOString().slice(0, 7); }
function nextYm() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export default function KpiTargets() {
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(thisYm());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // The change being drafted: { role, kpi, label, unit, target, weight, effectiveFrom }
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  function load(m = month) {
    setLoading(true);
    api(`/kpi-targets?month=${encodeURIComponent(m)}`)
      .then((d) => { setData(d); setErr(''); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduled = useMemo(
    () => (data?.entries || []).filter((e) => e.effectiveFrom >= thisYm()),
    [data],
  );

  function openDraft(roleKey, k) {
    setErr('');
    setDraft({
      role: roleKey, kpi: k.key, label: k.label, unit: k.unit,
      target: k.target == null ? '' : String(k.target),
      weight: String(k.weight),
      effectiveFrom: nextYm(),
    });
  }
  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setErr('');
    try {
      await api('/kpi-targets', { method: 'POST', body: {
        role: draft.role, kpi: draft.kpi,
        target: draft.target === '' ? null : Number(draft.target),
        weight: draft.weight === '' ? null : Number(draft.weight),
        effectiveFrom: draft.effectiveFrom,
      } });
      setDraft(null);
      load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }
  async function removeEntry(id) {
    try { await api(`/kpi-targets/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { setErr(e.message); }
  }

  const kpiName = (role, kpi) => {
    const r = (data?.roles || []).find((x) => x.key === role);
    return r?.kpis.find((k) => k.key === kpi)?.label || kpi;
  };

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner size={28} /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KPI Targets</h1>
          <p className="mt-1 text-sm text-gray-500">
            The company's goals, set here once — every scorecard in Pulse and the goal numbers in Admin follow.
            Changes take effect from the month you pick; history is never rewritten.
          </p>
        </div>
        <Field label="Showing targets for">
          <Input type="month" value={month} min="2026-01" onChange={(e) => setMonth(e.target.value || thisYm())} className="w-44" />
        </Field>
      </div>

      {err && !draft && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      {(data?.roles || []).map((role) => (
        <Card key={role.key} className="p-5">
          <SectionTitle>{role.role}</SectionTitle>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4">KPI</th>
                  <th className="pb-2 pr-4">Target · {ymLabel(data.month)}</th>
                  <th className="pb-2 pr-4">Weight</th>
                  <th className="pb-2 pr-4"></th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {role.kpis.map((k) => (
                  <tr key={k.key}>
                    <td className="py-2.5 pr-4 font-medium text-gray-800">{k.label}</td>
                    <td className="py-2.5 pr-4 text-gray-900 font-semibold">
                      {k.target == null ? <span className="text-gray-400 font-normal">not set</span> : `${k.target}${k.unit === '%' ? '%' : ''}`}
                      {k.unit && k.unit !== '%' && k.target != null && <span className="ml-1 text-xs font-normal text-gray-400">{k.unit}</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600">
                      {k.weight}% {k.weight === 0 && <span className="text-xs text-gray-400">(shown, not scored)</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {k.setFrom && <Pill tone="brand" dot>set from {ymLabel(k.setFrom)}</Pill>}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openDraft(role.key, k)}>Change…</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {/* Scheduled + past changes — the audit trail of goal-setting. */}
      <Card className="p-5">
        <SectionTitle>Scheduled &amp; past changes</SectionTitle>
        {(data?.entries || []).length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No changes yet — every number above is the standing default.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(data.entries).map((e) => {
              const upcoming = e.effectiveFrom >= thisYm();
              return (
                <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-4 py-2.5 text-sm">
                  <CalendarClock size={15} className={upcoming ? 'text-emerald-600' : 'text-gray-400'} />
                  <span className="font-medium text-gray-800">{kpiName(e.role, e.kpi)}</span>
                  <span className="text-gray-600">
                    {e.target != null && <>target → <strong>{e.target}</strong></>}
                    {e.target != null && e.weight != null && ' · '}
                    {e.weight != null && <>weight → <strong>{e.weight}%</strong></>}
                  </span>
                  <Pill tone={upcoming ? 'success' : 'neutral'} dot>{upcoming ? `from ${ymLabel(e.effectiveFrom)}` : `since ${ymLabel(e.effectiveFrom)}`}</Pill>
                  <span className="ml-auto text-xs text-gray-400">by {e.setBy}</span>
                  {upcoming && (
                    <button onClick={() => removeEntry(e.id)} title="Remove this scheduled change" className="text-gray-400 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            {scheduled.length === 0 && <p className="text-xs text-gray-400">Past changes can't be removed — they're the record of what the goals were.</p>}
          </div>
        )}
      </Card>

      {/* Change drawer — schedule one KPI's new number. */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Target size={18} className="text-brand-600 text-emerald-600" />
              <h2 className="text-lg font-bold text-gray-900">Change: {draft.label}</h2>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Target${draft.unit === '%' ? ' (%)' : draft.unit ? ` (${draft.unit})` : ''}`}>
                  <Input type="number" min="0" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
                </Field>
                <Field label="Weight (%)">
                  <Input type="number" min="0" max="100" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} />
                </Field>
              </div>
              <Field label="Takes effect from">
                <Input type="month" min={thisYm()} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} />
              </Field>
              <p className="text-xs text-gray-500">
                From {ymLabel(draft.effectiveFrom)}, scorecards in Pulse and the goal numbers in Admin use this. Months before that keep their numbers.
              </p>
              {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => !saving && setDraft(null)}>Cancel</Button>
                <Button onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Schedule change'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
