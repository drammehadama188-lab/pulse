import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { STAGES } from './stages.js';
import { CARD, PageHead } from './ui.jsx';

// What a new interview starts on. Small on purpose — the questions themselves
// live in Templates and the stages are the hiring process, not a preference.

export default function Settings() {
  const [settings, setSettings] = useState({ defaultTemplateId: '', defaultInterviewer: '' });
  const [templates, setTemplates] = useState([]);
  const [saved, setSaved] = useState(false);
  const [interviewer, setInterviewer] = useState('');

  useEffect(() => {
    api('/recruitment-settings').then(d => { setSettings(d.settings); setInterviewer(d.settings.defaultInterviewer || ''); }).catch(() => {});
    api('/interview-templates').then(d => setTemplates(d.templates || [])).catch(() => {});
  }, []);

  async function save(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await api('/recruitment-settings', { method: 'PUT', body: patch }); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch { /* shown by the value snapping back on reload */ }
  }

  return (
    <div>
      <PageHead title="Settings" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className={`${CARD} p-5 space-y-4`}>
          <h3 className="text-sm font-bold text-gray-900">New interviews</h3>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Questions</span>
            <select value={settings.defaultTemplateId || ''} onChange={e => save({ defaultTemplateId: e.target.value })}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Whichever set is marked default</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">Interviewer</span>
            <input value={interviewer} onChange={e => setInterviewer(e.target.value)} onBlur={() => interviewer !== (settings.defaultInterviewer || '') && save({ defaultInterviewer: interviewer })}
              placeholder="Left blank, whoever books it is put down"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          {saved && <p className="text-xs text-emerald-600">Saved</p>}
          <p className="text-xs text-gray-400">
            Questions are edited in <Link to="/recruitment/templates" className="text-gray-700 underline">Templates</Link>.
          </p>
        </div>

        <div className={`${CARD} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-4">Stages</h3>
          <ol className="space-y-2">
            {STAGES.map(([k, label, , dot], i) => (
              <li key={k} className="flex items-center gap-3">
                <span className="w-5 text-xs font-bold text-gray-300">{i + 1}</span>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-sm text-gray-800">{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-gray-400">A completed interview moves the applicant to Interviewed unless a later decision is already recorded.</p>
        </div>
      </div>
    </div>
  );
}
