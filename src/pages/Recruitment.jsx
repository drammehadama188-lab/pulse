import { useState, useEffect } from 'react';
import { Plus, Trash2, Mail, Phone, X } from 'lucide-react';
import { api } from '../lib/api.js';

// Recruitment — applicants pipeline (CV received → interviewed → hired/rejected).
// New HR module (24 Jun 2026, Adama). All real data via /api/applicants.

const STAGES = [
  ['cv_received', 'CV Received', 'bg-blue-50 text-blue-700', 'bg-blue-500'],
  ['interviewed', 'Interviewed', 'bg-amber-50 text-amber-700', 'bg-amber-500'],
  ['hired', 'Hired', 'bg-emerald-50 text-emerald-700', 'bg-emerald-500'],
  ['rejected', 'Rejected', 'bg-gray-100 text-gray-500', 'bg-gray-400'],
];
const BLANK = { name: '', role: '', email: '', phone: '', source: '', notes: '' };

export default function Recruitment() {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api('/applicants').then(d => setApplicants(d.applicants || [])).catch(() => setApplicants([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function addApplicant() {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await api('/applicants', { method: 'POST', body: form }); setForm(BLANK); setAdding(false); load(); }
    catch { /* ignore */ } finally { setSaving(false); }
  }
  async function moveStage(a, stage) {
    setApplicants(list => list.map(x => x.id === a.id ? { ...x, stage } : x));
    try { await api(`/applicants/${a.id}`, { method: 'PUT', body: { stage } }); } catch { load(); }
  }
  async function remove(a) {
    if (!window.confirm(`Remove ${a.name} from recruitment?`)) return;
    setApplicants(list => list.filter(x => x.id !== a.id));
    try { await api(`/applicants/${a.id}`, { method: 'DELETE' }); } catch { load(); }
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Recruitment</h1>
          <p className="text-gray-500 mt-1">Applicants and interview pipeline</p>
        </div>
        <button onClick={() => { setForm(BLANK); setAdding(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800">
          <Plus size={16} /> Add applicant
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : applicants.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">No applicants yet. Add the first CV you receive.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STAGES.map(([key, label, chip, dot]) => {
            const inStage = applicants.filter(a => a.stage === key);
            return (
              <div key={key} className="bg-gray-50/60 rounded-2xl border border-gray-200 p-3">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-700"><span className={`w-2 h-2 rounded-full ${dot}`} />{label}</span>
                  <span className="text-xs font-medium text-gray-400">{inStage.length}</span>
                </div>
                <div className="space-y-2">
                  {inStage.map(a => (
                    <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{a.name}</p>
                          {a.role && <p className="text-xs text-gray-500 truncate">{a.role}</p>}
                        </div>
                        <button onClick={() => remove(a)} title="Remove" className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 shrink-0"><Trash2 size={14} /></button>
                      </div>
                      {(a.email || a.phone) && (
                        <div className="mt-2 space-y-0.5">
                          {a.email && <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Mail size={11} /> {a.email}</p>}
                          {a.phone && <p className="text-[11px] text-gray-500 flex items-center gap-1.5"><Phone size={11} /> {a.phone}</p>}
                        </div>
                      )}
                      {a.source && <p className="text-[11px] text-gray-400 mt-1">Source: {a.source}</p>}
                      {a.notes && <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2">{a.notes}</p>}
                      <select value={a.stage} onChange={e => moveStage(a, e.target.value)} className="mt-2.5 w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                        {STAGES.map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}
                      </select>
                    </div>
                  ))}
                  {inStage.length === 0 && <p className="text-[11px] text-gray-300 text-center py-4">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setAdding(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Add applicant</h3>
              <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {[['name', 'Name *'], ['role', 'Applying for'], ['email', 'Email'], ['phone', 'Phone'], ['source', 'Source (referral, ad…)']].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</span>
                  <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              ))}
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Notes</span>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAdding(false)} disabled={saving} className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={addApplicant} disabled={saving || !form.name.trim()} className="px-3 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
