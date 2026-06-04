import { team } from '../data/team'

// Pulse has no live CRM feed. The founder app read per-sale records from Zoho;
// here we synthesize equivalent records from team.js (each person's current
// `sales` count + `revenueGenerated`), dated to the current month, so the
// profile pages' period/agent/trend logic renders real roster numbers.
// One record per sale, amount = revenueGenerated / sales.
export function teamTrackers() {
  const now = new Date()
  // 2nd of the month avoids timezone edge cases landing in the previous month.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 2).toISOString()
  const out = []
  team.forEach((t) => {
    const sales = t.sales || 0
    if (sales <= 0) return
    const per = Math.round((t.revenueGenerated || 0) / sales)
    for (let i = 0; i < sales; i++) {
      out.push({
        If_Agent_Name: t.name,
        Amount_Paid: per,
        Subscription_Start: monthStart,
        Created_Time: monthStart,
        User_Name: '',
      })
    }
  })
  return out
}
