import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Mail, Phone, X, Upload, ClipboardPaste, ChevronDown, ChevronRight, FileText, ClipboardCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { STAGES, DROPPED } from './stages.js';
import { CARD, BTN_LIGHT, BTN_DARK, shortDate, fullDate } from './ui.jsx';

// Recruitment — applicants pipeline (CV received → interviewed → hired/rejected).
// New HR module (24 Jun 2026, Adama). All real data via /api/applicants.
//
// 19 Aug 2026: a hiring ad returns hundreds at once (259 from the Sales Agent
// form), so the CSV imports whole and the LIST became the working view — a
// four-column board cannot be worked through by phone. The board stays for the
// handful of walk-in CVs it was built for.

const BLANK = { name: '', role: '', email: '', phone: '', source: '', notes: '', positionId: '' };
const SORTS = [['best', 'Best first'], ['newest', 'Newest'], ['name', 'Name']];
// Where the applicant came from. Imported rows carry the lead form's name;
// these are the channels a CV arrives through by hand.
const SOURCES = ['Ads', 'WhatsApp', 'Referral', 'Walk-in', 'Recruitment agency', 'Email'];
// A whole batch shares one Added date, which is the point — it says which
// import someone arrived in. Applied is their own date, from the lead form.

export default function Applicants() {
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const [positions, setPositions] = useState([]);
  const [view, setView] = useState('list');
  const stageFilter = params.get('stage') || 'cv_received';
  const positionFilter = params.get('position') || '';
  const setStageFilter = (k) => setParams(prev => {
    const next = new URLSearchParams(prev);
    next.set('stage', k);
    return next;
  }, { replace: true });
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
  useEffect(() => { api('/positions').then(d => setPositions(d.positions || [])).catch(() => setPositions([])); }, []);

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
  async function assignPosition(a, positionId) {
    setApplicants(list => list.map(x => x.id === a.id ? { ...x, positionId } : x));
    try { await api(`/applicants/${a.id}`, { method: 'PUT', body: { positionId } }); } catch { load(); }
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
    // "dropped" is not a stage, it is every way out of the pipeline — the
    // dashboard links here so its numbers add up to the total.
    let list = applicants.filter(a => (
      stageFilter === 'all' ? true
        : stageFilter === 'dropped' ? DROPPED.includes(a.stage)
          : a.stage === stageFilter));
    // Older records carry only a typed role, so a position also matches by its
    // title — otherwise the 259 imported as "Sales Agent" vanish from the job
    // they actually applied for.
    if (positionFilter) {
      const p = positions.find(x => x.id === positionFilter);
      const title = (p?.title || '').toLowerCase();
      list = list.filter(a => a.positionId === positionFilter || (!a.positionId && title && String(a.role || '').toLowerCase() === title));
    }
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
  }, [applicants, stageFilter, positionFilter, positions, startOnly, query, sort]);

  const chip = 'px-3 py-1.5 rounded-lg text-xs font-medium border';
  const chipOn = 'bg-[var(--color-ink)] text-white border-[var(--color-ink)]';
  const chipOff = 'bg-white text-[var(--color-ink-soft)] border-[var(--color-line)] hover:bg-[var(--color-fill)]';

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[27px] font-bold text-[var(--color-ink)]">Applicants<span className="ml-2 text-lg font-semibold text-[var(--color-ink-faint)]">{applicants.length || ''}</span></h1>
        </div>
        <div className="flex items-center gap-2">
          {/* A label opens the picker itself. Scripting a click on a hidden
              input looked like a working button and did nothing (19 Aug). */}
          {/* No accept filter: it greyed out the very file being imported, so
              the picker opened and nothing could be chosen (19 Aug). */}
          <label className={`${BTN_LIGHT} cursor-pointer`}>
            <Upload size={16} /> Import list
            <input ref={fileRef} type="file" className="sr-only" onChange={e => importFile(e.target.files?.[0])} />
          </label>
          <button onClick={() => { setPasted(''); setImportError(null); setPasting(true); }} className={BTN_LIGHT}>
            <ClipboardPaste size={16} /> Paste rows
          </button>
          <button onClick={() => { setForm(BLANK); setOtherSource(false); setAdding(true); }} className={BTN_DARK}>
            <Plus size={16} /> Add applicant
          </button>
        </div>
      </div>

      {(importing || importResult || importError) && (
        <div className="mb-5 rounded-xl border border-[var(--color-line)] bg-white p-4">
          {importing && <p className="text-sm text-[var(--color-ink-soft)]">Reading {importing}…</p>}
          {importError && <p className="text-sm text-[var(--color-stage-out)]">{importError}</p>}
          {importResult && (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-[var(--color-ink)]">
                  <span className="font-semibold">{importResult.added} added</span>
                  {importResult.rows > 0 && <span className="text-[var(--color-ink-soft)]"> of {importResult.rows} rows</span>}
                  {importResult.duplicates > 0 && <span className="text-[var(--color-ink-soft)]"> · {importResult.duplicates} already on the list</span>}
                  {importResult.noPhone > 0 && <span className="text-[var(--color-ink-soft)]"> · {importResult.noPhone} without a usable phone</span>}
                </p>
                {importResult.reason && <p className="text-sm text-[var(--color-stage-out)] mt-1">{importResult.reason}</p>}
              </div>
              <button onClick={() => setImportResult(null)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]"><X size={16} /></button>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <button onClick={() => setStageFilter('all')} className={`${chip} ${stageFilter === 'all' ? chipOn : chipOff}`}>All {counts.all}</button>
        {stageFilter === 'dropped' && <button className={`${chip} ${chipOn}`}>Left the pipeline {applicants.filter(a => DROPPED.includes(a.stage)).length}</button>}
        {STAGES.map(([k, label]) => (
          <button key={k} onClick={() => setStageFilter(k)} className={`${chip} ${stageFilter === k ? chipOn : chipOff}`}>{label} {counts[k] || 0}</button>
        ))}
        {positionFilter && (
          <button onClick={() => setParams(prev => { const n = new URLSearchParams(prev); n.delete('position'); return n; }, { replace: true })}
            className={`${chip} bg-[var(--color-ink)] text-white border-[var(--color-ink)] flex items-center gap-1.5`}>
            {positions.find(p => p.id === positionFilter)?.title || 'Position'} <X size={12} />
          </button>
        )}
        <span className="flex-1" />
        <button onClick={() => setStartOnly(v => !v)} className={`${chip} ${startOnly ? chipOn : chipOff}`}>Can start now</button>
        <select value={sort} onChange={e => setSort(e.target.value)} className="text-xs border border-[var(--color-line)] rounded-lg px-2 py-2 bg-white text-[var(--color-ink-soft)]">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={view} onChange={e => setView(e.target.value)} className="text-xs border border-[var(--color-line)] rounded-lg px-2 py-2 bg-white text-[var(--color-ink-soft)]">
          <option value="list">List</option>
          <option value="board">Board</option>
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone…" className="text-sm border border-[var(--color-line)] rounded-lg px-3 py-2 bg-white w-56" />
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
      ) : applicants.length === 0 ? (
        <div className={`${CARD} p-12 text-center text-[var(--color-ink-faint)] text-sm`}>No applicants yet. Import a list or add the first CV you receive.</div>
      ) : view === 'list' ? (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)] border-b border-[var(--color-line-soft)]">
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
                <RowGroup key={a.id} a={a} open={openId === a.id} positions={positions}
                  onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                  onStage={moveStage} onNotes={saveNotes} onRemove={remove} onPosition={assignPosition} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--color-ink-faint)] text-sm">Nobody matches those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STAGES.map(([key, label, chipCls, dot]) => {
            const inStage = applicants.filter(a => a.stage === key);
            return (
              <div key={key} className="bg-[var(--color-fill)] rounded-xl border border-[var(--color-line)] p-3">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-soft)]"><span className={`w-2 h-2 rounded-full ${dot}`} />{label}</span>
                  <span className="text-xs font-medium text-[var(--color-ink-faint)]">{inStage.length}</span>
                </div>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                  {inStage.map(a => (
                    <div key={a.id} className="bg-white rounded-xl border border-[var(--color-line)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--color-ink)] truncate">{a.name}</p>
                          {a.role && <p className="text-xs text-[var(--color-ink-soft)] truncate">{a.role}</p>}
                        </div>
                        <button onClick={() => remove(a)} title="Remove" className="p-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)] shrink-0"><Trash2 size={14} /></button>
                      </div>
                      {(a.email || a.phone) && (
                        <div className="mt-2 space-y-0.5">
                          {a.email && <p className="text-[11px] text-[var(--color-ink-soft)] flex items-center gap-1.5"><Mail size={11} /> {a.email}</p>}
                          {a.phone && <p className="text-[11px] text-[var(--color-ink-soft)] flex items-center gap-1.5"><Phone size={11} /> {a.phone}</p>}
                        </div>
                      )}
                      {a.source && <p className="text-[11px] text-[var(--color-ink-faint)] mt-1">Source: {a.source}</p>}
                      {a.notes && <p className="text-[11px] text-[var(--color-ink-soft)] mt-1.5 line-clamp-2">{a.notes}</p>}
                      <select value={a.stage} onChange={e => moveStage(a, e.target.value)} className="mt-2.5 w-full text-xs border border-[var(--color-line)] rounded-lg px-2 py-1.5 bg-white">
                        {STAGES.map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}
                      </select>
                    </div>
                  ))}
                  {inStage.length === 0 && <p className="text-[11px] text-[var(--color-ink-faint)] text-center py-4">Empty</p>}
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
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--color-ink)]">Paste rows</h3>
              <button onClick={() => setPasting(false)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]"><X size={18} /></button>
            </div>
            <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={12} autoFocus
              placeholder={'full_name\tphone_number\tcan you start immediately\thave you sold anything before'}
              className="w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-xs font-mono" />
            <p className="text-xs text-[var(--color-ink-faint)] mt-2">First row must be the column headings.</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPasting(false)} disabled={!!importing} className="px-3 py-2 rounded-lg text-sm bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
              <button onClick={() => importText(pasted, 'Pasted rows')} disabled={!!importing || pasted.trim().split('\n').length < 2}
                className="px-3.5 py-2.5 rounded-[10px] text-[13.5px] font-semibold bg-[var(--color-ink)] text-white hover:opacity-90 disabled:opacity-50">{importing ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setAdding(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--color-ink)]">Add applicant</h3>
              <button onClick={() => setAdding(false)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {[['name', 'Name *'], ['role', 'Applying for'], ['email', 'Email'], ['phone', 'Phone']].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">{label}</span>
                  <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
                </label>
              ))}
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Position</span>
                <select value={form.positionId} onChange={e => setForm(f => ({ ...f, positionId: e.target.value }))}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Not filed</option>
                  {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              {/* Fixed list, so the channels stay countable — typed sources
                  split into "whatsapp", "WhatsApp", "wa" and stop adding up. */}
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Source</span>
                <select value={otherSource ? '__other' : form.source}
                  onChange={e => {
                    const v = e.target.value;
                    setOtherSource(v === '__other');
                    setForm(f => ({ ...f, source: v === '__other' ? '' : v }));
                  }}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Source…</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  <option value="__other">Other</option>
                </select>
                {otherSource && (
                  <input autoFocus value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    className="mt-2 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
                )}
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Notes</span>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAdding(false)} disabled={saving} className="px-3 py-2 rounded-lg text-sm bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]">Cancel</button>
              <button onClick={addApplicant} disabled={saving || !form.name.trim()} className="px-3.5 py-2.5 rounded-[10px] text-[13.5px] font-semibold bg-[var(--color-ink)] text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One applicant: the call line, and everything they answered when opened.
function RowGroup({ a, open, positions, onToggle, onStage, onNotes, onRemove, onPosition }) {
  const [note, setNote] = useState(a.notes || '');
  useEffect(() => { setNote(a.notes || ''); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The note box grows with what is written. A fixed height hid the end of
  // longer notes behind an inner scrollbar, which reads as the note being cut.
  const noteBox = useRef(null);
  useEffect(() => {
    const el = noteBox.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [note]);
  const answers = Object.entries(a.answers || {});
  return (
    <>
      <tr className="border-b border-[var(--color-line-soft)] hover:bg-[var(--color-fill)]">
        <td className="px-4 py-3 align-top">
          <span className="flex items-center gap-1.5">
            <button onClick={onToggle} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink-soft)]">
              {open ? <ChevronDown size={14} className="text-[var(--color-ink-faint)]" /> : <ChevronRight size={14} />}
            </button>
            <Link to={`/recruitment/applicants/${a.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{a.name}</Link>
            {a.cv && <FileText size={13} className="text-[var(--color-ink-faint)]" title="CV on file" />}
          </span>
        </td>
        <td className="px-4 py-3 align-top">
          {a.phoneValid === false
            ? <span className="text-[var(--color-stage-out)] text-xs">No usable number</span>
            : <a href={`tel:${String(a.phone || '').replace(/\s/g, '')}`} className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">{a.phone || '—'}</a>}
        </td>
        <td className="px-4 py-3 align-top">
          {a.startNow === true ? <span className="px-2 py-0.5 rounded-md bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)] text-xs font-medium">Yes</span>
            : a.startNow === false ? <span className="px-2 py-0.5 rounded-md bg-[var(--color-fill)] text-[var(--color-ink-soft)] text-xs">No</span>
              : <span className="text-[var(--color-ink-faint)] text-xs">—</span>}
        </td>
        {/* Shown whole, not clipped: this answer is what the decision is made
            on, and clipping it meant opening every row to read one sentence. */}
        <td className="px-4 py-3 align-top max-w-lg">
          <span className="text-[var(--color-ink-soft)] text-xs whitespace-pre-wrap break-words">{a.experience || '—'}</span>
        </td>
        <td className="px-4 py-3 align-top whitespace-nowrap">
          <span className="text-[var(--color-ink-soft)] text-xs">{shortDate(a.createdAt)}</span>
        </td>
        {/* Note is written here, in the row, so a called applicant looks
            different from one nobody has touched. Saves when you click away. */}
        <td className="px-4 py-3 align-top">
          <textarea ref={noteBox} value={note} rows={2} placeholder="Add a note"
            onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (a.notes || '') && onNotes(a, note)}
            className="w-52 min-h-[2.75rem] overflow-hidden text-xs text-[var(--color-ink-soft)] rounded-lg px-2 py-1.5 bg-transparent border border-transparent hover:border-[var(--color-line)] focus:bg-white focus:border-[var(--color-line)] focus:outline-none resize-none placeholder:text-[var(--color-ink-faint)]" />
        </td>
        <td className="px-4 py-3 align-top">
          <select value={a.stage} onChange={e => onStage(a, e.target.value)} className="text-xs border border-[var(--color-line)] rounded-lg px-2 py-1.5 bg-white">
            {STAGES.map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}
          </select>
        </td>
        <td className="px-4 py-3 text-right align-top">
          <button onClick={() => onRemove(a)} title="Remove" className="p-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]"><Trash2 size={14} /></button>
        </td>
      </tr>
      {open && (
        <tr className="bg-[var(--color-fill)] border-b border-[var(--color-line-soft)]">
          <td colSpan={8} className="px-10 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                {answers.length === 0 && <p className="text-xs text-[var(--color-ink-faint)]">No answers on this record.</p>}
                {answers.map(([q, v]) => (
                  <div key={q}>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">{q}</p>
                    <p className="text-sm text-[var(--color-ink)]">{v}</p>
                  </div>
                ))}
                <p className="text-[11px] text-[var(--color-ink-faint)] pt-1">
                  {[a.email, a.dob, a.source, a.form,
                    a.appliedAt ? `Applied ${fullDate(a.appliedAt)}` : '',
                    `Added ${fullDate(a.createdAt)}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Position</p>
                <select value={a.positionId || ''} onChange={e => onPosition(a, e.target.value)}
                  className="mt-1 mb-4 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Not filed</option>
                  {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-ink-faint)]">Notes</p>
                <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (a.notes || '') && onNotes(a, note)} rows={4}
                  className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-sm bg-white" />
                <Link to={`/recruitment/applicants/${a.id}`} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-ink)] hover:underline">
                  <ClipboardCheck size={15} /> Open profile and interview
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
