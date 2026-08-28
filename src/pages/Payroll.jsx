import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ChevronDown, DollarSign, AlertTriangle,
  Edit2, Trash2, Plus, Wallet, Users2, Search,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { rosterPay, rosterPrivate } from '../lib/pay.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageSkeleton, TableSkeleton } from '../components/ui/Skeleton.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

// PAYROLL — its own page (28 Aug 2026, Adama's mockup). It used to be a tab
// inside the 1,554-line HR & Team page, with Run / History / Team Salaries kept
// in sessionStorage, so a payroll month could not be linked to or returned to.
//
// 🔒 PAY NEVER SHIPS IN THE BUNDLE. Every figure on this page comes from a
// permission-gated endpoint at runtime — /payroll/run and /payroll/history
// (owner), /payroll/people and /roster/private (payroll power). NEVER import
// lib/roster-pay.js from anywhere under src/ (the 15 Jul 2026 leak, where every
// salary was readable in the public JS). test/no-pay-in-bundle.test.mjs guards
// this.
//
// 🔒 THE MONTH AND THE TAB LIVE IN THE URL, not in state — Back restores the
// URL (24 Aug), and a month you are looking at should survive a reload and be
// sendable to someone else.

const D = (n) => `D${Number(n || 0).toLocaleString()}`;
const monthName = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return '';
  // 🔒 Built from the parts, never `new Date(ym)` — that parses as UTC midnight
  // and renders in the VIEWER's zone, so August reads as July west of Greenwich
  // (the 27 Aug clock rule).
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const nowMonth = () => new Date().toISOString().slice(0, 7);

const TABS = [['overview', 'Overview'], ['runs', 'Payroll runs'], ['team', 'Team pay']];

export default function Payroll() {
  const { user } = useAuth();
  // Running payroll writes to Zoho Books and is owner-only server-side
  // (requireOwner on /payroll/run and /payroll/pay). A payroll manager gets the
  // two read tabs — showing them a Confirm run button that 403s would be a lie.
  const canRun = user?.username === 'adama';
  const [params, setParams] = useSearchParams();

  const tabParam = params.get('tab');
  const allowed = canRun ? TABS : TABS.filter(([k]) => k !== 'overview');
  const tab = allowed.some(([k]) => k === tabParam) ? tabParam : allowed[0][0];
  const period = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : nowMonth();
  const running = canRun && params.get('run') === '1';

  const setUrl = (patch) => setParams((prev) => {
    const q = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v == null) q.delete(k); else q.set(k, v); }
    return q;
  }, { replace: true });

  // ---------------------------------------------------------------- data
  // Standing compensation (Team pay) — what each person is SET to receive.
  const [people, setPeople] = useState(null);
  const [priv, setPriv] = useState(null);
  useEffect(() => {
    rosterPay().then(setPeople).catch(() => setPeople([]));
    rosterPrivate().then(setPriv).catch(() => setPriv(null));
  }, []);

  // This month's run — what is actually being paid.
  const [payRun, setPayRun] = useState(null);   // { period, people[], paySources[] }
  const [payDraft, setPayDraft] = useState({}); // name -> { salary, bonus, source, note }
  const [runError, setRunError] = useState(null);

  function loadPayRun(p = period) {
    if (!canRun) return;
    api(`/payroll/run?period=${p}`)
      .then((d) => {
        setPayRun(d);
        setRunError(null);
        // MERGE with what has already been typed — marking one person paid must
        // not reset everyone else's numbers back to the defaults.
        setPayDraft((prev) => {
          const draft = {};
          (d.people || []).forEach((x) => {
            draft[x.name] = prev[x.name] || {
              salary: x.suggestedSalary, bonus: x.suggestedBonus,
              source: d.paySources?.[0]?.key || 'access_bank',
            };
          });
          return draft;
        });
      })
      .catch((e) => { setPayRun(null); setRunError(e.message || 'Could not load the run'); });
  }

  useEffect(() => { setPayRun(null); setPayDraft({}); loadPayRun(period); }, [period, canRun]);

  // Payroll runs — live from Zoho Books, which is the truth for money.
  const [hist, setHist] = useState(null);
  const [histError, setHistError] = useState(null);
  useEffect(() => {
    if (tab !== 'runs' || hist) return;
    api('/payroll/history')
      .then((d) => setHist(d.months || []))
      .catch((e) => { setHistError(e.message || 'Could not reach Zoho Books'); setHist(priv?.payrollHistory || []); });
  }, [tab, hist, priv]);

  // ---------------------------------------------------------------- money
  // 🔒 ONE SOURCE for the month. Every figure on Overview and on the run screen
  // reads the SAME rows, so a tile can never disagree with the table under it.
  const rows = payRun?.people || [];
  const draftOf = (p) => payDraft[p.name] || { salary: p.suggestedSalary, bonus: p.suggestedBonus, source: 'access_bank' };
  const baseOf = (p) => (p.paid ? Number(p.paid.salary) || 0 : Number(draftOf(p).salary) || 0);
  const varOf = (p) => (p.paid ? Number(p.paid.bonus) || 0 : Number(draftOf(p).bonus) || 0);

  const month = useMemo(() => {
    const paid = rows.filter((p) => p.paid);
    return {
      employees: rows.length,
      base: rows.reduce((s, p) => s + baseOf(p), 0),
      variable: rows.reduce((s, p) => s + varOf(p), 0),
      total: rows.reduce((s, p) => s + baseOf(p) + varOf(p), 0),
      paidCount: paid.length,
      paidTotal: paid.reduce((s, p) => s + (Number(p.paid.total) || 0), 0),
      lastPaidOn: paid.map((p) => p.paid.date).filter(Boolean).sort().slice(-1)[0] || null,
    };
  }, [rows, payDraft]);

  const state = month.employees === 0 ? 'empty'
    : month.paidCount === 0 ? 'not-started'
      : month.paidCount < month.employees ? 'in-progress' : 'complete';

  // ---------------------------------------------------------------- writing
  const todayISO = new Date().toISOString().slice(0, 10);
  const eomOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const defaultPayDate = (ym) => { const eom = eomOf(ym); return eom < todayISO ? eom : todayISO; };
  const [payDate, setPayDate] = useState(() => defaultPayDate(period));
  useEffect(() => { setPayDate(defaultPayDate(period)); }, [period]);

  const [payConfirm, setPayConfirm] = useState(null);
  const [payPosting, setPayPosting] = useState(false);
  const [payEdit, setPayEdit] = useState(null);
  const [payUndo, setPayUndo] = useState(null);
  const [oneOff, setOneOff] = useState(null);
  const [bulk, setBulk] = useState(null);

  // Salaries are paid at the end of the month; the run cannot run into a month
  // that has not happened.
  const shiftMonth = (delta) => {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (next <= nowMonth()) setUrl({ month: next });
  };
  const isCurrentMonth = period >= nowMonth();

  // Open the confirm modal for one person: a dry run first, so the exact Books
  // payload is on screen before anything posts.
  async function startPay(person) {
    const d = draftOf(person);
    setPayConfirm({ person, loading: true, salary: d.salary, bonus: d.bonus, source: d.source, date: payDate, label: (d.note || '').trim() });
    try {
      const preview = await api('/payroll/pay?dryRun=1', { method: 'POST', body: { name: person.name, salary: Number(d.salary) || 0, bonus: Number(d.bonus) || 0, paySourceKey: d.source, date: payDate, period } });
      const dup = preview?.ok === false && preview?.reason === 'duplicate' ? { duplicate: preview.duplicate, message: preview.message } : {};
      setPayConfirm((c) => c && { ...c, loading: false, preview, ...dup });
    } catch (e) {
      setPayConfirm((c) => c && { ...c, loading: false, error: e.message });
    }
  }

  async function confirmPay(force = false) {
    if (!payConfirm) return;
    const { person, salary, bonus, source, date, label } = payConfirm;
    setPayPosting(true);
    try {
      const res = await api('/payroll/pay', { method: 'POST', body: { name: person.name, salary: Number(salary) || 0, bonus: Number(bonus) || 0, paySourceKey: source, date, period, label: label || '', force } });
      if (res.ok === false && res.reason === 'duplicate') setPayConfirm((c) => c && { ...c, duplicate: res.duplicate, message: res.message });
      else { setPayConfirm(null); loadPayRun(); setHist(null); }
    } catch (e) {
      setPayConfirm((c) => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  // CONFIRM RUN — every unpaid row, the numbers as they stand, one confirmation.
  // Anyone already paid in Books is skipped and reported, never paid twice.
  function openBulk() {
    const unpaid = rows.filter((p) => !p.paid);
    if (!unpaid.length) return;
    setBulk({ people: unpaid, busy: false, done: false, results: null });
  }
  async function runBulk() {
    setBulk((c) => ({ ...c, busy: true }));
    const results = [];
    for (const p of bulk.people) {
      const d = draftOf(p);
      try {
        const res = await api('/payroll/pay', { method: 'POST', body: { name: p.name, salary: Number(d.salary) || 0, bonus: Number(d.bonus) || 0, paySourceKey: d.source, date: payDate, period, label: (d.note || '').trim() } });
        if (res.ok === false) results.push({ name: p.name, status: res.reason === 'duplicate' ? 'skipped — already paid in Books' : (res.message || 'failed') });
        else results.push({ name: p.name, status: `paid ${D(res.record?.total ?? ((Number(d.salary) || 0) + (Number(d.bonus) || 0)))}` });
      } catch (e) {
        results.push({ name: p.name, status: e.message || 'failed' });
      }
    }
    setBulk((c) => ({ ...c, busy: false, done: true, results }));
    loadPayRun(); setHist(null);
  }

  function openOneOff() {
    setOneOff({
      name: rows[0]?.name || '', label: '', amount: '',
      period, date: payDate,
      source: payRun?.paySources?.[0]?.key || 'access_bank',
      busy: false, error: '',
    });
  }
  async function submitOneOff() {
    const o = oneOff;
    if (!o.name) return setOneOff((c) => ({ ...c, error: 'Pick a person' }));
    if (!o.label.trim()) return setOneOff((c) => ({ ...c, error: 'Say what this payment is (e.g. Training pay)' }));
    if (!(Number(o.amount) > 0)) return setOneOff((c) => ({ ...c, error: 'Enter an amount' }));
    setOneOff((c) => ({ ...c, busy: true, error: '' }));
    try {
      const res = await api('/payroll/pay', { method: 'POST', body: { name: o.name, salary: Number(o.amount), bonus: 0, paySourceKey: o.source, date: o.date, period: o.period, label: o.label.trim() } });
      if (res.ok === false && res.reason === 'duplicate') {
        setOneOff((c) => ({ ...c, busy: false, error: `${o.name} already has a payment for ${o.period} (${res.message}). One payment per person per month — edit that payment in the run instead, or pick a different month.` }));
        return;
      }
      if (res.ok === false) { setOneOff((c) => ({ ...c, busy: false, error: res.message || 'Could not record' })); return; }
      setOneOff(null);
      if (o.period === period) loadPayRun();
      setHist(null);
    } catch (e) {
      setOneOff((c) => ({ ...c, busy: false, error: e.message }));
    }
  }

  async function adoptExisting() {
    if (!payConfirm) return;
    setPayPosting(true);
    try {
      const res = await api('/payroll/adopt', { method: 'POST', body: { name: payConfirm.person.name, period } });
      setPayConfirm(null); loadPayRun(); setHist(null);
      const rec = res.record;
      setPayEdit({ rec, salary: rec.salary, bonus: rec.bonus, source: rec.paySourceKey || payRun?.paySources?.[0]?.key || 'access_bank', date: rec.date });
    } catch (e) {
      setPayConfirm((c) => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  async function saveEdit() {
    if (!payEdit) return;
    setPayPosting(true);
    try {
      await api(`/payroll/pay/${payEdit.rec.id}`, { method: 'PUT', body: { salary: Number(payEdit.salary) || 0, bonus: Number(payEdit.bonus) || 0, paySourceKey: payEdit.source, date: payEdit.date, label: payEdit.label || '' } });
      setPayEdit(null); loadPayRun(); setHist(null);
    } catch (e) {
      setPayEdit((c) => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  async function confirmUndo() {
    if (!payUndo) return;
    setPayPosting(true);
    try {
      await api(`/payroll/pay/${payUndo.rec.id}`, { method: 'DELETE' });
      setPayUndo(null); loadPayRun(); setHist(null);
    } catch (e) {
      setPayUndo((c) => c && { ...c, error: e.message });
    } finally { setPayPosting(false); }
  }

  // ---------------------------------------------------------------- render
  const btn = 'inline-flex items-center gap-2 transition-colors';
  const light = `${btn} btn-secondary hover:bg-[var(--color-soft)]`;
  const primary = `${btn} btn-primary hover:bg-[var(--color-brand-600)]`;

  if (canRun && !payRun && !runError) return <PageSkeleton tiles={3} rows={8} />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page">Payroll</h1>
          <p className="t-support mt-2">Run salaries, commission and keep a clean payment record.</p>
        </div>
        {canRun && !running && (
          <div className="flex flex-wrap items-center gap-2">
            <MonthStepper period={period} onShift={shiftMonth} atLatest={isCurrentMonth} onPick={(m) => setUrl({ month: m })} />
            <button onClick={() => setUrl({ tab: 'overview', run: '1' })} className={primary}>
              <Wallet size={15} /> Run payroll
            </button>
          </div>
        )}
      </div>

      <div className="mb-6 flex items-center gap-1 border-b border-[var(--color-line)]">
        {allowed.map(([k, label]) => (
          <button key={k} onClick={() => setUrl({ tab: k, run: null })}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && canRun && (
        runError ? (
          <div className="card p-6">
            <EmptyState icon={AlertTriangle} title="This month's run could not load"
              line={runError}
              action={<button onClick={() => loadPayRun()} className={light}>Try again</button>} />
          </div>
        ) : running ? (
          <RunScreen
            period={period} month={month} rows={rows} draftOf={draftOf}
            setDraft={(name, patch) => setPayDraft((s) => ({ ...s, [name]: { ...s[name], ...patch } }))}
            paySources={payRun?.paySources || []}
            payDate={payDate} setPayDate={setPayDate}
            onMarkPaid={startPay} onEdit={(rec) => setPayEdit({ rec, salary: rec.salary, bonus: rec.bonus, source: rec.paySourceKey || payRun?.paySources?.[0]?.key || 'access_bank', date: rec.date, label: rec.label || '' })}
            onUndo={(rec) => setPayUndo({ rec })}
            onOneOff={openOneOff} onConfirmRun={openBulk}
            onBack={() => setUrl({ run: null })}
            isCurrentMonth={isCurrentMonth}
          />
        ) : (
          <Overview
            period={period} month={month} state={state} people={people}
            onStart={() => setUrl({ run: '1' })}
            onManageSalaries={() => setUrl({ tab: 'team' })}
          />
        )
      )}

      {tab === 'runs' && <Runs hist={hist} error={histError} canSeeDetail={canRun} />}

      {tab === 'team' && <TeamPay people={people} priv={priv} />}

      {/* ------------------------------------------------------------ modals */}
      {payConfirm && (
        <Modal onClose={() => !payPosting && setPayConfirm(null)}>
          <h3 className="t-card mb-1">Record payment in Zoho Books</h3>
          <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">{payConfirm.person.name} — {monthName(period)}</p>
          {payConfirm.loading ? (
            <p className="text-[13px] text-[var(--color-ink-soft)] py-5 text-center">Checking Zoho…</p>
          ) : payConfirm.error ? (
            <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-3">{payConfirm.error}</div>
          ) : payConfirm.preview && payConfirm.preview.ok === false ? (
            <div className="text-[13px] text-[var(--color-warn)] bg-[var(--color-warn-bg)] rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{payConfirm.preview.message || 'Already recorded.'}</span>
            </div>
          ) : payConfirm.preview ? (
            <div className="space-y-2 text-[13px]">
              <KV k="Base salary" v={D(payConfirm.salary)} />
              <KV k="Variable pay" v={D(payConfirm.bonus)} />
              <div className="flex justify-between border-t border-[var(--color-line-soft)] pt-2"><span className="font-semibold text-[var(--color-ink)]">Total to Books</span><span className="font-semibold">{D(payConfirm.preview.total)}</span></div>
              <KV k="Paid via" v={payConfirm.preview.paySource?.label} />
              <KV k="Date" v={payConfirm.date} />
              {payConfirm.label && <KV k="Note" v={payConfirm.label} />}
              <KV k="Account" v="Salaries and Employee Wages" />
              <KV k="Vendor" v={`${payConfirm.preview.vendor?.name || ''}${payConfirm.preview.createdVendor ? ' (new)' : ''}`} />
              {payConfirm.preview.fuzzyVendor && <p className="text-[12px] text-[var(--color-warn)] flex items-center gap-1"><AlertTriangle size={12} /> Matched by name — confirm this is the right person.</p>}
              {payConfirm.preview.vendor && String(payConfirm.preview.vendor.id).startsWith('(') && <p className="text-[12px] text-[var(--color-brand)]">A new vendor “{payConfirm.preview.vendor.name}” will be created in Zoho.</p>}
              {payConfirm.duplicate && <p className="text-[12px] text-[var(--color-warn)] flex items-center gap-1"><AlertTriangle size={12} /> {payConfirm.message}</p>}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setPayConfirm(null)} disabled={payPosting} className={light}>Cancel</button>
            {payConfirm.preview && payConfirm.preview.ok !== false && !payConfirm.duplicate && (
              <button onClick={() => confirmPay(false)} disabled={payPosting} className={`${primary} disabled:opacity-60`}>{payPosting ? 'Recording…' : 'Confirm & record'}</button>
            )}
            {payConfirm.duplicate && (
              <button onClick={adoptExisting} disabled={payPosting} className={`${primary} disabled:opacity-60`}>{payPosting ? 'Linking…' : 'Use this payment — edit it'}</button>
            )}
            {payConfirm.duplicate && (
              <button onClick={() => confirmPay(true)} disabled={payPosting} className={`${btn} h-[42px] rounded-lg bg-[var(--color-warn)] px-[18px] text-[13px] font-medium text-white disabled:opacity-60`}>{payPosting ? 'Recording…' : 'Pay again anyway'}</button>
            )}
          </div>
        </Modal>
      )}

      {oneOff && (
        <Modal onClose={() => !oneOff.busy && setOneOff(null)}>
          <h3 className="t-card mb-1">Record a payment</h3>
          <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">A one-off — training pay, an allowance, an advance. Posts to Zoho Books and shows on their payslip under the month you pick.</p>
          <div className="space-y-3 text-[13px]">
            <Field label="Person">
              <select value={oneOff.name} onChange={(e) => setOneOff((c) => ({ ...c, name: e.target.value }))} className="field w-56">
                {rows.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="What is it">
              <input value={oneOff.label} onChange={(e) => setOneOff((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay, Transport allowance" className="field w-56" />
            </Field>
            <Field label="Amount (D)">
              <input type="number" value={oneOff.amount} onChange={(e) => setOneOff((c) => ({ ...c, amount: e.target.value }))} className="field w-32 text-right" />
            </Field>
            <Field label="Counts to month">
              <input type="month" value={oneOff.period} onChange={(e) => e.target.value && setOneOff((c) => ({ ...c, period: e.target.value, date: defaultPayDate(e.target.value) }))} className="field w-40" />
            </Field>
            <Field label="Paid on">
              <input type="date" value={oneOff.date} onChange={(e) => e.target.value && setOneOff((c) => ({ ...c, date: e.target.value }))} className="field w-40" />
            </Field>
            <Field label="Paid via">
              <select value={oneOff.source} onChange={(e) => setOneOff((c) => ({ ...c, source: e.target.value }))} className="field w-40">
                {(payRun?.paySources || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
          </div>
          {oneOff.error && <p className="text-[13px] text-[var(--color-bad)] mt-3">{oneOff.error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setOneOff(null)} disabled={oneOff.busy} className={light}>Cancel</button>
            <button onClick={submitOneOff} disabled={oneOff.busy} className={`${primary} disabled:opacity-60`}>{oneOff.busy ? 'Recording…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {bulk && (
        <Modal onClose={() => !bulk.busy && setBulk(null)}>
          <h3 className="t-card mb-1">{bulk.done ? 'Payroll run — done' : `Confirm run — ${monthName(period)}`}</h3>
          {!bulk.done ? (
            <>
              <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">{bulk.people.length} {bulk.people.length === 1 ? 'payment posts' : 'payments post'} to Zoho Books with the numbers as they stand, dated {payDate}. Anyone already paid in Books is skipped.</p>
              <div className="space-y-1.5 text-[13px] max-h-56 overflow-y-auto">
                {bulk.people.map((p) => {
                  const d = draftOf(p);
                  return <div key={p.name} className="flex justify-between"><span className="text-[var(--color-ink-soft)]">{p.name}</span><span className="font-medium tabular-nums">{D((Number(d.salary) || 0) + (Number(d.bonus) || 0))}</span></div>;
                })}
                <div className="flex justify-between border-t border-[var(--color-line-soft)] pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{D(bulk.people.reduce((s, p) => { const d = draftOf(p); return s + (Number(d.salary) || 0) + (Number(d.bonus) || 0); }, 0))}</span></div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setBulk(null)} disabled={bulk.busy} className={light}>Cancel</button>
                <button onClick={runBulk} disabled={bulk.busy} className={`${primary} disabled:opacity-60`}>{bulk.busy ? 'Recording…' : 'Confirm run'}</button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5 text-[13px] mt-3 max-h-56 overflow-y-auto">
                {(bulk.results || []).map((r) => (
                  <div key={r.name} className="flex justify-between gap-3">
                    <span className="text-[var(--color-ink-soft)]">{r.name}</span>
                    <span className={`text-right ${r.status.startsWith('paid') ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'}`}>{r.status}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-5">
                <button onClick={() => setBulk(null)} className={primary}>Done</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {payEdit && (
        <Modal onClose={() => !payPosting && setPayEdit(null)}>
          <h3 className="t-card mb-1">Edit payment — {payEdit.rec.name}</h3>
          <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">Updates the record in Zoho Books.</p>
          <div className="space-y-3 text-[13px]">
            <Field label="Label (optional)">
              <input value={payEdit.label || ''} onChange={(e) => setPayEdit((c) => ({ ...c, label: e.target.value }))} placeholder="e.g. Training pay" className="field w-56" />
            </Field>
            <Field label="Base salary">
              <input type="number" value={payEdit.salary} onChange={(e) => setPayEdit((c) => ({ ...c, salary: e.target.value }))} className="field w-32 text-right" />
            </Field>
            <Field label="Variable pay">
              <input type="number" value={payEdit.bonus} onChange={(e) => setPayEdit((c) => ({ ...c, bonus: e.target.value }))} className="field w-32 text-right" />
            </Field>
            <div className="flex items-center justify-between border-t border-[var(--color-line-soft)] pt-2">
              <span className="font-semibold text-[var(--color-ink)]">New total</span>
              <span className="font-semibold">{D((Number(payEdit.salary) || 0) + (Number(payEdit.bonus) || 0))}</span>
            </div>
            <Field label="Paid via">
              <select value={payEdit.source} onChange={(e) => setPayEdit((c) => ({ ...c, source: e.target.value }))} className="field w-40">
                {(payRun?.paySources || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={payEdit.date} onChange={(e) => setPayEdit((c) => ({ ...c, date: e.target.value }))} className="field w-40" />
            </Field>
            {payEdit.error && <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-2">{payEdit.error}</div>}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setPayEdit(null)} disabled={payPosting} className={light}>Cancel</button>
            <button onClick={saveEdit} disabled={payPosting} className={`${primary} disabled:opacity-60`}>{payPosting ? 'Saving…' : 'Save changes'}</button>
          </div>
        </Modal>
      )}

      {payUndo && (
        <Modal onClose={() => !payPosting && setPayUndo(null)} narrow>
          <h3 className="t-card mb-1">Undo payment?</h3>
          <p className="text-[13px] text-[var(--color-ink-soft)] mb-4">
            This deletes {payUndo.rec.name}’s {D(payUndo.rec.total)} payment ({payUndo.rec.paySource}, {payUndo.rec.date}) from Zoho Books. {payUndo.rec.name} will show as unpaid again.
          </p>
          {payUndo.error && <div className="text-[13px] text-[var(--color-bad)] bg-[var(--color-bad-bg)] rounded-lg p-2 mb-3">{payUndo.error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setPayUndo(null)} disabled={payPosting} className={light}>Cancel</button>
            <button onClick={confirmUndo} disabled={payPosting} className={`${btn} h-[42px] rounded-lg bg-[var(--color-bad)] px-[18px] text-[13px] font-medium text-white disabled:opacity-60`}>{payPosting ? 'Removing…' : 'Undo & delete'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function MonthStepper({ period, onShift, atLatest, onPick }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onShift(-1)} title="Previous month"
        className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-[var(--color-line-control)] text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)]">
        <ChevronLeft size={16} />
      </button>
      <input type="month" value={period} max={nowMonth()} onChange={(e) => e.target.value && onPick(e.target.value)}
        title="Which month this payroll applies to — go back to enter or correct a past month"
        className="field w-[168px]" />
      <button onClick={() => onShift(1)} disabled={atLatest} title={atLatest ? 'This is the current month' : 'Next month'}
        className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-[var(--color-line-control)] text-[var(--color-ink-soft)] hover:bg-[var(--color-soft)] disabled:opacity-40 disabled:hover:bg-transparent">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// 🔒 THREE TILES, and each is a different question. His mockup had a fourth,
// "Next action — Run August payroll", which restated the band directly beneath
// it, and a "Paid this month" that restated the progress bar; the same fact
// twice is what took My Team from eight tiles to five (21 Aug). Paid stays
// because it is the only one carrying money actually out the door.
function Tile({ label, value, hint }) {
  return (
    <div className="card p-5">
      <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">{label}</p>
      <p className="t-stat mt-2">{value}</p>
      <p className="t-support mt-1">{hint}</p>
    </div>
  );
}

function Overview({ period, month, state, people, onStart, onManageSalaries }) {
  const label = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete', empty: 'Nobody to pay' }[state];
  const tone = { 'not-started': 'text-[var(--color-warn)]', 'in-progress': 'text-[var(--color-brand)]', complete: 'text-[var(--color-good)]', empty: 'text-[var(--color-ink-faint)]' }[state];
  const pct = month.employees ? Math.round((month.paidCount / month.employees) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile label="Monthly payroll" value={D(month.base)} hint={`${month.employees} ${month.employees === 1 ? 'employee' : 'employees'}`} />
        <Tile label="Commission due" value={D(month.variable)} hint={month.variable ? 'Variable pay this month' : 'No commission entered'} />
        <Tile label="Paid this month" value={D(month.paidTotal)} hint={`${month.paidCount} of ${month.employees} paid`} />
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="t-card">{monthName(period)} payroll</h2>
            <p className={`mt-1 text-[13px] font-medium ${tone}`}>{label}</p>
          </div>
          {state !== 'empty' && (
            <button onClick={onStart} className="btn-primary inline-flex items-center gap-2 hover:bg-[var(--color-brand-600)]">
              {state === 'not-started' ? 'Start payroll' : state === 'complete' ? 'View run' : 'Continue payroll'}
              <ChevronRight size={15} />
            </button>
          )}
        </div>
        {state === 'empty' ? (
          <p className="mt-3 text-[13px] text-[var(--color-ink-soft)]">Nobody on the roster had joined by {monthName(period)}.</p>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-[var(--color-ink-soft)]">
              {month.employees} {month.employees === 1 ? 'employee is' : 'employees are'} on this run, {D(month.total)} in total.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-lg bg-[var(--color-fill)]">
                <div className="h-full rounded-lg bg-[var(--color-good)] transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-ink-faint)]">{month.paidCount} / {month.employees} paid</span>
            </div>
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h2 className="t-card">Team pay</h2>
            <p className="t-support mt-1">What each employee is currently set to receive.</p>
          </div>
          <button onClick={onManageSalaries} className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-brand)] hover:underline">
            Manage salaries <ChevronRight size={14} />
          </button>
        </div>
        <TeamPayTable people={people} compact />
      </div>
    </div>
  );
}

// THE RUN. A flat facts band, then the rows those facts add up from, then the
// action — last, and only after everything above it has been read.
function RunScreen({ period, month, rows, draftOf, setDraft, paySources, payDate, setPayDate, onMarkPaid, onEdit, onUndo, onOneOff, onConfirmRun, onBack, isCurrentMonth }) {
  const unpaid = rows.filter((p) => !p.paid).length;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[19px] font-semibold text-[var(--color-ink)]">Run payroll · {monthName(period)}</h2>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-ink-soft)]">
            Paid on
            <input type="date" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} className="field w-[150px]"
              title="The payment date recorded in Zoho Books for every payment in this run" />
          </label>
        </div>
        <p className="t-support mt-2">Review what each employee is receiving before anything is marked paid.</p>
        {!isCurrentMonth && (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--color-warn)]">
            <AlertTriangle size={14} /> You are paying into a past month — payments record under {monthName(period)}.
          </p>
        )}
      </div>

      <div className="card grid grid-cols-2 gap-x-8 gap-y-4 p-5 md:grid-cols-4">
        <Fact k="Employees" v={month.employees} />
        <Fact k="Base salaries" v={D(month.base)} />
        <Fact k="Variable pay" v={D(month.variable)} />
        <Fact k="Payroll total" v={D(month.total)} strong />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h3 className="t-card">Payroll breakdown</h3>
          <div className="flex items-center gap-3">
            <button onClick={onOneOff} className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-brand)] hover:underline">
              <Plus size={14} /> Record a payment
            </button>
            <span className="flex items-center gap-1 text-[12px] text-[var(--color-ink-faint)]"><DollarSign size={12} /> Records to Zoho Books</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-[12px] text-[var(--color-ink-faint)]">
                <th className="px-5 py-2.5 text-left font-medium">Employee</th>
                <th className="px-3 py-2.5 text-right font-medium">Base</th>
                <th className="px-3 py-2.5 text-right font-medium">Variable pay</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-left font-medium">Pay method</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const d = draftOf(p);
                const paid = p.paid;
                const total = paid ? Number(paid.total) || 0 : (Number(d.salary) || 0) + (Number(d.bonus) || 0);
                return (
                  <tr key={p.name} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="px-5 py-3">
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">
                        {p.name}
                        {p.past && <span className="ml-2 rounded-lg bg-[var(--color-fill)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--color-ink-soft)]">Past staff</span>}
                      </p>
                      <p className="text-[12px] text-[var(--color-ink-faint)]">{p.role}</p>
                      {/* 🔒 A smaller suggestion is not a mistake. Say why it is
                          smaller, in days, on the row itself (28 Aug part-month
                          rule — someone who joins or leaves mid-month is paid
                          for the days they worked, at both ends). */}
                      {p.partMonth && (
                        <p className="text-[12px] text-[var(--color-warn)]">
                          Part month · {p.partMonth.workedDays} of {p.partMonth.monthDays} working days ({p.partMonth.from.slice(8)}–{p.partMonth.to.slice(8)})
                        </p>
                      )}
                    </td>
                    {paid ? (
                      <>
                        <td className="px-3 py-3 text-right text-[13px] tabular-nums text-[var(--color-ink-soft)]">{D(paid.salary)}</td>
                        <td className="px-3 py-3 text-right text-[13px] tabular-nums text-[var(--color-ink-soft)]">{Number(paid.bonus) > 0 ? D(paid.bonus) : '—'}</td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums whitespace-nowrap">{D(total)}</td>
                        <td className="px-3 py-3 text-[13px] text-[var(--color-ink-soft)]">{paid.paySource || '—'}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-good-bg)] px-2 py-1 text-[12px] font-medium text-[var(--color-good)]"
                            title={paid.expenseId ? `Zoho Books #${String(paid.expenseId).slice(-6)}` : undefined}>
                            Paid {paid.date}
                          </span>
                          {paid.editedInZoho && <span className="ml-1 text-[12px] text-[var(--color-warn)]" title="Total was changed directly in Zoho">⚠</span>}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <button onClick={() => onEdit(paid)} title="Edit payment" className="rounded-lg p-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]"><Edit2 size={15} /></button>
                          <button onClick={() => onUndo(paid)} title="Undo payment" className="ml-1 rounded-lg p-1.5 text-[var(--color-bad)] hover:bg-[var(--color-bad-bg)]"><Trash2 size={15} /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-3 text-right">
                          <input type="number" value={d.salary} onChange={(e) => setDraft(p.name, { salary: e.target.value })} className="field h-9 w-28 text-right" />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input type="number" value={d.bonus} onChange={(e) => setDraft(p.name, { bonus: e.target.value })} className="field h-9 w-28 text-right" />
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums whitespace-nowrap">{D(total)}</td>
                        <td className="px-3 py-3">
                          <select value={d.source} onChange={(e) => setDraft(p.name, { source: e.target.value })} className="field h-9 w-full min-w-[132px] px-2">
                            {paySources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center rounded-lg bg-[var(--color-warn-bg)] px-2 py-1 text-[12px] font-medium text-[var(--color-warn)]">Pending</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => onMarkPaid(p)} disabled={total <= 0}
                            className="text-[13px] font-medium text-[var(--color-brand)] hover:underline disabled:text-[var(--color-ink-ghost)] disabled:no-underline">
                            Mark paid
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-4 text-[12px] text-[var(--color-ink-faint)]">Nothing is posted until you confirm the payroll run.</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onBack} className="btn-secondary inline-flex items-center gap-2 hover:bg-[var(--color-soft)]">Back</button>
        <button onClick={onConfirmRun} disabled={!unpaid}
          className="btn-primary inline-flex items-center gap-2 hover:bg-[var(--color-brand-600)] disabled:opacity-50">
          {unpaid ? `Confirm run (${unpaid})` : 'Everyone is paid'}
        </button>
      </div>
    </div>
  );
}

function Fact({ k, v, strong }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">{k}</p>
      <p className={`mt-1.5 tabular-nums ${strong ? 'text-[19px] font-semibold text-[var(--color-ink)]' : 'text-[17px] font-medium text-[var(--color-ink)]'}`}>{v}</p>
    </div>
  );
}

// EVERY completed or draft payroll run, by month. Books is the truth for money,
// so this reads live from it and falls back to the recorded history if Zoho is
// unreachable — saying so rather than showing stale numbers as though fresh.
function Runs({ hist, error, canSeeDetail }) {
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');
  const [openMonth, setOpenMonth] = useState(null);

  if (!hist) return <div className="card p-5"><TableSkeleton rows={7} cols={5} /></div>;

  const yearOf = (m) => (m.ym ? m.ym.slice(0, 4) : String(m.month).match(/\d{4}/)?.[0] || '—');
  const years = [...new Set(hist.map(yearOf))].sort((a, b) => b.localeCompare(a));
  const scoped = year === 'all' ? hist : hist.filter((m) => yearOf(m) === year);
  const query = q.trim().toLowerCase();

  // Searching a person cuts across months — a flat list of their payments, with
  // what they add up to, answers "what have we paid them" in one read.
  if (query && canSeeDetail) {
    const hits = [];
    scoped.forEach((m) => (m.people || []).forEach((p) => {
      if (String(p.name).toLowerCase().includes(query)) hits.push({ month: m.month, ym: m.ym || m.month, ...p });
    }));
    hits.sort((a, b) => (a.ym < b.ym ? 1 : -1));
    return (
      <div className="space-y-6">
        <RunsFilters {...{ year, setYear, years, q, setQ, canSeeDetail }} />
        <div className="card overflow-hidden">
          {hits.length === 0 ? (
            <EmptyState icon={Search} title="No payments match that name"
              line={`Nothing in ${year === 'all' ? 'any year' : year} was paid to somebody called “${q.trim()}”. Check the spelling, or widen the year.`}
              action={<button onClick={() => setQ('')} className="btn-secondary hover:bg-[var(--color-soft)]">Clear search</button>} />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-[12px] text-[var(--color-ink-faint)]">
                  <th className="px-5 py-2.5 text-left font-medium">Month</th>
                  <th className="px-5 py-2.5 text-left font-medium">Person</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={i} className="border-b border-[var(--color-line-soft)] last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-[13px] text-[var(--color-ink-soft)]">{h.month}</td>
                    <td className="px-5 py-3 text-[13px] text-[var(--color-ink)]">
                      {h.name}
                      {h.note && <span className="block text-[12px] text-[var(--color-ink-faint)]">{h.note}</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-[13px] font-medium tabular-nums">{D(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--color-line)]">
                  <td colSpan={2} className="px-5 py-3 text-[13px] font-semibold">{hits.length} {hits.length === 1 ? 'payment' : 'payments'}</td>
                  <td className="px-5 py-3 text-right text-[13px] font-semibold tabular-nums">{D(hits.reduce((s, h) => s + (h.amount || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    );
  }

  const byYear = {};
  scoped.forEach((m) => { (byYear[yearOf(m)] ||= []).push(m); });
  const order = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      <RunsFilters {...{ year, setYear, years, q, setQ, canSeeDetail }} />
      {error && (
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--color-warn)]">
          <AlertTriangle size={14} /> Couldn’t reach Zoho Books ({error}). Showing the last recorded figures.
        </p>
      )}
      {order.length === 0 ? (
        <div className="card"><EmptyState icon={Wallet} title="No payroll runs yet" line="Every month you complete on the Overview tab lands here, with what was paid and to whom." /></div>
      ) : order.map((y) => {
        const months = byYear[y];
        const yTotal = months.reduce((s, m) => s + (m.total || 0), 0);
        return (
          <div key={y} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-3">
              <h3 className="t-card">{y}</h3>
              <span className="text-[12px] tabular-nums text-[var(--color-ink-faint)]">{D(yTotal)} total</span>
            </div>
            <table className="w-full">
              <tbody>
                {months.map((m) => {
                  const key = m.ym || m.month;
                  const expandable = canSeeDetail && Array.isArray(m.people) && m.people.length > 0;
                  const open = openMonth === key;
                  const itemised = (m.people || []).reduce((s, p) => s + (p.amount || 0), 0);
                  return (
                    <RunRow key={key} m={m} open={open} expandable={expandable} itemised={itemised}
                      onToggle={() => expandable && setOpenMonth(open ? null : key)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function RunsFilters({ year, setYear, years, q, setQ, canSeeDetail }) {
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <select value={year} onChange={(e) => setYear(e.target.value)} className="field w-36">
        <option value="all">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {canSeeDetail && (
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-ghost)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" className="field w-full pl-9" />
        </div>
      )}
    </div>
  );
}

function RunRow({ m, open, expandable, itemised, onToggle }) {
  const reconciles = itemised === m.total;
  return (
    <>
      <tr onClick={onToggle} className={`border-b border-[var(--color-line-soft)] ${expandable ? 'cursor-pointer hover:bg-[var(--color-row-hover)]' : ''}`}>
        <td className="px-5 py-3">
          <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-ink)]">
            {expandable
              ? <ChevronDown size={14} className={`text-[var(--color-ink-faint)] transition-transform ${open ? '' : '-rotate-90'}`} />
              : <span className="inline-block w-[14px]" />}
            {m.month}
          </span>
        </td>
        <td className="px-3 py-3 text-[13px] text-[var(--color-ink-soft)]">
          {m.headcount != null ? `${m.headcount} ${m.headcount === 1 ? 'person' : 'people'}` : ''}
        </td>
        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums">{D(m.total)}</td>
        <td className="px-3 py-3">
          {m.confidence === 'in_progress'
            ? <span className="inline-flex rounded-lg bg-[var(--color-brand-50)] px-2 py-1 text-[12px] font-medium text-[var(--color-brand-700)]">In progress</span>
            : m.confidence === 'low'
              ? <span className="inline-flex rounded-lg bg-[var(--color-warn-bg)] px-2 py-1 text-[12px] font-medium text-[var(--color-warn)]">May be incomplete</span>
              : <span className="inline-flex rounded-lg bg-[var(--color-good-bg)] px-2 py-1 text-[12px] font-medium text-[var(--color-good)]">Paid</span>}
        </td>
        <td className="px-5 py-3 text-right text-[13px] text-[var(--color-ink-faint)]">
          {expandable ? (open ? 'Hide run' : 'View run') : ''}
        </td>
      </tr>
      {expandable && open && (
        <tr>
          <td colSpan={5} className="bg-[var(--color-soft)] px-5 py-3">
            {m.breakdown && <p className="mb-3 text-[12px] text-[var(--color-ink-faint)]">{m.breakdown}</p>}
            <div className="space-y-1.5">
              {m.people.map((p, j) => (
                <div key={j} className="flex items-baseline justify-between gap-4">
                  <span className={`text-[13px] ${p.unallocated ? 'italic text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-soft)]'}`}>
                    {p.name}
                    {p.note && <span className="block text-[12px] text-[var(--color-ink-faint)]">{p.note}</span>}
                  </span>
                  <span className="whitespace-nowrap text-[13px] tabular-nums text-[var(--color-ink-soft)]">{D(p.amount)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-line-soft)] pt-2">
                <span className="text-[13px] font-semibold text-[var(--color-ink)]">Total</span>
                <span className="text-[13px] font-semibold tabular-nums">{D(itemised)}</span>
              </div>
            </div>
            {!reconciles && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--color-warn)]">
                <AlertTriangle size={12} /> The itemised lines ({D(itemised)}) don’t match the recorded total ({D(m.total)}).
              </p>
            )}
            {m.confidence === 'low' && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--color-warn)]">
                <AlertTriangle size={12} /> This month looks low against the others — likely incomplete bookkeeping. Verify before relying on it.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// TEAM PAY — the standing setup, not a month. 🔒 A name always opens the record
// (HR records rule): a salary change belongs on the person's record as a dated
// event, never as an inline overwrite here with no date and no reason.
function TeamPay({ people, priv }) {
  const total = priv?.totalPayroll ?? (people || []).reduce((s, p) => s + (Number(p.total) || 0), 0);
  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <h2 className="t-card">Team pay</h2>
            <p className="t-support mt-1">Current salary and commission. Open a person to change theirs.</p>
          </div>
          <span className="text-[13px] text-[var(--color-ink-soft)]">
            <span className="text-[var(--color-ink-faint)]">Full entitlement</span> <span className="font-semibold tabular-nums text-[var(--color-ink)]">{D(total)}</span>
          </span>
        </div>
        <TeamPayTable people={people} />
      </div>
    </div>
  );
}

function TeamPayTable({ people, compact = false }) {
  const { hasPower } = useAuth();
  const canOpenRecord = hasPower?.('hr');

  if (!people) return <div className="p-5"><TableSkeleton rows={6} cols={5} /></div>;
  if (!people.length) {
    return (
      <EmptyState icon={Users2} title="No compensation to show"
        line="Nobody on the roster is in your payroll scope, so there is no salary or commission for you to see here." />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-y border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-[12px] text-[var(--color-ink-faint)]">
            <th className="px-5 py-2.5 text-left font-medium">Employee</th>
            <th className="px-3 py-2.5 text-left font-medium">Role</th>
            <th className="px-3 py-2.5 text-right font-medium">Base</th>
            <th className="px-3 py-2.5 text-right font-medium">Commission</th>
            <th className="px-3 py-2.5 text-right font-medium">Est. total</th>
            {!compact && <th className="px-5 py-2.5 text-right font-medium"> </th>}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.username || p.name} className="border-b border-[var(--color-line-soft)] last:border-0">
              <td className="px-5 py-3 text-[13px] font-medium text-[var(--color-ink)]">
                {canOpenRecord && p.username
                  ? <Link to={`/people/${p.username}`} className="hover:text-[var(--color-brand)] hover:underline">{p.name}</Link>
                  : p.name}
              </td>
              <td className="px-3 py-3 text-[13px] text-[var(--color-ink-soft)]">{p.title || '—'}</td>
              <td className="px-3 py-3 text-right text-[13px] tabular-nums">{D(p.base)}</td>
              <td className="px-3 py-3 text-right text-[13px] tabular-nums">
                {/* 🔒 "Up to" — commission is a ceiling they can earn, not money
                    owed. The Commission due tile counts what is actually being
                    paid this month; these two numbers must never be read as one. */}
                {Number(p.commission) > 0 ? <span className="text-[var(--color-good)]">Up to {D(p.commission)}</span> : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums">{D(p.total)}</td>
              {!compact && (
                <td className="px-5 py-3 text-right">
                  {canOpenRecord && p.username && (
                    <Link to={`/people/${p.username}`} title={`Open ${p.name}'s record`}
                      className="inline-flex rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">
                      <ChevronRight size={15} />
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ small helpers */

function Modal({ children, onClose, narrow = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 p-4" onClick={onClose}>
      <div className={`card w-full ${narrow ? 'max-w-sm' : 'max-w-md'} p-5 shadow-[var(--shadow-lift)]`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--color-ink-soft)]">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      {children}
    </label>
  );
}
