import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Phone, ChevronRight, Users, Trophy, Wallet, Search } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Button, Card, Pill, Spinner, StatCard } from '../../components/ui.jsx'
import { CUSTOMER_STATUS, STATUS_TONE } from '../../lib/salesOptions.js'
import { dalasi } from '../../lib/format.js'
import CustomerForm, { EMPTY_CUSTOMER } from './CustomerForm.jsx'
import Pager, { usePager } from '../../components/ui/Pager.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'

// Funnel standard (Sally's Excel "Reference Lists" → salesOptions.js):
// a PAID customer is one whose sale is closed — status "Won". Everyone else is
// still pipeline. These two are kept on separate tabs, never mixed.
const PAID = (c) => c.status === 'Won'
const ACTIVE = (s) => !['Won', 'Lost', 'Not Available'].includes(s)
// status chips for the pipeline tab only (Won lives on its own tab)
const FILTERS = ['All', 'Active', ...CUSTOMER_STATUS.filter((s) => s !== 'Won')]

export default function Sales() {
  const { user, isViewAs } = useAuth()
  const [customers, setCustomers] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('All')
  const [tab, setTab] = useState('customers') // 'customers' (pipeline) | 'paid' (Won)
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
    const paid = list.filter(PAID)
    return {
      customers: list.filter((c) => !PAID(c)).length,
      paid: paid.length,
      pipeline: list.filter((c) => ACTIVE(c.status)).reduce((s, c) => s + (Number(c.amountExpected) || 0), 0),
      revenue: paid.reduce((s, c) => s + (Number(c.amountPaid) || Number(c.amountExpected) || 0), 0),
    }
  }, [customers])

  const shown = useMemo(() => {
    let list = customers || []
    // hard split first: paid tab = Won only; customers tab = everything not Won
    list = tab === 'paid' ? list.filter(PAID) : list.filter((c) => !PAID(c))
    if (tab === 'customers') {
      if (filter === 'Active') list = list.filter((c) => ACTIVE(c.status))
      else if (filter !== 'All') list = list.filter((c) => c.status === filter)
    }
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((c) => [c.company, c.contact, c.phone, c.segment].filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    return list
  }, [customers, q, filter, tab])

  const pager = usePager(shown)
  const paged = pager.slice
  // reset to first page whenever the visible set changes
  useEffect(() => { pager.reset() }, [q, filter, tab])

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
    <div className="space-y-7">
      <div>
        <h1 className="t-page">Customers</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{isViewAs ? `${user.name}'s` : 'Your'} prospects &amp; customers.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Users} tone="brand" label="Customers" value={stats.customers} />
        <StatCard icon={Trophy} tone="good" label="Paid" value={stats.paid} />
        <StatCard icon={Wallet} tone="warn" label="Revenue" value={dalasi(stats.revenue)} />
      </div>

      {/* hard split: pipeline customers vs paid (Won) customers */}
      <div className="inline-flex rounded-lg bg-[var(--color-fill)] p-1">
        {[
          { key: 'customers', label: 'Customers', count: stats.customers },
          { key: 'paid', label: 'Paid', count: stats.paid },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${tab === t.key ? 'bg-[var(--color-surface)] text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)]'}`}
          >
            {t.label} <span className="ml-1 text-[var(--color-ink-faint)]">{t.count}</span>
          </button>
        ))}
      </div>

      {customers === null ? (
        <PageSkeleton tiles={4} rows={6} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search customers…"
                className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 outline-none placeholder:text-[var(--color-ink-faint)]"
              />
            </div>
            {!isViewAs && tab === 'customers' && (
              <Button icon={Plus} className="shrink-0" onClick={() => setAdding(true)}>
                Add
              </Button>
            )}
          </div>

          {tab === 'customers' && (
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${filter === f ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title={tab === 'paid' ? 'No paid customers yet' : 'No customers match'}
                line={tab === 'paid'
                  ? 'A customer appears here once their sale is marked Won.'
                  : 'Try a different search, or clear the status filter.'}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
              {paged.map((c) => (
                <Link key={c.id} to={`/sales/c/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--color-line-soft)] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{c.company}</span>
                      <Pill tone={STATUS_TONE[c.status] || 'neutral'}>{c.status}</Pill>
                    </div>
                    <div className="mt-0.5 text-[13px] text-[var(--color-ink-faint)]">
                      {[c.segment, c.contact].filter(Boolean).join(' · ')}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </div>
                  </div>
                  {tab === 'paid' ? (
                    <span className="shrink-0 font-semibold text-[var(--color-good)]">{dalasi(Number(c.amountPaid) || Number(c.amountExpected) || 0)}</span>
                  ) : (
                    c.phone && (
                      <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-good-bg)] text-[var(--color-good)]">
                        <Phone size={16} />
                      </a>
                    )
                  )}
                  <ChevronRight size={18} className="text-[var(--color-ink-faint)]" />
                </Link>
              ))}
              <Pager {...pager.props} noun="customers" />
            </Card>
          )}
        </div>
      )}

      {adding && <CustomerForm initial={EMPTY_CUSTOMER} title="Add customer" onClose={() => setAdding(false)} onSave={addCustomer} busy={busy} />}
    </div>
  )
}
