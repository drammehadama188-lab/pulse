import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, Mail, Phone, X, Upload, ClipboardPaste, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';

// Recruitment — applicants pipeline (CV received → interviewed → hired/rejected).
// New HR module (24 Jun 2026, Adama). All real data via /api/applicants.
//
// 19 Aug 2026: a hiring ad returns hundreds at once (259 from the Sales Agent
// form), so the CSV imports whole and the LIST became the working view — a
// four-column board cannot be worked through by phone. The board stays for the
// handful of walk-in CVs it was built for.

const STAGES = [
  ['cv_received', 'CV Received', 'bg-blue-50 text-blue-700', 'bg-blue-500'],
  ['interviewed', 'Interviewed', 'bg-amber-50 text-amber-700', 'bg-amber-500'],
  ['hired', 'Hired', 'bg-emerald-50 text-emerald-700', 'bg-emerald-500'],
  ['rejected', 'Rejected', 'bg-gray-100 text-gray-500', 'bg-gray-400'],
];
const BLANK = { name: '', role: '', email: '', phone: '', source: '', notes: '' };
const SORTS = [['best', 'Best first'], ['newest', 'Newest'], ['name', 'Name']];
// Where the applicant came from. Imported rows carry the lead form's name;
// these are the channels a CV arrives through by hand.
const SOURCES = ['Ads', 'WhatsApp', 'Referral', 'Walk-in', 'Recruitment agency', 'Email'];
// A whole batch shares one Added date, which is the point — it says which
// import someone arrived in. Applied is their own date, from the lead form.
const shortDate = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const fullDate = (iso) => {
  const d = new Date(iso || '');
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function Recruitment() {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('list');
  const [stageFilter, setStageFilter] = useState('cv_received');
  const [query, setQuery] = useState('');
  const [startOnly, setStartOnly] = useState(false);
  const [sort, setSort] = useState('best');
  const [openId, setOpenId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [otherSource, setOtherSource] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef(null);

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
  async function saveNotes(a, notes) {
    setApplicants(list => list.map(x => x.id === a.id ? { ...x, notes } : x));
    try { await api(`/applicants/${a.id}`, { method: 'PUT', body: { notes } }); } catch { load(); }
  }
  async function remove(a) {
    if (!window.confirm(`Remove ${a.name} from recruitment?`)) return;
    setApplicants(list => list.filter(x => x.id !== a.id));
    try { await api(`/applicants/${a.id}`, { method: 'DELETE' }); } catch { load(); }
  }

  // The file goes in exactly as downloaded from Meta — no spreadsheet step.
  async function importText(csv, label) {
    setImporting(label); setImportError(null); setImportResult(null);
    try {
      const r = await api('/applicants/import', { method: 'POST', body: { csv, role: 'Sales Agent' } });
      setImportResult(r);
      setStageFilter('cv_received');
      setPasting(false); setPasted('');
      load();
    } catch (e) {
      setImportError(`${label}: ${e.message}`);
    } finally {
      setImporting(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function importFile(file) {
    if (!file) return;
    importText(await file.text(), file.name);
  }

  const counts = useMemo(() => {
    const c = { all: applicants.length };
    for (const [k] of STAGES) c[k] = applicants.filter(a => a.stage === k).length;
    return c;
  }, [applicants]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = applicants.filter(a => (stageFilter === 'all' || a.stage === stageFilter));
    if (startOnly) list = list.filter(a => a.startNow === true);
    if (q) list = list.filter(a => `${a.name || ''} ${a.phone || ''} ${a.experience || ''}`.toLowerCase().includes(q));
    const time = (a) => Date.parse(a.appliedAt || a.createdAt || 0) || 0;
    return [...list].sort((a, b) => {
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sort === 'newest') return time(b) - time(a);
      // Best first: can start now, then whoever actually wrote something about
      // what they have sold, then most recent. Anyone without a usable number
      // sinks — you cannot call them.
      const s = (x) => (x.startNow === true ? 2 : x.startNow === null ? 1 : 0);
      if (s(b) !== s(a)) return s(b) - s(a);
      const e = (x) => (x.phoneValid === false ? -1 : String(x.experience || '').trim().length);
      if (e(b) !== e(a)) return e(b) - e(a);
      return time(b) - time(a);
    });
  }, [applicants, stageFilter, startOnly, query, sort]);

  const chip = 'px-3 py-1.5 rounded-lg text-xs font-medium border';
  const chipOn = 'bg-gray-900 text-white border-gray-900';
  const chipOff = 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50';

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Recruitment</h1>
          <p className="text-gray-500 mt-1">Applicants and interview pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          {/* A label opens the picker itself. Scripting a click on a hidden
              input looked like a working button and did nothing (19 Aug). */}
          {/* No accept filter: it greyed out the very file being imported, so
              the picker opened and nothing could be chosen (19 Aug). */}
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-50 cursor-pointer">
            <Upload size={16} /> Import list
            <input ref={fileRef} type="file" className="sr-only" onChange={e => importFile(e.target.files?.[0])} />
          </label>
          <button onClick={() => { setPasted(''); setImportError(null); setPasting(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-50">
            <ClipboardPaste size={16} /> Paste rows
          </button>
          <button onClick={() => { setForm(BLANK); setOtherSource(false); setAdding(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800">
            <Plus size={16} /> Add applicant
          </button>
        </div>
      </div>

      {(importing || importResult || importError) && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          {importing && <p className="text-sm text-gray-500">Reading {importing}…</p>}
          {importError && <p className="text-sm text-red-600">{importError}</p>}
          {importResult && (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-gray-800">
                  <span className="font-semibold">{importResult.added} added</span>
                  {importResult.rows > 0 && <span className="text-gray-500"> of {importResult.rows} rows</span>}
                  {importResult.duplicates > 0 && <span className="text-gray-500"> · {importResult.duplicates} already on the list</span>}
                  {importResult.noPhone > 0 && <span className="text-gray-500"> · {importResult.noPhone} without a usable phone</span>}
                </p>
                {importResult.reason && <p className="text-sm text-red-600 mt-1">{importResult.reason}</p>}
              </div>
              <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <button onClick={() => setStageFilter('all')} className={`${chip} ${stageFilter === 'all' ? chipOn : chipOff}`}>All {counts.all}</button>
        {STAGES.map(([k, label]) => (
          <button key={k} onClick={() => setStageFilter(k)} className={`${chip} ${stageFilter === k ? chipOn : chipOff}`}>{label} {counts[k] || 0}</button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setStartOnly(v => !v)} className={`${chip} ${startOnly ? chipOn : chipOff}`}>Can start now</button>
        <select value={sort} onChange={e => setSort(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
          <option value="list">List</option>
          <option value="board">Board</option>
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone…" className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white w-56" />
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : applicants.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">No applicants yet. Import a list or add the first CV you receive.</div>
      ) : view === 'list' ? (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Phone</th>
                <th className="px-4 py-3 font-bold">Can start</th>
                <th className="px-4 py-3 font-bold">Has sold</th>
                <th className="px-4 py-3 font-bold">Added</th>
                <th className="px-4 py-3 font-bold">Notes</th>
                <th className="px-4 py-3 font-bold">Stage</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <RowGroup key={a.id} a={a} open={openId === a.id}
                  onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                  onStage={moveStage} onNotes={saveNotes} onRemove={remove} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">Nobody matches those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STAGES.map(([key, label, chipCls, dot]) => {
            const inStage = applicants.filter(a => a.stage === key);
            return (
              <div key={key} className="bg-gray-50/60 rounded-2xl border border-gray-200 p-3">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-700"><span className={`w-2 h-2 rounded-full ${dot}`} />{label}</span>
                  <span className="text-xs font-medium text-gray-400">{inStage.length}</span>
                </div>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto">
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

      {/* Paste route: open the file in Excel or Numbers, select all, paste here.
          Works when a file picker will not cooperate, and it is what he asked
          for in the first place — put the list in, get it sorted. */}
      {pasting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !importing && setPasting(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Paste rows</h3>
              <button onClick={() => setPasting(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={12} autoFocus
              placeholder={'full_name\tphone_number\tcan you start immediately\thave you sold anything before'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono" />
            <p className="text-xs text-gray-400 mt-2">First row must be the column headings.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPasting(false)} disabled={!!importing} className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={() => importText(pasted, 'Pasted rows')} disabled={!!importing || pasted.trim().split('\n').length < 2}
                className="px-3 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{importing ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
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
              {[['name', 'Name *'], ['role', 'Applying for'], ['email', 'Email'], ['phone', 'Phone']].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</span>
                  <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              ))}
              {/* Fixed list, so the channels stay countable — typed sources
                  split into "whatsapp", "WhatsApp", "wa" and stop adding up. */}
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Source</span>
                <select value={otherSource ? '__other' : form.source}
                  onChange={e => {
                    const v = e.target.value;
                    setOtherSource(v === '__other');
                    setForm(f => ({ ...f, source: v === '__other' ? '' : v }));
                  }}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Source…</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  <option value="__other">Other</option>
                </select>
                {otherSource && (
                  <input autoFocus value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                )}
              </label>
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

// One applicant: the call line, and everything they answered when opened.
function RowGroup({ a, open, onToggle, onStage, onNotes, onRemove }) {
  const [note, setNote] = useState(a.notes || '');
  useEffect(() => { setNote(a.notes || ''); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const answers = Object.entries(a.answers || {});
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/60">
        <td className="px-4 py-3 align-top">
          <button onClick={onToggle} className="flex items-center gap-1.5 text-left">
            {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-300" />}
            <span className="font-medium text-gray-900">{a.name}</span>
          </button>
        </td>
        <td className="px-4 py-3 align-top">
          {a.phoneValid === false
            ? <span className="text-red-500 text-xs">No usable number</span>
            : <a href={`tel:${String(a.phone || '').replace(/\s/g, '')}`} className="text-gray-700 hover:text-gray-900">{a.phone || '—'}</a>}
        </td>
        <td className="px-4 py-3 align-top">
          {a.startNow === true ? <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">Yes</span>
            : a.startNow === false ? <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-xs">No</span>
              : <span className="text-gray-300 text-xs">—</span>}
        </td>
        {/* Shown whole, not clipped: this answer is what the decision is made
            on, and clipping it meant opening every row to read one sentence. */}
        <td className="px-4 py-3 align-top max-w-lg">
          <span className="text-gray-600 text-xs whitespace-pre-wrap break-words">{a.experience || '—'}</span>
        </td>
        <td className="px-4 py-3 align-top whitespace-nowrap">
          <span className="text-gray-500 text-xs">{shortDate(a.createdAt)}</span>
        </td>
        {/* Note is written here, in the row, so a called applicant looks
            different from one nobody has touched. Saves when you click away. */}
        <td className="px-4 py-3 align-top">
          <textarea value={note} rows={2} placeholder="Add a note"
            onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (a.notes || '') && onNotes(a, note)}
            className="w-52 text-xs text-gray-700 rounded-lg px-2 py-1.5 bg-transparent border border-transparent hover:border-gray-200 focus:bg-white focus:border-gray-300 focus:outline-none resize-y placeholder:text-gray-300" />
        </td>
        <td className="px-4 py-3 align-top">
          <select value={a.stage} onChange={e => onStage(a, e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            {STAGES.map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}
          </select>
        </td>
        <td className="px-4 py-3 text-right align-top">
          <button onClick={() => onRemove(a)} title="Remove" className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60 border-b border-gray-100">
          <td colSpan={8} className="px-10 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                {answers.length === 0 && <p className="text-xs text-gray-400">No answers on this record.</p>}
                {answers.map(([q, v]) => (
                  <div key={q}>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{q}</p>
                    <p className="text-sm text-gray-800">{v}</p>
                  </div>
                ))}
                <p className="text-[11px] text-gray-400 pt-1">
                  {[a.email, a.dob, a.source, a.form,
                    a.appliedAt ? `Applied ${fullDate(a.appliedAt)}` : '',
                    `Added ${fullDate(a.createdAt)}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Notes</p>
                <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (a.notes || '') && onNotes(a, note)} rows={4}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
