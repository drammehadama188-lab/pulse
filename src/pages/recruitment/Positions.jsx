import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, Trash2, Pencil } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CARD, BTN_DARK, BTN_LIGHT, PageHead, fullDate } from './ui.jsx';

// The jobs being hired for. An applicant files under one, which is what turns
// "259 people applied" into "the Sales Agent round is 2 of 3 filled".

const BLANK = { title: '', department: '', location: '', employment: 'Full time', openings: 1, summary: '' };
const EMPLOYMENT = ['Full time', 'Part time', 'Internship', 'Contract'];

export default function Positions() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api('/positions').then(d => setPositions(d.positions || [])).catch(() => setPositions([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true); setError(null);
    try {
      if (editing === 'new') await api('/positions', { method: 'POST', body: form });
      else await api(`/positions/${editing}`, { method: 'PUT', body: form });
      setEditing(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function setStatus(p, status) {
    setPositions(list => list.map(x => x.id === p.id ? { ...x, status } : x));
    try { await api(`/positions/${p.id}`, { method: 'PUT', body: { status } }); } catch { load(); }
  }
  async function remove(p) {
    if (!window.confirm(`Delete ${p.title}?`)) return;
    try { await api(`/positions/${p.id}`, { method: 'DELETE' }); load(); }
    catch (e) { setError(e.message); }
  }

  const open = positions.filter(p => p.status === 'open');
  const closed = positions.filter(p => p.status !== 'open');

  function Card({ p }) {
    return (
      <div className={`${CARD} p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--color-ink)]">{p.title}</h3>
            <p className="text-xs text-[var(--color-ink-faint)] mt-0.5">{[p.department, p.location, p.employment].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { setForm({ ...BLANK, ...p }); setEditing(p.id); }} className="p-1.5 rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]"><Pencil size={15} /></button>
            <button onClick={() => remove(p)} className="p-1.5 rounded-lg text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]"><Trash2 size={15} /></button>
          </div>
        </div>
        {p.summary && <p className="mt-3 text-sm text-[var(--color-ink-soft)] whitespace-pre-wrap">{p.summary}</p>}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[[p.applicantCount, 'applied'], [p.interviewedCount, 'interviewed'], [`${p.hiredCount}/${p.openings}`, 'hired']].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-[var(--color-fill)] py-2.5">
              <p className="text-lg font-semibold text-[var(--color-ink)]">{v}</p>
              <p className="text-[11px] text-[var(--color-ink-faint)]">{l}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Link to={`/recruitment/applicants?position=${p.id}&stage=all`} className="text-sm font-medium text-[var(--color-ink)] hover:underline">See applicants</Link>
          <button onClick={() => setStatus(p, p.status === 'open' ? 'closed' : 'open')} className="text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            {p.status === 'open' ? 'Close' : 'Reopen'}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-[var(--color-ink-faint)]">Opened {fullDate(p.createdAt)}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHead title="Positions" count={positions.length || null}>
        <button onClick={() => { setForm(BLANK); setError(null); setEditing('new'); }} className={BTN_DARK}><Plus size={16} /> New position</button>
      </PageHead>

      {error && <p className="mb-4 text-sm text-[var(--color-stage-out)]">{error}</p>}

      {loading ? <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
        : positions.length === 0 ? <div className={`${CARD} p-12 text-center text-[var(--color-ink-faint)] text-sm`}>No positions yet. Add the job you are hiring for and applicants file under it.</div>
          : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {open.map(p => <Card key={p.id} p={p} />)}
              </div>
              {closed.length > 0 && (
                <div>
                  <h2 className="text-sm font-bold text-[var(--color-ink-faint)] uppercase tracking-wider mb-3">Closed</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 opacity-70">
                    {closed.map(p => <Card key={p.id} p={p} />)}
                  </div>
                </div>
              )}
            </div>
          )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--color-ink)]">{editing === 'new' ? 'New position' : 'Edit position'}</h3>
              <button onClick={() => setEditing(null)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {[['title', 'Title *'], ['department', 'Department'], ['location', 'Location']].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">{label}</span>
                  <input value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Type</span>
                  <select value={form.employment} onChange={e => setForm(f => ({ ...f, employment: e.target.value }))} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm bg-white">
                    {EMPLOYMENT.map(x => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Openings</span>
                  <input type="number" min={1} value={form.openings} onChange={e => setForm(f => ({ ...f, openings: e.target.value }))} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">What the job is</span>
                <textarea value={form.summary || ''} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} rows={3} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} disabled={saving} className="px-3 py-2 rounded-lg text-sm bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
              <button onClick={save} disabled={saving || !form.title.trim()} className="px-3.5 py-2.5 rounded-[10px] text-[13.5px] font-semibold bg-[var(--color-ink)] text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
