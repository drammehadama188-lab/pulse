import { useEffect, useState } from 'react'
import { Wallet, FileText, Palmtree, Stethoscope, Bus, Briefcase, CalendarClock, Baby, CalendarDays } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'
import { dalasi } from '../lib/format.js'

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Pay() {
  const { user } = useAuth()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/team').then((t) => {
      setMe(t.team.find((p) => p.name === user.name) || null)
      setLoading(false)
    })
  }, [user.name])

  if (loading) return <div className="flex justify-center py-24"><Spinner size={28} /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Pay &amp; benefits</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">Your salary, allowances and benefits.</p>
      </div>

      {me ? (
        <>
          {/* salary */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-6" style={{ background: 'linear-gradient(150deg, var(--color-brand-50), var(--color-surface) 75%)' }}>
              <div>
                <div className="text-sm font-semibold text-[var(--color-ink-soft)]">Monthly total</div>
                <div className="mt-1 text-4xl font-extrabold tracking-tight text-[var(--color-ink)]">{dalasi(me.total)}</div>
              </div>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-brand)] text-white"><Wallet size={26} /></span>
            </div>
            <div className="divide-y divide-[var(--color-line-soft)]">
              <Row icon={Wallet} label="Base salary" value={dalasi(me.base)} />
              {me.commission > 0 && <Row icon={Wallet} label="Commission (on target)" value={dalasi(me.commission)} />}
              {me.transport > 0 && <Row icon={Bus} label="Transport allowance" value={dalasi(me.transport)} />}
            </div>
          </Card>

          {/* benefits — per the Blue Book (handbook) */}
          <div>
            <SectionTitle>Benefits &amp; leave</SectionTitle>
            <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
              <Row icon={Palmtree} tone="rest" label="Annual leave" value="After 12 months' service" />
              <Row icon={Stethoscope} tone="good" label="Sick leave" value="Per Labour Act (medical note)" />
              <Row icon={Baby} tone="brand" label="Maternity leave" value="12 weeks (6 paid)" />
              <Row icon={CalendarDays} tone="warn" label="Public holidays" value="Gambia public holidays" />
              {me.transport > 0 && <Row icon={Bus} tone="warn" label="Transport allowance" value={`${dalasi(me.transport)} / month`} />}
              {me.contract && <Row icon={Briefcase} tone="brand" label="Contract" value={me.contract} />}
              {me.contractEnd && <Row icon={CalendarClock} tone="brand" label="Contract ends" value={fmtDate(me.contractEnd)} />}
            </Card>
            <p className="mt-2 px-1 text-xs text-[var(--color-ink-faint)]">Benefits are per your employment contract (Employee Handbook).</p>
          </div>
        </>
      ) : (
        <Card className="p-6 text-[var(--color-ink-soft)]">No compensation record linked to your account.</Card>
      )}

      <div>
        <SectionTitle>Payslips</SectionTitle>
        <Card className="flex items-center gap-4 p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-line-soft)] text-[var(--color-ink-faint)]"><FileText size={22} /></span>
          <div className="flex-1">
            <div className="font-semibold text-[var(--color-ink)]">Monthly payslips</div>
            <div className="text-sm text-[var(--color-ink-faint)]">Downloadable payslips are coming soon.</div>
          </div>
          <Pill tone="brand">Coming soon</Pill>
        </Card>
      </div>
    </div>
  )
}

function Row({ icon: Icon, tone = 'neutral', label, value }) {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      {Icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: `var(--color-${tone === 'neutral' ? 'ink-soft' : tone})`, background: tone === 'neutral' ? 'var(--color-line-soft)' : `var(--color-${tone}-bg)` }}>
          <Icon size={17} />
        </span>
      )}
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className="ml-auto font-bold text-[var(--color-ink)]">{value}</span>
    </div>
  )
}
