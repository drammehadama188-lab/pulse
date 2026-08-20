import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Trash2, X, Upload, ClipboardPaste, MoreVertical, Phone, Mail, Download,
  ChevronLeft, ChevronRight, Search, FileText, Star,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { STAGES, STAGE_TABS, DROPPED, CONTACT, CONTACT_LABEL, SCREENING, SCREENING_META, NEXT_STAGE } from './stages.js';
import { CARD, BTN_LIGHT, BTN_PRIMARY, PageHead, StageChip, ago, fullDate, shortDate, dayTime } from './ui.jsx';

// Applicants — the whole pile, and one person at a time in the panel beside
// it. This is both the call sheet and the profile list: they were the same
// thing (Adama, 20 Aug), so there is one page, not two.
//
// 19 Aug lessons kept intact: the import takes the CSV whole, the file input
// is a real <label> with no accept filter, and answers are SHOWN, never graded.

const BLANK = { name: '', role: '', email: '', phone: '', source: '', notes: '', positionId: '' };
const SOURCES = ['Ads', 'WhatsApp', 'Referral', 'Walk-in', 'Recruitment agency', 'Email'];
const PAGE_SIZES = [10, 25, 50, 100];
const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export default function Applicants() {
  const [applicants, setApplicants] = useState([]);
  const [positions, setPositions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [otherSource, setOtherSource] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [importing, setImporting] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [bulkNote, setBulkNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const fileRef = useRef(null);

  // Filters live in the URL so the dashboard and the positions page can link
  // straight into a filtered list.
  const tab = params.get('stage') || 'all';
  const positionFilter = params.get('position') || '';
  const contactFilter = params.get('contact') || '';
  const availFilter = params.get('avail') || '';
  const sourceFilter = params.get('source') || '';
  const query = params.get('q') || '';
  const setParam = (k, v) => setParams(prev => {
    const n = new URLSearchParams(prev);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });

  function load() {
    setLoading(true);
    api('/applicants').then(d => setApplicants(d.applicants || [])).catch(() => setApplicants([])).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    api('/positions').then(d => setPositions(d.positions || [])).catch(() => setPositions([]));
    api('/interviews').then(d => setInterviews(d.interviews || [])).catch(() => setInterviews([]));
  }, []);
  useEffect(() => { setPage(1); }, [tab, positionFilter, contactFilter, availFilter, sourceFilter, query, pageSize]);

  async function patch(a, body) {
    setApplicants(list => list.map(x => x.id === a.id ? { ...x, ...body } : x));
    try { await api(`/applicants/${a.id}`, { method: 'PUT', body }); } catch { load(); }
  }
  async function bulkPatch(body) {
    const ids = [...selected];
    if (!ids.length) return;
    try { await api('/applicants/bulk', { method: 'PATCH', body: { ids, ...body } }); }
    finally { setSelected(new Set()); setBulkNote(false); setNoteText(''); load(); }
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} applicant${ids.length > 1 ? 's' : ''} from recruitment? This cannot be undone.`)) return;
    try { await api('/applicants/bulk-delete', { method: 'POST', body: { ids } }); }
    finally { setSelected(new Set()); load(); }
  }
  async function addApplicant() {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await api('/applicants', { method: 'POST', body: form }); setForm(BLANK); setAdding(false); load(); }
    catch { /* ignore */ } finally { setSaving(false); }
  }
  async function remove(a) {
    if (!window.confirm(`Remove ${a.name} from recruitment?`)) return;
    setApplicants(list => list.filter(x => x.id !== a.id));
    if (openId === a.id) setOpenId(null);
    try { await api(`/applicants/${a.id}`, { method: 'DELETE' }); } catch { load(); }
  }
  // The file goes in exactly as downloaded from Meta — no spreadsheet step.
  async function importText(csv, label) {
    setImporting(label); setImportError(null); setImportResult(null);
    try {
      const r = await api('/applicants/import', { method: 'POST', body: { csv, role: 'Sales Agent' } });
      setImportResult(r);
      setParam('stage', 'new');
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

  const positionOf = (a) => positions.find(p => p.id === a.positionId)
    || positions.find(p => !a.positionId && p.title && p.title.toLowerCase() === String(a.role || '').toLowerCase());

  const counts = useMemo(() => {
    const c = { all: applicants.length };
    for (const [key, , keys] of STAGE_TABS) c[key] = applicants.filter(a => keys.includes(a.stage)).length;
    return c;
  }, [applicants]);

  const filtered = useMemo(() => {
    const keys = STAGE_TABS.find(([k]) => k === tab)?.[2];
    const q = query.trim().toLowerCase();
    return applicants.filter(a => {
      if (keys && !keys.includes(a.stage)) return false;
      if (positionFilter) {
        const p = positions.find(x => x.id === positionFilter);
        const title = (p?.title || '').toLowerCase();
        if (!(a.positionId === positionFilter || (!a.positionId && title && String(a.role || '').toLowerCase() === title))) return false;
      }
      if (contactFilter && (a.contactStatus || 'not_contacted') !== contactFilter) return false;
      if (availFilter === 'now' && a.startNow !== true) return false;
      if (availFilter === 'later' && a.startNow !== false) return false;
      if (sourceFilter && (a.source || '') !== sourceFilter) return false;
      if (q && !`${a.name || ''} ${a.phone || ''} ${a.email || ''} ${a.role || ''}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (Date.parse(b.appliedAt || b.createdAt || 0) || 0) - (Date.parse(a.appliedAt || a.createdAt || 0) || 0));
  }, [applicants, positions, tab, positionFilter, contactFilter, availFilter, sourceFilter, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const allOnPageSelected = rows.length > 0 && rows.every(a => selected.has(a.id));
  const open = applicants.find(a => a.id === openId) || null;
  const sources = useMemo(() => [...new Set(applicants.map(a => a.source).filter(Boolean))], [applicants]);

  const toggle = (id) => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const field = 'rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 text-[12.5px] text-[var(--color-ink-soft)]';

  return (
    <div className={open ? 'xl:pr-[420px]' : ''}>
      <PageHead title="Applicants" count={applicants.length || null} subtitle="Manage and move applicants through your recruitment pipeline.">
        {/* A label opens the picker itself. Scripting a click on a hidden
            input looked like a working button and did nothing (19 Aug).
            No accept filter either: it greyed out the very file being
            imported, so the picker opened and nothing could be chosen. */}
        <label className={`${BTN_LIGHT} cursor-pointer`}>
          <Upload size={15} /> Import list
          <input ref={fileRef} type="file" className="sr-only" onChange={e => importFile(e.target.files?.[0])} />
        </label>
        <button onClick={() => { setPasted(''); setImportError(null); setPasting(true); }} className={BTN_LIGHT}>
          <ClipboardPaste size={15} /> Paste rows
        </button>
        <button onClick={() => { setForm(BLANK); setOtherSource(false); setAdding(true); }} className={BTN_PRIMARY}>
          <Plus size={15} /> Add applicant
        </button>
      </PageHead>

      {(importing || importResult || importError) && (
        <div className={`${CARD} mb-4 p-4`}>
          {importing && <p className="text-[13px] text-[var(--color-ink-soft)]">Reading {importing}…</p>}
          {importError && <p className="text-[13px] text-[var(--color-stage-out)]">{importError}</p>}
          {importResult && (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-[var(--color-ink)]">
                  <span className="font-semibold">{importResult.added} added</span>
                  {importResult.rows > 0 && <span className="text-[var(--color-ink-soft)]"> of {importResult.rows} rows</span>}
                  {importResult.duplicates > 0 && <span className="text-[var(--color-ink-soft)]"> · {importResult.duplicates} already on the list</span>}
                  {importResult.noPhone > 0 && <span className="text-[var(--color-ink-soft)]"> · {importResult.noPhone} without a usable phone</span>}
                </p>
                {importResult.reason && <p className="mt-1 text-[13px] text-[var(--color-stage-out)]">{importResult.reason}</p>}
              </div>
              <button onClick={() => setImportResult(null)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X size={15} /></button>
            </div>
          )}
        </div>
      )}

      {/* where they are */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]">
        {[['all', 'All'], ...STAGE_TABS.map(([k, l]) => [k, l])].map(([k, label]) => (
          <button key={k} onClick={() => setParam('stage', k === 'all' ? '' : k)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label} <span className={tab === k ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-faint)]'}>{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* narrowing it down */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={positionFilter} onChange={e => setParam('position', e.target.value)} className={field}>
          <option value="">All positions</option>
          {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select value={contactFilter} onChange={e => setParam('contact', e.target.value)} className={field}>
          <option value="">Contact status</option>
          {CONTACT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={availFilter} onChange={e => setParam('avail', e.target.value)} className={field}>
          <option value="">Availability</option>
          <option value="now">Can start now</option>
          <option value="later">Cannot start now</option>
        </select>
        <select value={sourceFilter} onChange={e => setParam('source', e.target.value)} className={field}>
          <option value="">Source</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="flex-1" />
        <span className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input value={query} onChange={e => setParam('q', e.target.value)} placeholder="Search name, phone, email…"
            className={`${field} w-64 pl-8`} />
        </span>
      </div>

      {loading ? <p className="text-[13px] text-[var(--color-ink-soft)]">Loading…</p>
        : applicants.length === 0 ? (
          <div className={`${CARD} p-12 text-center text-[13px] text-[var(--color-ink-soft)]`}>No applicants yet. Import a list or add the first CV you receive.</div>
        ) : (
          <>
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-line-soft)] text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="w-10 px-4 py-2.5">
                      <input type="checkbox" checked={allOnPageSelected}
                        onChange={() => setSelected(s => {
                          const n = new Set(s);
                          rows.forEach(a => allOnPageSelected ? n.delete(a.id) : n.add(a.id));
                          return n;
                        })}
                        className="accent-[var(--color-brand)]" />
                    </th>
                    <th className="px-4 py-2.5 font-semibold">Candidate</th>
                    <th className="px-4 py-2.5 font-semibold">Position</th>
                    <th className="px-4 py-2.5 font-semibold">Applied</th>
                    <th className="px-4 py-2.5 font-semibold">Availability</th>
                    <th className="px-4 py-2.5 font-semibold">Screening</th>
                    <th className="px-4 py-2.5 font-semibold">Contact</th>
                    <th className="px-4 py-2.5 font-semibold">Stage</th>
                    <th className="w-10 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(a => {
                    const p = positionOf(a);
                    const contact = a.contactStatus || 'not_contacted';
                    const dot = CONTACT.find(([k]) => k === contact)?.[2];
                    const mark = SCREENING_META[a.screening];
                    return (
                      <tr key={a.id}
                        onClick={() => setOpenId(a.id)}
                        className={`cursor-pointer border-b border-[var(--color-line-soft)] last:border-0 hover:bg-[var(--color-fill)] ${openId === a.id ? 'bg-[var(--color-brand-50)]' : ''}`}>
                        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="accent-[var(--color-brand)]" />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[11px] font-semibold text-[var(--color-ink-soft)]">{initials(a.name)}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-[var(--color-ink)]">{a.name}</span>
                              <span className="block truncate text-[11.5px] text-[var(--color-ink-faint)]">
                                {a.phoneValid === false ? 'No usable number' : a.phone || '—'}
                              </span>
                            </span>
                            {a.cv && <FileText size={12} className="shrink-0 text-[var(--color-ink-faint)]" />}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="block text-[var(--color-ink-soft)]">{p?.title || a.role || '—'}</span>
                          {p?.location && <span className="block text-[11.5px] text-[var(--color-ink-faint)]">{p.location}</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <span className="block text-[var(--color-ink-soft)]">{fullDate(a.appliedAt || a.createdAt)}</span>
                          <span className="block text-[11.5px] text-[var(--color-ink-faint)]">{ago(a.appliedAt || a.createdAt)}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {a.startNow === true ? <span className="rounded-md bg-[var(--color-good-bg)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-good)]">Now</span>
                            : a.startNow === false ? <span className="rounded-md bg-[var(--color-fill)] px-2 py-0.5 text-[11.5px] text-[var(--color-ink-soft)]">Later</span>
                              : <span className="text-[var(--color-ink-faint)]">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {mark ? <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${mark.chip}`}><Star size={10} /> {mark.label}</span>
                            : <span className="text-[var(--color-ink-faint)]">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                            <span>
                              <span className="block text-[12px] text-[var(--color-ink-soft)]">{CONTACT_LABEL[contact]}</span>
                              {a.contactedAt && <span className="block text-[11px] text-[var(--color-ink-faint)]">{ago(a.contactedAt)}</span>}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><StageChip stage={a.stage} /></td>
                        <td className="relative px-4 py-2.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setMenuId(menuId === a.id ? null : a.id)} className="rounded-[6px] p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">
                            <MoreVertical size={15} />
                          </button>
                          {menuId === a.id && (
                            <div onMouseLeave={() => setMenuId(null)}
                              className="absolute right-4 top-10 z-30 w-52 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-lift)]">
                              <Link to={`/recruitment/applicants/${a.id}`} className="block rounded-[6px] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-fill)]">Open full profile</Link>
                              <div className="my-1 border-t border-[var(--color-line-soft)]" />
                              {CONTACT.map(([k, l]) => (
                                <button key={k} onClick={() => { patch(a, { contactStatus: k }); setMenuId(null); }}
                                  className="block w-full rounded-[6px] px-3 py-2 text-left text-[12.5px] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]">{l}</button>
                              ))}
                              <div className="my-1 border-t border-[var(--color-line-soft)]" />
                              {SCREENING.map(([k, l]) => (
                                <button key={k} onClick={() => { patch(a, { screening: a.screening === k ? '' : k }); setMenuId(null); }}
                                  className="block w-full rounded-[6px] px-3 py-2 text-left text-[12.5px] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]">
                                  Mark {l.toLowerCase()}{a.screening === k ? ' ✓' : ''}
                                </button>
                              ))}
                              <div className="my-1 border-t border-[var(--color-line-soft)]" />
                              <button onClick={() => { setMenuId(null); remove(a); }}
                                className="block w-full rounded-[6px] px-3 py-2 text-left text-[12.5px] font-semibold text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]">Remove</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-[var(--color-ink-soft)]">Nobody matches those filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[12px] text-[var(--color-ink-soft)]">
                {filtered.length === 0 ? 'Nothing to show' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length}`}
              </span>
              <span className="flex items-center gap-1.5">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="rounded-[8px] border border-[var(--color-line)] p-1.5 text-[var(--color-ink-soft)] disabled:opacity-40"><ChevronLeft size={15} /></button>
                <span className="px-2 text-[12.5px] text-[var(--color-ink-soft)]">Page {page} of {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
                  className="rounded-[8px] border border-[var(--color-line)] p-1.5 text-[var(--color-ink-soft)] disabled:opacity-40"><ChevronRight size={15} /></button>
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className={`${field} ml-2`}>
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n} per page</option>)}
                </select>
              </span>
            </div>
          </>
        )}

      {/* what to do with the ones you ticked */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur md:pl-[216px]">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-2.5 md:px-8">
            <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-[12.5px] font-semibold text-[var(--color-brand)]">Clear</button>
            <span className="flex-1" />
            <select value="" onChange={e => e.target.value && bulkPatch({ stage: e.target.value })} className={field}>
              <option value="">Move stage…</option>
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value="" onChange={e => e.target.value && bulkPatch({ contactStatus: e.target.value })} className={field}>
              <option value="">Contact status…</option>
              {CONTACT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button onClick={() => setBulkNote(true)} className={BTN_LIGHT}>Add note</button>
            <button onClick={bulkDelete} className="rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[13px] font-semibold text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]">Remove</button>
          </div>
        </div>
      )}

      {open && (
        <Drawer
          a={open}
          position={positionOf(open)}
          interviews={interviews.filter(i => i.applicantId === open.id)}
          onClose={() => setOpenId(null)}
          onPatch={(body) => patch(open, body)}
        />
      )}

      {/* Paste route: open the file in Excel or Numbers, select all, paste
          here. Works when a file picker will not cooperate. */}
      {pasting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !importing && setPasting(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-[var(--color-surface)] p-5 shadow-[var(--shadow-lift)]" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="t-card text-[var(--color-ink)]">Paste rows</h3>
              <button onClick={() => setPasting(false)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X size={17} /></button>
            </div>
            <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={12} autoFocus
              placeholder={'full_name\tphone_number\tcan you start immediately\thave you sold anything before'}
              className="w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 font-mono text-[11.5px]" />
            <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">First row must be the column headings.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPasting(false)} disabled={!!importing} className={BTN_LIGHT}>Cancel</button>
              <button onClick={() => importText(pasted, 'Pasted rows')} disabled={!!importing || pasted.trim().split('\n').length < 2} className={`${BTN_PRIMARY} disabled:opacity-50`}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBulkNote(false)}>
          <div className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-5 shadow-[var(--shadow-lift)]" onClick={e => e.stopPropagation()}>
            <h3 className="t-card mb-1 text-[var(--color-ink)]">Add a note to {selected.size} applicant{selected.size > 1 ? 's' : ''}</h3>
            <p className="mb-3 text-[11.5px] text-[var(--color-ink-faint)]">It is added under whatever each of them already has.</p>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} autoFocus
              className="w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[13px]" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setBulkNote(false)} className={BTN_LIGHT}>Cancel</button>
              <button onClick={() => bulkPatch({ appendNote: noteText })} disabled={!noteText.trim()} className={`${BTN_PRIMARY} disabled:opacity-50`}>Add note</button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setAdding(false)}>
          <div className="w-full max-w-md rounded-lg bg-[var(--color-surface)] p-5 shadow-[var(--shadow-lift)]" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="t-card text-[var(--color-ink)]">Add applicant</h3>
              <button onClick={() => setAdding(false)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X size={17} /></button>
            </div>
            <div className="space-y-3">
              {[['name', 'Name *'], ['role', 'Applying for'], ['email', 'Email'], ['phone', 'Phone']].map(([k, label]) => (
                <label key={k} className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
                  <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="mt-1 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[13px]" />
                </label>
              ))}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Position</span>
                <select value={form.positionId} onChange={e => setForm(f => ({ ...f, positionId: e.target.value }))} className="mt-1 w-full rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px]">
                  <option value="">Not filed</option>
                  {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
              {/* Fixed list, so the channels stay countable — typed sources
                  split into "whatsapp", "WhatsApp", "wa" and stop adding up. */}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Source</span>
                <select value={otherSource ? '__other' : form.source}
                  onChange={e => {
                    const v = e.target.value;
                    setOtherSource(v === '__other');
                    setForm(f => ({ ...f, source: v === '__other' ? '' : v }));
                  }}
                  className="mt-1 w-full rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px]">
                  <option value="">Source…</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  <option value="__other">Other</option>
                </select>
                {otherSource && (
                  <input autoFocus value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    className="mt-2 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[13px]" />
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Notes</span>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[13px]" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAdding(false)} disabled={saving} className={BTN_LIGHT}>Cancel</button>
              <button onClick={addApplicant} disabled={saving || !form.name.trim()} className={`${BTN_PRIMARY} disabled:opacity-50`}>{saving ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One applicant beside the list: what they answered, their CV, notes, what has
// happened, and the three decisions you make from here.
function Drawer({ a, position, interviews, onClose, onPatch }) {
  const [tab, setTab] = useState('application');
  const [note, setNote] = useState(a.notes || '');
  useEffect(() => { setNote(a.notes || ''); setTab('application'); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cvUrl = a.cv ? `/api/applicants/${a.id}/cv?t=${encodeURIComponent(getToken() || '')}` : null;
  const answers = Object.entries(a.answers || {});
  const [nextStage, nextLabel] = NEXT_STAGE[a.stage] || [];
  const tel = String(a.phone || '').replace(/\s/g, '');

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)] sm:w-[420px]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line-soft)] p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[13px] font-semibold text-[var(--color-ink-soft)]">{initials(a.name)}</span>
          <div className="min-w-0">
            <Link to={`/recruitment/applicants/${a.id}`} className="block truncate text-[17px] font-semibold text-[var(--color-ink)] hover:underline">{a.name}</Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-ink-soft)]">
              <span>{position?.title || a.role || 'No position filed'}</span>
              <StageChip stage={a.stage} />
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X size={18} /></button>
      </div>

      <div className="space-y-1.5 border-b border-[var(--color-line-soft)] px-5 py-3 text-[12.5px] text-[var(--color-ink-soft)]">
        {a.phoneValid === false
          ? <p className="text-[var(--color-stage-out)]">No usable number</p>
          : a.phone && <a href={`tel:${tel}`} className="flex items-center gap-2 hover:text-[var(--color-ink)]"><Phone size={13} /> {a.phone}</a>}
        {a.email && <p className="flex items-center gap-2 truncate"><Mail size={13} /> {a.email}</p>}
        <p className="text-[11.5px] text-[var(--color-ink-faint)]">
          Applied {fullDate(a.appliedAt || a.createdAt)}{a.source ? ` · ${a.source}` : ''}
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--color-line-soft)] px-3">
        {[['application', 'Application'], ['cv', 'CV'], ['notes', 'Notes'], ['activity', 'Activity']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-2.5 py-2.5 text-[12.5px] font-semibold ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'application' && (
          <div className="space-y-4">
            {answers.length === 0 && <p className="text-[12.5px] text-[var(--color-ink-soft)]">Nothing on this record — added by hand, not from a form.</p>}
            {answers.map(([q, v]) => (
              <div key={q}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{q}</p>
                <p className="mt-1 rounded-[8px] bg-[var(--color-fill)] px-3 py-2 text-[12.5px] text-[var(--color-ink)]">{v}</p>
              </div>
            ))}
            <div className="border-t border-[var(--color-line-soft)] pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Screening</p>
              <div className="mt-2 flex gap-2">
                {SCREENING.map(([k, l]) => (
                  <button key={k} onClick={() => onPatch({ screening: a.screening === k ? '' : k })}
                    className={`rounded-[8px] border px-2.5 py-1.5 text-[12px] font-semibold ${a.screening === k ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand)]' : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'cv' && (
          cvUrl ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-2 rounded-[8px] border border-[var(--color-line)] px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={15} className="shrink-0 text-[var(--color-stage-out)]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-[var(--color-ink)]">{a.cv.name}</span>
                    <span className="block text-[11px] text-[var(--color-ink-faint)]">{Math.round(a.cv.sizeBytes / 1024)} KB</span>
                  </span>
                </span>
                <a href={`${cvUrl}&download=1`} className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Download size={15} /></a>
              </div>
              {String(a.cv.mimeType).startsWith('image/')
                ? <img src={cvUrl} alt="CV" className="w-full rounded-[8px] border border-[var(--color-line)]" />
                : <iframe title="CV" src={cvUrl} className="h-96 w-full rounded-[8px] border border-[var(--color-line)]" />}
            </div>
          ) : (
            <p className="text-[12.5px] text-[var(--color-ink-soft)]">
              No CV on file. <Link to={`/recruitment/applicants/${a.id}/cv`} className="font-semibold text-[var(--color-brand)]">Upload one</Link>
            </p>
          )
        )}

        {tab === 'notes' && (
          <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (a.notes || '') && onPatch({ notes: note })}
            rows={12} placeholder="What was said on the call, who referred them, anything worth remembering."
            className="w-full rounded-[8px] border border-[var(--color-line)] px-3 py-2.5 text-[12.5px]" />
        )}

        {tab === 'activity' && (
          <div className="space-y-4">
            {interviews.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Interviews</p>
                {interviews.map(i => (
                  <Link key={i.id} to={`/recruitment/interviews/${i.id}`} className="mb-2 flex items-center justify-between gap-2 rounded-[8px] border border-[var(--color-line)] px-3 py-2 hover:border-[var(--color-ink-faint)]">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--color-ink)]">{i.templateName}</span>
                      <span className="block text-[11px] text-[var(--color-ink-faint)]">{dayTime(i.scheduledAt)}</span>
                    </span>
                    <span className="text-[13px] font-semibold text-[var(--color-ink)]">{i.totalScore ?? '—'}</span>
                  </Link>
                ))}
              </div>
            )}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Stage history</p>
              <ol className="space-y-3">
                {[...(a.history || [])].reverse().map((h, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-line)]" />
                    <span>
                      <StageChip stage={h.stage} />
                      <span className="mt-1 block text-[11px] text-[var(--color-ink-faint)]">{dayTime(h.at)} · {h.by}</span>
                    </span>
                  </li>
                ))}
                {(a.history || []).length === 0 && <p className="text-[12.5px] text-[var(--color-ink-soft)]">Nothing recorded yet.</p>}
              </ol>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-line-soft)] p-4">
        <div className="mb-2 flex gap-2">
          {CONTACT.map(([k, l]) => (
            <button key={k} onClick={() => onPatch({ contactStatus: k })}
              className={`flex-1 rounded-[8px] border px-2 py-1.5 text-[11.5px] font-semibold ${(a.contactStatus || 'not_contacted') === k ? 'border-[var(--color-brand)] bg-[var(--color-brand-50)] text-[var(--color-brand)]' : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)]'}`}>
              {l.replace('Called, no answer', 'No answer')}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => onPatch({ stage: 'not_qualified' })}
            className="rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-stage-out)] hover:bg-[var(--color-stage-out-bg)]">Not qualified</button>
          {a.phoneValid !== false && a.phone && (
            <a href={`tel:${tel}`} className="rounded-[8px] border border-[var(--color-brand-100)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-brand)] hover:bg-[var(--color-brand-50)]">Call</a>
          )}
          {nextStage && (
            <button onClick={() => onPatch({ stage: nextStage })}
              className="flex-1 rounded-[8px] bg-[var(--color-brand)] px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-brand-600)]">Move to {nextLabel}</button>
          )}
        </div>
      </div>
    </aside>
  );
}
