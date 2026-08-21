import { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Download, Trash2, Plus, Mail, FileSignature, Pencil } from 'lucide-react';
import { getToken } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Pulse API is token-authenticated (the founder app had none). Wrap fetch to
// attach the bearer token so these calls pass Pulse's auth middleware.
const authFetch = (u, o = {}) => globalThis.fetch(u, { ...o, headers: { ...(o.headers || {}), Authorization: `Bearer ${getToken()}` } });

const CATEGORY_LABELS = {
  'monthly-review': 'Monthly Review',
  'coaching': 'Coaching Letter',
  'warning': 'Warning',
  'contract': 'Contract',
  'cv': 'CV',
  'id': 'ID Document',
  'general': 'General',
};

const CATEGORY_COLORS = {
  'monthly-review': 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]',
  'coaching': 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]',
  'warning': 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]',
  'contract': 'bg-[var(--color-good-bg)] text-[var(--color-good)]',
  'cv': 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]',
  'id': 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]',
  'general': 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]',
};

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AgentFiles({ agentName, agentEmail, generateReviewFn, defaultCategory = 'general' }) {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pickedCategory, setPickedCategory] = useState(defaultCategory);
  const [editing, setEditing] = useState(null); // { id, name, category }
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef(null);
  // Edit and delete are separate permissions (HR power sub-toggles; CEO always).
  // Follows the VIEWED user under view-as — faithful to their exact screen.
  const canEdit = !!user?.canDocsEdit;
  const canDelete = !!user?.canDocsDelete;

  async function saveEdit() {
    setSavingEdit(true);
    try {
      const res = await authFetch(`/api/agent-files/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editing.name, category: editing.category }),
      }).then(r => r.json());
      if (res.file) setFiles(prev => prev.map(f => (f.id === res.file.id ? res.file : f)));
      setEditing(null);
    } catch (e) {}
    setSavingEdit(false);
  }

  useEffect(() => {
    if (!agentName) return;
    authFetch(`/api/agent-files?agent=${encodeURIComponent(agentName)}`)
      .then(r => r.json())
      .then(d => setFiles(d.files || []))
      .catch(() => setFiles([]));
  }, [agentName]);

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await authFetch('/api/agent-files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: agentName, name: file.name, mimeType: file.type,
            base64: reader.result, category: pickedCategory,
          }),
        }).then(r => r.json());
        if (res.file) setFiles(prev => [res.file, ...prev]);
      } catch(err) {}
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  }

  async function deleteFile(id) {
    if (!confirm('Delete this file? This cannot be undone.')) return;
    try {
      await authFetch(`/api/agent-files/${id}`, { method: 'DELETE' });
      setFiles(prev => prev.filter(f => f.id !== id));
    } catch(e) {}
  }

  async function generateReview() {
    if (!generateReviewFn) return;
    const { period, text } = generateReviewFn();
    if (!text) return;
    setGenerating(true);
    try {
      const res = await authFetch('/api/agent-files/generate-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, period, reviewText: text, category: 'monthly-review' }),
      }).then(r => r.json());
      if (res.file) setFiles(prev => [res.file, ...prev]);
    } catch(e) {}
    setGenerating(false);
  }

  function emailFile(file) {
    // Open mail client with subject pre-filled. User attaches the downloaded file manually.
    const subject = encodeURIComponent(`${file.name} — for your records`);
    const body = encodeURIComponent(`Hi ${agentName.split(' ')[0]},\n\nPlease find your ${CATEGORY_LABELS[file.category] || 'document'} attached.\n\n— Damia\n\n(Download from: http://localhost:4000/ then attach manually, or use the in-app download then attach.)`);
    const to = agentEmail ? encodeURIComponent(agentEmail) : '';
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  return (
    <div className="bg-white rounded-lg border border-[var(--color-line-soft)] p-5 mb-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-[var(--color-ink-faint)]" />
          <h2 className="text-[var(--color-ink)] font-semibold">Files & Documents</h2>
          <span className="text-[11px] text-[var(--color-ink-faint)] ml-1">{files.length}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {generateReviewFn && (
            <button
              onClick={generateReview}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-2 text-[11.5px] font-medium bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white rounded-full disabled:bg-[var(--color-ink-faint)]"
            >
              <FileSignature size={12} /> {generating ? 'Generating…' : 'Generate review'}
            </button>
          )}
          <select
            value={pickedCategory}
            onChange={e => setPickedCategory(e.target.value)}
            className="text-[11.5px] border border-[var(--color-line)] rounded-full px-3 py-1.5 focus:outline-none focus:border-[var(--color-ink-faint)]"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1.5 px-3 py-2 text-[11.5px] font-medium bg-white border border-[var(--color-line)] hover:border-[var(--color-line)] text-[var(--color-ink-soft)] rounded-full cursor-pointer">
            <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
            <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
          </label>
        </div>
      </div>

      {files.length === 0 ? (
        <p className="text-[var(--color-ink-faint)] text-[13px]">No files yet. Upload contracts, IDs, signed warnings, or click "Generate review" to save this period's review as a file.</p>
      ) : (
        <div className="space-y-2">
          {files.map(f => (
            editing?.id === f.id ? (
              <div key={f.id} className="flex flex-wrap items-center gap-2 p-3 bg-[var(--color-fill)] rounded-lg">
                <input
                  value={editing.name}
                  onChange={e => setEditing(s => ({ ...s, name: e.target.value }))}
                  className="flex-1 min-w-[180px] text-[13px] border border-[var(--color-line)] rounded-lg px-3 py-2"
                />
                <select
                  value={editing.category}
                  onChange={e => setEditing(s => ({ ...s, category: e.target.value }))}
                  className="text-[11.5px] border border-[var(--color-line)] rounded-full px-3 py-2"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button onClick={saveEdit} disabled={savingEdit || !editing.name.trim()}
                  className="px-3 py-2 text-[11.5px] font-medium bg-[var(--color-ink)] hover:bg-[var(--color-ink)] text-white rounded-full disabled:bg-[var(--color-ink-faint)]">
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(null)} disabled={savingEdit}
                  className="px-3 py-2 text-[11.5px] font-medium bg-[var(--color-fill)] hover:bg-[var(--color-line)] text-[var(--color-ink-soft)] rounded-full">
                  Cancel
                </button>
              </div>
            ) : (
            <div key={f.id} className="flex items-center gap-3 p-3 bg-[var(--color-fill)] rounded-lg group">
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                <FileText size={14} className="text-[var(--color-ink-soft)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] text-[var(--color-ink)] font-medium truncate">{f.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORY_COLORS[f.category] || 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>
                    {CATEGORY_LABELS[f.category] || f.category}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--color-ink-faint)] mt-0.5">
                  {formatDate(f.uploadedAt)} · {formatSize(f.sizeBytes)} · by {f.uploadedBy || 'Damia'}{f.editedBy ? ` · edited by ${f.editedBy}` : ''}
                </p>
              </div>
              <a href={`/api/agent-files/${f.id}/download?t=${getToken()}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] rounded-full hover:bg-white">
                <Download size={14} />
              </a>
              <button onClick={() => emailFile(f)}
                className="flex items-center gap-1 p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] rounded-full hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Email this to the agent">
                <Mail size={14} />
              </button>
              {canEdit && (
                <button onClick={() => setEditing({ id: f.id, name: f.name, category: f.category || 'general' })}
                  title="Edit name or type"
                  className="flex items-center gap-1 p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] rounded-full hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil size={14} />
                </button>
              )}
              {canDelete && (
                <button onClick={() => deleteFile(f.id)}
                  className="flex items-center gap-1 p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)] rounded-full hover:bg-[var(--color-bad-bg)] opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
