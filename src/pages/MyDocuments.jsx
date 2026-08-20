import { useEffect, useState } from 'react'
import { Download, FolderOpen } from 'lucide-react'
import { api, getToken } from '../lib/api.js'
import { Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'

// Staff self-view — the signed-in person's OWN documents (CV, contract, ID,
// certificates). Read-only; HR uploads from the staff profile. Self-scoped on the
// server (/api/my/file), so no one ever sees another person's files here.

const DOC_LABEL = { cv: 'CV', contract: 'Contract', id: 'ID', warning: 'Warning', general: 'Document' }

function dateLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MyDocuments() {
  const [docs, setDocs] = useState(null)

  useEffect(() => {
    api('/my/file').then((d) => setDocs(d.documents || [])).catch(() => setDocs([]))
  }, [])

  if (!docs) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[27px]">Documents</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Your CV, contract, ID and certificates.</p>
      </div>

      <SectionTitle>My documents</SectionTitle>
      {docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">No documents on file yet.</Card>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-soft)]" style={{ background: 'var(--color-line-soft)' }}>
                <FolderOpen size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-[var(--color-ink)]">{d.name}</div>
                <div className="text-xs text-[var(--color-ink-faint)]">
                  <Pill tone="neutral">{DOC_LABEL[d.category] || 'Document'}</Pill>
                  <span className="ml-2">{dateLabel(d.uploadedAt)}</span>
                </div>
              </div>
              <a href={`/api/agent-files/${d.id}/download?t=${getToken()}`} target="_blank" rel="noopener noreferrer"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-line-soft)] hover:text-[var(--color-ink)]" title="Download">
                <Download size={18} />
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
