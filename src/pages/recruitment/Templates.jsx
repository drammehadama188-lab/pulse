import { useEffect, useState } from 'react';
import { Plus, Trash2, Star, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { CARD, BTN_DARK, BTN_LIGHT, PageHead } from './ui.jsx';

// The question sets an interview runs on. Damia's own sales questions ship as
// the starting set and every word of them is editable — a generic HR form
// scores nothing worth knowing.
//
// 🔒 An interview keeps its own copy of the questions from the moment it is
// created, so editing here never changes what an interview already asked.

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api('/interview-templates').then(d => setTemplates(d.templates || [])).catch(() => setTemplates([])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function edit(t) {
    setOpenId(t.id);
    setDraft(JSON.parse(JSON.stringify(t)));
    setError(null);
  }
  async function save() {
    setSaving(true); setError(null);
    try {
      await api(`/interview-templates/${draft.id}`, { method: 'PUT', body: { name: draft.name, role: draft.role, sections: draft.sections } });
      setDraft(null); setOpenId(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function makeDefault(t) {
    try { await api(`/interview-templates/${t.id}`, { method: 'PUT', body: { isDefault: true } }); load(); }
    catch (e) { setError(e.message); }
  }
  async function duplicate(t) {
    try {
      await api('/interview-templates', { method: 'POST', body: { name: `${t.name} (copy)`, role: t.role, sections: t.sections.map(s => ({ title: s.title, questions: s.questions.map(q => ({ text: q.text })) })) } });
      load();
    } catch (e) { setError(e.message); }
  }
  async function remove(t) {
    if (!window.confirm(`Delete "${t.name}"? Interviews already scored keep their questions.`)) return;
    try { await api(`/interview-templates/${t.id}`, { method: 'DELETE' }); load(); }
    catch (e) { setError(e.message); }
  }
  async function blank() {
    try {
      const { template } = await api('/interview-templates', { method: 'POST', body: { name: 'New question set', role: '', sections: [{ title: 'Section 1', questions: [{ text: 'First question' }] }] } });
      load(); edit(template);
    } catch (e) { setError(e.message); }
  }

  const upd = (fn) => setDraft(d => { const c = JSON.parse(JSON.stringify(d)); fn(c); return c; });

  return (
    <div>
      <PageHead title="Templates" count={templates.length || null}>
        <button onClick={blank} className={BTN_DARK}><Plus size={16} /> New set</button>
      </PageHead>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-4">
          {templates.map(t => {
            const isOpen = openId === t.id && draft;
            const questions = t.sections.reduce((n, s) => n + s.questions.length, 0);
            return (
              <div key={t.id} className={CARD}>
                <div className="flex items-center justify-between gap-3 p-5">
                  <button onClick={() => (isOpen ? (setOpenId(null), setDraft(null)) : edit(t))} className="flex items-center gap-2 min-w-0 text-left">
                    {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-300" />}
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-base font-bold text-gray-900">{t.name}</span>
                        {t.isDefault && <span className="rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Default</span>}
                      </span>
                      <span className="block text-xs text-gray-400 mt-0.5">{t.sections.length} sections · {questions} questions{t.role ? ` · ${t.role}` : ''}</span>
                    </span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {!t.isDefault && <button onClick={() => makeDefault(t)} title="Make default" className="p-1.5 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50"><Star size={15} /></button>}
                    <button onClick={() => duplicate(t)} title="Duplicate" className="p-1.5 rounded-lg text-gray-300 hover:text-gray-700 hover:bg-gray-100"><Copy size={15} /></button>
                    <button onClick={() => remove(t)} title="Delete" className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100 p-5 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Name</span>
                        <input value={draft.name} onChange={e => upd(d => { d.name = e.target.value; })} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                      </label>
                      <label className="block">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">For which role</span>
                        <input value={draft.role || ''} onChange={e => upd(d => { d.role = e.target.value; })} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                      </label>
                    </div>

                    {draft.sections.map((s, si) => (
                      <div key={s.id || si} className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2">
                          <input value={s.title} onChange={e => upd(d => { d.sections[si].title = e.target.value; })}
                            className="flex-1 border-0 border-b border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none text-sm font-bold text-gray-900 px-0 py-1" />
                          <button onClick={() => upd(d => { d.sections.splice(si, 1); })} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {s.questions.map((q, qi) => (
                            <div key={q.id || qi} className="flex items-start gap-2">
                              <span className="mt-2 text-[11px] font-bold text-gray-300 w-6 shrink-0">Q{qi + 1}</span>
                              <textarea value={q.text} rows={2} onChange={e => upd(d => { d.sections[si].questions[qi].text = e.target.value; })}
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                              <button onClick={() => upd(d => { d.sections[si].questions.splice(qi, 1); })} className="mt-1 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => upd(d => { d.sections[si].questions.push({ text: '' }); })} className="mt-3 text-sm font-medium text-gray-500 hover:text-gray-900">+ Question</button>
                      </div>
                    ))}

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <button onClick={() => upd(d => { d.sections.push({ title: 'New section', questions: [{ text: '' }] }); })} className={BTN_LIGHT}>+ Section</button>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setDraft(null); setOpenId(null); }} className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
                        <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save set'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
