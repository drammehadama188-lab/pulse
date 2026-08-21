import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Palmtree, Target, TrendingUp, ClipboardCheck, ChevronRight, LogIn, LogOut, CalendarClock, PhoneCall, MapPin, Zap, Contact } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../lib/api.js'
import { getLocation } from '../lib/geo.js'
import { Avatar, Button, Card, Pill, SectionTitle, Spinner, StatCard } from '../components/ui.jsx'
import CoachingFeed from '../components/CoachingFeed.jsx'
import { greeting, firstName, timeShort, dateLong, dalasi } from '../lib/format.js'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'

export default function Home() {
  const { user, isManager, isViewAs, hasPower } = useAuth()
  const [att, setAtt] = useState(null)
  const [leave, setLeave] = useState(null)
  const [me, setMe] = useState(null) // roster record
  const [won, setWon] = useState(null) // won leads this month (sales)
  const [revenue, setRevenue] = useState(0) // dalasi closed this month
  const [followUps, setFollowUps] = useState([]) // customers awaiting follow-up
  const [today, setToday] = useState({ calls: 0, visits: 0, leads: 0 }) // activity logged today
  const [mgr, setMgr] = useState({ pending: 0, present: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  async function load() {
    const [a, l, t, meResp] = await Promise.all([
      api('/attendance/today'),
      api('/leave/mine'),
      api('/team'),
      api('/me'),
    ])
    setAtt(a.record)
    setLeave(l)
    // Roster record for display + own commission from /api/me (pay is server-only,
    // no longer in the /team roster).
    const meRec = t.team.find((p) => p.name === user.name) || null
    setMe(meRec ? { ...meRec, commission: meResp.pay?.commission || 0 } : meRec)
    if (meRec?.type === 'Sales' || meRec?.type === 'Training') {
      const [{ customers }, { activities }] = await Promise.all([
        api('/customers'),
        api('/activities'),
      ])
      const m = new Date().toISOString().slice(0, 7)
      const wonThisMonth = customers.filter((x) => x.status === 'Won' && (x.wonAt || '').startsWith(m))
      setWon(wonThisMonth.length)
      setRevenue(wonThisMonth.reduce((s, c) => s + (Number(c.amountPaid) || Number(c.amountExpected) || 0), 0))
      // Customers still in play — the ones to chase. (No follow-up DATE in the model
      // yet, so we surface by status, newest first.)
      const FOLLOW = ['Interested', 'Follow Up', 'Contacted']
      setFollowUps(
        customers
          .filter((x) => FOLLOW.includes(x.status))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      )
      const todayKey = new Date().toISOString().slice(0, 10)
      const logged = activities.filter((a) => (a.date || a.createdAt || '').slice(0, 10) === todayKey)
      setToday({
        calls: logged.filter((a) => a.type === 'call').length,
        visits: logged.filter((a) => a.type === 'visit').length,
        leads: logged.filter((a) => a.type === 'call' && a.callStatus === 'Interested - Lead').length,
      })
    }
    // Each stat needs its own power — fetch only what this person can see
    // and survive a 403 on either without breaking the page.
    if (hasPower('approvals') || hasPower('team')) {
      const [pend, pres] = await Promise.all([
        hasPower('approvals') ? api('/leave?status=pending').catch(() => null) : null,
        hasPower('team') ? api('/attendance').catch(() => null) : null,
      ])
      setMgr({
        pending: pend ? pend.requests.length : 0,
        present: pres ? pres.presence.filter((p) => p.record?.checkIn).length : 0,
        total: pres ? pres.presence.length : 0,
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleCheck() {
    setChecking(true)
    try {
      const loc = await getLocation()
      const r = att?.checkIn
        ? await api('/attendance/check-out', { method: 'POST', body: loc || {} })
        : await api('/attendance/check-in', { method: 'POST', body: loc || {} })
      setAtt(r.record)
    } catch (e) {
      alert(e.message)
    } finally {
      setChecking(false)
    }
  }

  if (loading) {
    return (
      <PageSkeleton tiles={4} rows={6} />
    )
  }

  // 12 Jun 2026 (Adama's request): Sales cleared out of Pulse (HR-only), so the
  // dashboard's sales widgets — "Sales this month", today's funnel, follow-ups
  // and the sales quick-links — are forced off for everyone. The non-sales
  // branch renders the neutral "Your role" card instead.
  const isSales = false
  const checkedIn = !!att?.checkIn && !att?.checkOut
  const done = !!att?.checkOut

  return (
    <div className="space-y-4">
      {/* greeting */}
      <div className="flex items-center justify-between gap-4 rise">
        <div>
          <h1 className="t-page">
            {greeting()}, {firstName(user.name)} <span className="inline-block">👋</span>
          </h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">{dateLong()}</p>
          {me?.contractEnd && <ContractChip contract={me.contract} end={me.contractEnd} />}
        </div>
        <div className="hidden md:block">
          <Avatar name={user.name} size={52} />
        </div>
      </div>

      {/* status cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 rise" style={{ animationDelay: '60ms' }}>
        {/* attendance */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">Attendance</span>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                checkedIn
                  ? 'bg-[var(--color-good-bg)] text-[var(--color-good)]'
                  : 'bg-[var(--color-brand-50)] text-[var(--color-brand)]'
              }`}
            >
              <Clock size={18} strokeWidth={2.2} />
            </span>
          </div>
          <div>
            {done ? (
              <>
                <div className="text-[22px] font-semibold tracking-tight">Day complete</div>
                <div className="text-[13px] text-[var(--color-ink-faint)]">
                  {timeShort(att.checkIn)} – {timeShort(att.checkOut)}
                </div>
              </>
            ) : checkedIn ? (
              <>
                <div className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
                  Checked in {att.late && <Pill tone="warn">Late</Pill>}
                </div>
                <div className="text-[13px] text-[var(--color-ink-faint)]">since {timeShort(att.checkIn)}</div>
              </>
            ) : (
              <>
                <div className="text-[22px] font-semibold tracking-tight">Not checked in</div>
                <div className="text-[13px] text-[var(--color-ink-faint)]">Tap below to start your day</div>
              </>
            )}
          </div>
          {!done && (
            <Button
              onClick={toggleCheck}
              disabled={checking || isViewAs}
              variant="primary"
              icon={checking ? undefined : checkedIn ? LogOut : LogIn}
              className="mt-1 w-full"
            >
              {checking ? <Spinner size={16} /> : checkedIn ? 'Check out' : 'Check in'}
            </Button>
          )}
        </Card>

        {/* leave */}
        <StatCard
          icon={Palmtree}
          tone={leave?.annualEligible ? 'good' : 'warn'}
          label="Annual leave"
          value={leave?.annualEligible ? 'Eligible' : 'After 12 months'}
          sub={
            leave?.annualEligible
              ? `${leave.annualUsed ?? 0} day${(leave.annualUsed ?? 0) === 1 ? '' : 's'} used`
              : 'Eligible after 12 months of service'
          }
        />

        {/* role metric */}
        {isSales ? (
          <StatCard
            icon={Target}
            tone={(won ?? 0) >= (me.target ?? 0) && me.target ? 'good' : 'brand'}
            label="Sales this month"
            value={`${won ?? 0} / ${me.target ?? 0}`}
            sub={
              revenue > 0
                ? `${dalasi(revenue)} closed${me.target ? ` · ${Math.max(0, me.target - (won ?? 0))} to target` : ''}`
                : me.target
                  ? (won ?? 0) >= me.target
                    ? `Target hit · ${dalasi(me.commission)} commission`
                    : `${me.target - (won ?? 0)} to target`
                  : 'No target set'
            }
          />
        ) : (
          <StatCard
            icon={TrendingUp}
            tone="good"
            label="Your role"
            value={me?.type || user.department}
            sub={me?.kpi || user.title}
          />
        )}
      </div>

      {/* today's activity — the funnel, logged today */}
      {isSales && (
        <Card className="grid grid-cols-3 divide-x divide-[var(--color-line-soft)] p-0 rise" style={{ animationDelay: '90ms' }}>
          <TodayStat icon={PhoneCall} label="Calls" value={today.calls} />
          <TodayStat icon={MapPin} label="Visits" value={today.visits} />
          <TodayStat icon={Zap} label="Leads" value={today.leads} />
        </Card>
      )}

      {/* manager peek — anyone holding Approvals or Team power */}
      {(hasPower('approvals') || hasPower('team')) && (
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5 rise" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-warn-bg)] text-[var(--color-warn)]">
              <ClipboardCheck size={20} />
            </span>
            <div>
              <div className="text-[18px] font-semibold leading-none">{mgr.pending}</div>
              <div className="text-[13px] text-[var(--color-ink-faint)]">pending approvals</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-good-bg)] text-[var(--color-good)]">
              <Clock size={20} />
            </span>
            <div>
              <div className="text-[18px] font-semibold leading-none">
                {mgr.present}/{mgr.total}
              </div>
              <div className="text-[13px] text-[var(--color-ink-faint)]">checked in today</div>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {hasPower('approvals') && (
              <Link to="/approvals">
                <Button variant="ghost" size="sm">Review approvals</Button>
              </Link>
            )}
            {hasPower('team') && (
              <Link to="/team">
                <Button variant="ghost" size="sm">View team</Button>
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* coaching / flags / meetings */}
      <CoachingFeed />

      {/* follow-ups — who to chase next (sales) */}
      {isSales && followUps.length > 0 && (
        <div className="rise" style={{ animationDelay: '140ms' }}>
          <SectionTitle action={<Link to="/sales" className="text-[13px] font-semibold text-[var(--color-brand)]">View all</Link>}>
            Follow up with
          </SectionTitle>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {followUps.slice(0, 5).map((c) => (
              <Link
                key={c.id}
                to={`/sales/c/${c.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-line-soft)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]">
                  <Contact size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-[var(--color-ink)]">{c.company}</div>
                  <div className="truncate text-[13px] text-[var(--color-ink-faint)]">
                    {c.nextAction || c.status}{c.phone ? ` · ${c.phone}` : ''}
                  </div>
                </div>
                <Pill tone={c.status === 'Interested' ? 'good' : 'warn'}>{c.status}</Pill>
                <ChevronRight size={18} className="ml-1 shrink-0 text-[var(--color-ink-faint)]" />
              </Link>
            ))}
          </Card>
        </div>
      )}

      {/* focus + quick actions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rise" style={{ animationDelay: '160ms' }}>
          <SectionTitle>This week's focus</SectionTitle>
          <Card className="p-5">
            {me ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand-50)] text-[11.5px] font-semibold text-[var(--color-brand)]">
                    ★
                  </span>
                  <div>
                    <div className="font-semibold text-[var(--color-ink)]">{me.weeklyTarget || me.coreResponsibility}</div>
                    <div className="text-[13px] text-[var(--color-ink-faint)]">{me.coreResponsibility}</div>
                  </div>
                </div>
                {me.kpi && (
                  <div className="rounded-lg bg-[var(--color-fill)] px-4 py-3 text-[13px]">
                    <span className="font-semibold text-[var(--color-ink-soft)]">Goal · </span>
                    <span className="text-[var(--color-ink)]">{me.kpi}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[var(--color-ink-faint)]">No focus set for your account yet.</p>
            )}
          </Card>
        </div>

        <div className="rise" style={{ animationDelay: '200ms' }}>
          <SectionTitle>Quick actions</SectionTitle>
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {isSales && <QuickLink to="/sales" icon={Contact} label="Customers" />}
            {isSales && <QuickLink to="/day" icon={Zap} label="Log my day" />}
            {isSales && <QuickLink to="/pipeline" icon={TrendingUp} label="Pipeline" />}
            <QuickLink to="/leave" icon={Palmtree} label="Request leave" />
            <QuickLink to="/attendance" icon={Clock} label="My hours" />
            <QuickLink to="/profile" icon={Target} label="My profile" />
          </Card>
        </div>
      </div>

    </div>
  )
}

function ContractChip({ contract, end }) {
  const days = Math.ceil((new Date(end) - new Date()) / 86400000)
  if (isNaN(days)) return null
  const tone = days <= 7 ? 'bad' : days <= 30 ? 'warn' : 'rest'
  const dateStr = new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="mt-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
        tone === 'bad' ? 'bg-[var(--color-bad-bg)] text-[var(--color-bad)]' : tone === 'warn' ? 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]' : 'bg-[var(--color-rest-bg)] text-[var(--color-rest)]'
      }`}>
        <CalendarClock size={14} />
        {contract ? `${contract} · ` : ''}ends {dateStr}{days >= 0 ? ` · ${days} day${days === 1 ? '' : 's'} left` : ' · expired'}
      </span>
    </div>
  )
}

function TodayStat({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <div className="text-[22px] font-semibold leading-none text-[var(--color-ink)]">{value}</div>
      <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">
        {label} today
      </div>
    </div>
  )
}

function QuickLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-line-soft)]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand)]">
        <Icon size={18} />
      </span>
      <span className="font-semibold text-[var(--color-ink)]">{label}</span>
      <ChevronRight size={18} className="ml-auto text-[var(--color-ink-faint)]" />
    </Link>
  )
}
