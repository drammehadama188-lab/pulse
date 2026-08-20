import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, Upload, Download, ClipboardCheck } from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { STAGES } from './stages.js';
import { CARD, BTN_LIGHT, BTN_DARK, fullDate, dayTime, StageChip, scoreTone, scoreWord } from './ui.jsx';

// One applicant, everything about them in one place: what they answered, their
// CV, every interview they sat, and how they moved through the stages.

const TABS = [['overview', 'Overview'], ['cv', 'CV'], ['interviews', 'Interviews'], ['notes', 'Notes'], ['activity', 'Activity']];

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5 break-words">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  );
}

export default function Applicant() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState(null);
  const [positions, setPositions] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [starting, setStarting] = useState(false);
  const cvRef = useRef(null);

  function load() {
    api('/applicants')
      .then(d => {
        const found = (d.applicants || []).find(x => x.id === id) || null;
        setA(found);
        setNote(found?.notes || '');
      })
      .catch(() => setA(null))
      .finally(() => setLoading(false));
    api(`/interviews?applicantId=${id}`).then(d => setInterviews(d.interviews || [])).catch(() => setInterviews([]));
  }
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api('/positions').then(d => setPositions(d.positions || [])).catch(() => setPositions([]));
    api('/interview-templates').then(d => setTemplates(d.templates || [])).catch(() => setTemplates([]));
  }, []);

  async function save(patch) {
    setA(x => ({ ...x, ...patch }));
    try { await api(`/applicants/${id}`, { method: 'PUT', body: patch }); } catch { load(); }
  }

  async function uploadCv(file) {
    if (!file) return;
    setUploading(true); setUploadError(null);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',').pop());
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const { cv } = await api(`/applicants/${id}/cv`, { method: 'POST', body: { name: file.name, mimeType: file.type, base64 } });
      setA(x => ({ ...x, cv }));
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
      if (cvRef.current) cvRef.current.value = '';
    }
  }

  async function startInterview(templateId) {
    setStarting(true);
    try {
      const { interview } = await api('/interviews', { method: 'POST', body: { applicantId: id, templateId } });
      navigate(`/recruitment/interviews/${interview.id}`);
    } catch (e) {
      setUploadError(e.message);
      setStarting(false);
    }
  }

  // The CV is fetched by the browser itself, so the session token rides in the
  // query the same way the staff-file download does.
  const cvUrl = useMemo(() => (a?.cv ? `/api/applicants/${id}/cv?t=${encodeURIComponent(getToken() || '')}` : null), [a?.cv, id]);
  const answers = Object.entries(a?.answers || {});
  const position = positions.find(p => p.id === a?.positionId);

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!a) return (
    <div className={`${CARD} p-12 text-center text-sm text-gray-400`}>
      That applicant is not on the list. <Link to="/recruitment/applicants" className="text-gray-900 underline">Back to applicants</Link>
    </div>
  );

  return (
    <div>
      <Link to="/recruitment/applicants" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={15} /> Applicants
      </Link>

      <div className={`${CARD} p-5 mb-5`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gray-900 text-lg font-bold text-white">
              {(a.name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{a.name}</h1>
              <p className="text-sm text-gray-500">{position?.title || a.role || 'No position filed'}</p>
              <div className="mt-2 flex items-center gap-4 flex-wrap text-sm text-gray-600">
                {a.phoneValid === false
                  ? <span className="text-red-500 text-xs">No usable number</span>
                  : a.phone && <a href={`tel:${String(a.phone).replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-gray-900"><Phone size={14} /> {a.phone}</a>}
                {a.email && <span className="flex items-center gap-1.5"><Mail size={14} /> {a.email}</span>}
                <StageChip stage={a.stage} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select value={a.stage} onChange={e => save({ stage: e.target.value })}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white">
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button onClick={() => startInterview(templates.find(t => t.isDefault)?.id)} disabled={starting || !templates.length} className={`${BTN_DARK} disabled:opacity-50`}>
              <ClipboardCheck size={16} /> {starting ? 'Starting…' : 'Start interview'}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-1 border-b border-gray-200">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}{k === 'interviews' && interviews.length ? ` (${interviews.length})` : ''}
          </button>
        ))}
      </div>

      {uploadError && <p className="mb-4 text-sm text-red-600">{uploadError}</p>}

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className={`${CARD} lg:col-span-2 p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-4">What they answered</h3>
            {answers.length === 0 && <p className="text-sm text-gray-400">Nothing on this record. It was added by hand, not imported from a form.</p>}
            <div className="space-y-4">
              {answers.map(([q, v]) => (
                <div key={q}>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{q}</p>
                  <p className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <div className={`${CARD} p-5 space-y-4`}>
            <h3 className="text-sm font-bold text-gray-900">Summary</h3>
            <Detail label="Can start now" value={a.startNow === true ? 'Yes' : a.startNow === false ? 'No' : ''} />
            <Detail label="Applied" value={fullDate(a.appliedAt)} />
            <Detail label="Added" value={fullDate(a.createdAt)} />
            <Detail label="Source" value={[a.source, a.form].filter(Boolean).join(' · ')} />
            <Detail label="Date of birth" value={a.dob} />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Position</p>
              <select value={a.positionId || ''} onChange={e => save({ positionId: e.target.value })}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Not filed</option>
                {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'cv' && (
        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900">{a.cv ? a.cv.name : 'No CV on file'}</h3>
              {a.cv && <p className="text-xs text-gray-400 mt-0.5">{Math.round(a.cv.sizeBytes / 1024)} KB · added {fullDate(a.cv.uploadedAt)} by {a.cv.uploadedBy}</p>}
            </div>
            <div className="flex items-center gap-2">
              {a.cv && <a href={`${cvUrl}&download=1`} className={BTN_LIGHT}><Download size={16} /> Download</a>}
              <label className={`${BTN_LIGHT} cursor-pointer`}>
                <Upload size={16} /> {uploading ? 'Uploading…' : a.cv ? 'Replace' : 'Upload CV'}
                <input ref={cvRef} type="file" className="sr-only" onChange={e => uploadCv(e.target.files?.[0])} />
              </label>
            </div>
          </div>
          {a.cv ? (
            String(a.cv.mimeType).startsWith('image/')
              ? <img src={cvUrl} alt={a.cv.name} className="max-h-[70vh] rounded-xl border border-gray-100" />
              : <iframe title="CV" src={cvUrl} className="w-full h-[70vh] rounded-xl border border-gray-100" />
          ) : (
            <p className="text-sm text-gray-400 py-10 text-center">Upload the CV and it opens here beside the interview questions.</p>
          )}
        </div>
      )}

      {tab === 'interviews' && (
        <div className="space-y-3">
          {interviews.length === 0 && (
            <div className={`${CARD} p-10 text-center`}>
              <p className="text-sm text-gray-400 mb-4">No interview yet.</p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {templates.map(t => (
                  <button key={t.id} onClick={() => startInterview(t.id)} disabled={starting} className={BTN_LIGHT}>{t.name}</button>
                ))}
              </div>
            </div>
          )}
          {interviews.map(i => (
            <Link key={i.id} to={`/recruitment/interviews/${i.id}`} className={`${CARD} flex items-center justify-between gap-4 p-4 hover:border-gray-300`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{i.templateName}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {dayTime(i.scheduledAt)}{i.interviewer ? ` · ${i.interviewer}` : ''} · {i.status === 'completed' ? 'Completed' : i.status === 'in_progress' ? 'In progress' : 'Scheduled'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-xl font-extrabold ${scoreTone(i.totalScore)}`}>{i.totalScore ?? '—'}</p>
                <p className="text-[11px] text-gray-400">{i.answered}/{i.totalQuestions} scored</p>
              </div>
            </Link>
          ))}
          {interviews.length > 0 && (
            <button onClick={() => startInterview(templates.find(t => t.isDefault)?.id)} disabled={starting} className={BTN_LIGHT}>
              <ClipboardCheck size={16} /> Start another interview
            </button>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className={`${CARD} p-5`}>
          <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (a.notes || '') && save({ notes: note })}
            rows={12} placeholder="What was said on the call, who referred them, anything you want to remember."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
        </div>
      )}

      {tab === 'activity' && (
        <div className={`${CARD} p-5`}>
          <ol className="space-y-4">
            {[...(a.history || [])].reverse().map((h, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                <div>
                  <StageChip stage={h.stage} />
                  <p className="text-xs text-gray-400 mt-1">{dayTime(h.at)} · {h.by}</p>
                </div>
              </li>
            ))}
            {(a.history || []).length === 0 && <p className="text-sm text-gray-400">Nothing recorded yet.</p>}
          </ol>
        </div>
      )}

      {tab === 'interviews' && interviews.some(i => i.status === 'completed') && (
        <p className="mt-4 text-xs text-gray-400">
          {interviews.filter(i => i.status === 'completed').map(i => `${i.templateName}: ${i.totalScore} (${scoreWord(i.totalScore)})`).join(' · ')}
        </p>
      )}
    </div>
  );
}
