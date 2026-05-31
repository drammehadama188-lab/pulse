import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Phone, ChevronRight, Users, Trophy, Wallet, Search } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, StatCard } from '../../components/ui.jsx'
import { CUSTOMER_STATUS, STATUS_TONE } from '../../lib/salesOptions.js'
import { dalasi } from '../../lib/format.js'
import CustomerForm, { EMPTY_CUSTOMER } from './CustomerForm.jsx'

const FILTERS = ['All', 'Active', 'Won', ...CUSTOMER_STATUS.filter((s) => s !== 'Won')]
const ACTIVE = (s) => !['Won', 'Lost', 'Not Available'].includes(s)

export default function Sales() {
  const { user, isViewAs } = useAuth()
  const [customers, setCustomers] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('All')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { customers } = await api('/customers')
    setCustomers(customers)
  }
  useEffect(() => {
    load()
  }, [isViewAs])

  const stats = useMemo(() => {
    const list = customers || []
    return {
      total: list.length,
      won: list.filter((c) => c.status === 'Won').length,
      pipeline: list.filter((c) => ACTIVE(c.status)).reduce((s, c) => s + (Number(c.amountExpected) || 0), 0),
    }
  }, [customers])

  const shown = useMemo(() => {
    let list = customers || []
    if (filter === 'Active') list = list.filter((c) => ACTIVE(c.status))
    else if (filter !== 'All') list = list.filter((c) => c.status === filter)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((c) => [c.company, c.contact, c.phone, c.segment].filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    return list
  }, [customers, q, filter])

  async function addCustomer(values) {
    setBusy(true)
    try {
      await api('/customers', { method: 'POST', body: values })
      setAdding(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Customers</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{isViewAs ? `${user.name}'s` : 'Your'} prospects &amp; customers.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Users} tone="brand" label="Customers" value={stats.total} />
        <StatCard icon={Trophy} tone="good" label="Won" value={stats.won} />
        <StatCard icon={Wallet} tone="warn" label="Pipeline" value={dalasi(stats.pipeline)} />
      </div>

      {customers === null ? (
        <div className="flex justify-center py-16"><Spinner size={26} /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search customers…"
                className="focus-ring w-full rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 outline-none placeholder:text-[var(--color-ink-faint)]"
              />
            </div>
            {!isViewAs && (
              <Button icon={Plus} className="shrink-0" onClick={() => setAdding(true)}>
                Add
              </Button>
            )}
          </div>

          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filter === f ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
              >
                {f}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Card className="px-5 py-12 text-center text-[var(--color-ink-faint)]">No customers match.</Card>
          ) : (
            <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
              {shown.map((c) => (
                <Link key={c.id} to={`/sales/c/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--color-line-soft)] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[var(--color-ink)]">{c.company}</span>
                      <Pill tone={STATUS_TONE[c.status] || 'neutral'}>{c.status}</Pill>
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--color-ink-faint)]">
                      {[c.segment, c.contact].filter(Boolean).join(' · ')}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </div>
                  </div>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
                      <Phone size={16} />
                    </a>
                  )}
                  <ChevronRight size={18} className="text-[var(--color-ink-faint)]" />
                </Link>
              ))}
            </Card>
          )}
        </div>
      )}

      {adding && <CustomerForm initial={EMPTY_CUSTOMER} title="Add customer" onClose={() => setAdding(false)} onSave={addCustomer} busy={busy} />}
    </div>
  )
}
