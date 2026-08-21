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
          <h3 className="t-card text-[var(--color-ink)]">New interviews</h3>
          <label className="block">
            <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Questions</span>
            <select value={settings.defaultTemplateId || ''} onChange={e => save({ defaultTemplateId: e.target.value })}
              className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px] bg-white">
              <option value="">Whichever set is marked default</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Interviewer</span>
            <input value={interviewer} onChange={e => setInterviewer(e.target.value)} onBlur={() => interviewer !== (settings.defaultInterviewer || '') && save({ defaultInterviewer: interviewer })}
              placeholder="Left blank, whoever books it is put down"
              className="mt-1 w-full border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px]" />
          </label>
          {saved && <p className="text-[12px] text-[var(--color-stage-hired)]">Saved</p>}
          <p className="text-[12px] text-[var(--color-ink-faint)]">
            Questions are edited in <Link to="/recruitment/templates" className="text-[var(--color-ink-soft)] underline">Templates</Link>.
          </p>
        </div>

        <div className={`${CARD} p-5`}>
          <h3 className="t-card text-[var(--color-ink)] mb-4">Stages</h3>
          <ol className="space-y-2">
            {STAGES.map(([k, label, , dot], i) => (
              <li key={k} className="flex items-center gap-3">
                <span className="w-5 text-[12px] font-semibold text-[var(--color-ink-faint)]">{i + 1}</span>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-[13px] text-[var(--color-ink)]">{label}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] text-[var(--color-ink-faint)]">A completed interview moves the applicant to Interviewed unless a later decision is already recorded.</p>
        </div>
      </div>
    </div>
  );
}
