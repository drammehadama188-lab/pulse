import { useEffect, useMemo, useState } from 'react';
import { Target, Trash2, CalendarClock, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, SectionTitle, Button, Field, Input, Select, Pill, Spinner } from '../components/ui.jsx';
import { PageSkeleton } from '../components/ui/Skeleton.jsx';

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

  // Add a custom KPI (Adama 3 Jul: "I should be able to add a KPI if I want
  // and it recalculates the weight") — the new KPI takes the weight given and
  // the catalog KPIs rebalance proportionally so the total stays 100.
  const [addFor, setAddFor] = useState(null); // { role, roleLabel, label, kind, target, weight, effectiveFrom }
  const [confirmRemove, setConfirmRemove] = useState(null); // customId pending confirm
  function openAdd(role, roleLabel) {
    setErr('');
    setAddFor({ role, roleLabel, label: '', kind: 'percent', target: '', weight: '10', effectiveFrom: nextYm() });
  }
  async function saveAdd() {
    if (!addFor) return;
    setSaving(true);
    setErr('');
    try {
      await api('/kpi-custom', { method: 'POST', body: {
        role: addFor.role, label: addFor.label, kind: addFor.kind,
        target: addFor.target === '' ? null : Number(addFor.target),
        weight: addFor.weight === '' ? null : Number(addFor.weight),
        effectiveFrom: addFor.effectiveFrom,
      } });
      setAddFor(null);
      load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }
  async function removeCustom(id) {
    try { await api(`/kpi-custom/${id}`, { method: 'DELETE' }); setConfirmRemove(null); load(); }
    catch (e) { setErr(e.message); }
  }

  const kpiName = (role, kpi) => {
    const r = (data?.roles || []).find((x) => x.key === role);
    return r?.kpis.find((k) => k.key === kpi)?.label || kpi;
  };

  if (loading && !data) return <PageSkeleton tiles={0} rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-page">KPI Targets</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
            The company's goals, set here once — every scorecard in Pulse and the goal numbers in Admin follow.
            Changes take effect from the month you pick; history is never rewritten.
          </p>
        </div>
        <Field label="Showing targets for">
          <Input type="month" value={month} min="2026-01" onChange={(e) => setMonth(e.target.value || thisYm())} className="w-44" />
        </Field>
      </div>

      {err && !draft && <div className="rounded-lg bg-[var(--color-bad-bg)] px-4 py-3 text-[13px] text-[var(--color-bad)]">{err}</div>}

      {(data?.roles || []).map((role) => (
        <Card key={role.key} className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle>{role.role}</SectionTitle>
            <Button variant="ghost" size="sm" onClick={() => openAdd(role.key, role.role)}>
              <Plus size={15} className="mr-1" /> Add KPI
            </Button>
          </div>
          {/* The Weight column is GONE from this page (Adama 26 Aug: "remove
              weight that confuses me from all of them"). Weights still exist
              server-side and still score — the page just stops asking the CEO
              to think in percentages. Parked KPIs keep a plain "not scored
              yet" tag so the one distinction that matters survives. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-[var(--color-ink-faint)]">
                  <th className="pb-2 pr-4">KPI</th>
                  <th className="pb-2 pr-4">Target · {ymLabel(data.month)}</th>
                  <th className="pb-2 pr-4"></th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line-soft)]">
                {role.kpis.map((k) => (
                  <tr key={k.key}>
                    <td className="py-2.5 pr-4 font-medium text-[var(--color-ink)]">{k.label}</td>
                    <td className="py-2.5 pr-4 text-[var(--color-ink)] font-semibold">
                      {k.target == null ? <span className="text-[var(--color-ink-faint)] font-normal">not set</span> : `${k.target}${k.unit === '%' ? '%' : ''}`}
                      {k.unit && k.unit !== '%' && k.target != null && <span className="ml-1 text-[11.5px] font-normal text-[var(--color-ink-faint)]">{k.unit}</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center gap-2">
                        {k.weight === 0 && <Pill tone="neutral" dot>not scored yet</Pill>}
                        {k.custom && <Pill tone="warn" dot>custom</Pill>}
                        {k.setFrom && <Pill tone="brand" dot>set from {ymLabel(k.setFrom)}</Pill>}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openDraft(role.key, k)}>Change…</Button>
                        {k.custom && (confirmRemove === k.customId ? (
                          <span className="inline-flex items-center gap-1">
                            <button onClick={() => removeCustom(k.customId)} className="rounded bg-[var(--color-bad)] px-2 py-1 text-[11.5px] font-semibold text-white">Remove?</button>
                            <button onClick={() => setConfirmRemove(null)} className="rounded border border-[var(--color-line)] px-2 py-1 text-[11.5px] text-[var(--color-ink-soft)]">Keep</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmRemove(k.customId)} title="Remove this custom KPI" className="p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">
                            <Trash2 size={15} />
                          </button>
                        ))}
                      </span>
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
          <p className="mt-3 text-[13px] text-[var(--color-ink-soft)]">No changes yet — every number above is the standing default.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {(data.entries).map((e) => {
              const upcoming = e.effectiveFrom >= thisYm();
              return (
                <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-fill)] px-4 py-2.5 text-[13px]">
                  <CalendarClock size={15} className={upcoming ? 'text-[var(--color-good)]' : 'text-[var(--color-ink-faint)]'} />
                  <span className="font-medium text-[var(--color-ink)]">{kpiName(e.role, e.kpi)}</span>
                  <span className="text-[var(--color-ink-soft)]">
                    {e.target != null && <>target → <strong>{e.target}</strong></>}
                  </span>
                  <Pill tone={upcoming ? 'good' : 'neutral'} dot>{upcoming ? `from ${ymLabel(e.effectiveFrom)}` : `since ${ymLabel(e.effectiveFrom)}`}</Pill>
                  <span className="ml-auto text-[11.5px] text-[var(--color-ink-faint)]">by {e.setBy}</span>
                  {upcoming && (
                    <button onClick={() => removeEntry(e.id)} title="Remove this scheduled change" className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
            {scheduled.length === 0 && <p className="text-[11.5px] text-[var(--color-ink-faint)]">Past changes can't be removed — they're the record of what the goals were.</p>}
          </div>
        )}
      </Card>

      {/* Add-KPI dialog — a new KPI for the role; weights rebalance around it. */}
      {addFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && setAddFor(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-[var(--shadow-lift)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Plus size={18} className="text-[var(--color-good)]" />
              <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Add a KPI · {addFor.roleLabel}</h2>
            </div>
            <div className="space-y-4">
              <Field label="What is measured">
                <Input value={addFor.label} placeholder="e.g. Customer visits" onChange={(e) => setAddFor({ ...addFor, label: e.target.value })} />
              </Field>
              {/* Weight input removed with the column (Adama 26 Aug) — a new
                  KPI takes the default share and the others rebalance; the
                  CEO never has to think in percentages. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <Select value={addFor.kind} onChange={(e) => setAddFor({ ...addFor, kind: e.target.value })}>
                    <option value="percent">Percent</option>
                    <option value="count">Count</option>
                  </Select>
                </Field>
                <Field label={addFor.kind === 'percent' ? 'Target (%)' : 'Target (count)'}>
                  <Input type="number" min="0" value={addFor.target} onChange={(e) => setAddFor({ ...addFor, target: e.target.value })} />
                </Field>
              </div>
              <Field label="Takes effect from">
                <Input type="month" min={thisYm()} value={addFor.effectiveFrom} onChange={(e) => setAddFor({ ...addFor, effectiveFrom: e.target.value })} />
              </Field>
              <p className="text-[11.5px] text-[var(--color-ink-soft)]">
                It shows on scorecards as unmeasured until a data feed exists — nothing is ever faked.
              </p>
              {err && <div className="rounded-lg bg-[var(--color-bad-bg)] px-3 py-2 text-[13px] text-[var(--color-bad)]">{err}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => !saving && setAddFor(null)}>Cancel</Button>
                <Button onClick={saveAdd} disabled={saving || !addFor.label.trim()}>{saving ? 'Adding…' : 'Add KPI'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Change drawer — schedule one KPI's new number. */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-[var(--shadow-lift)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Target size={18} className="text-brand-600 text-[var(--color-good)]" />
              <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Change: {draft.label}</h2>
            </div>
            <div className="space-y-4">
              {/* Weight input removed with the column (Adama 26 Aug). The
                  draft still CARRIES the current weight and saveDraft still
                  sends it: an entry with weight null would fall back to the
                  catalog weight and silently undo any earlier reweight. */}
              <Field label={`Target${draft.unit === '%' ? ' (%)' : draft.unit ? ` (${draft.unit})` : ''}`}>
                <Input type="number" min="0" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
              </Field>
              <Field label="Takes effect from">
                <Input type="month" min={thisYm()} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} />
              </Field>
              <p className="text-[11.5px] text-[var(--color-ink-soft)]">
                From {ymLabel(draft.effectiveFrom)}, scorecards in Pulse and the goal numbers in Admin use this. Months before that keep their numbers.
              </p>
              {err && <div className="rounded-lg bg-[var(--color-bad-bg)] px-3 py-2 text-[13px] text-[var(--color-bad)]">{err}</div>}
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
