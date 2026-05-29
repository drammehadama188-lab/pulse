// Rebuild the sales store (customers + activities) from sally-sales-seed.js,
// mirroring server.js seedSales(). Overwrites data/customers.json and
// data/activities.json. Run from staff-app root: node bin/reseed-sales.js
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sallyCustomers, sallyMonthlyHistory } from '../src/data/sally-sales-seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

function write(name, value) {
  const f = path.join(DATA_DIR, `${name}.json`)
  const tmp = f + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, f)
}

const now = new Date().toISOString()
const customers = []
const activities = []
for (const c of sallyCustomers) {
  const { _activities = [], ...fields } = c
  const id = crypto.randomUUID()
  const cust = { id, owner: 'sally', createdAt: now, ...fields }
  if ('amountExpected' in cust || 'amountPaid' in cust) {
    cust.balance = (Number(cust.amountExpected) || 0) - (Number(cust.amountPaid) || 0)
  }
  customers.push(cust)
  for (const a of _activities) {
    activities.push({ id: crypto.randomUUID(), owner: 'sally', customerId: id, date: '', createdAt: now, ...a })
  }
}
write('customers', customers)
write('activities', activities)
write('history', sallyMonthlyHistory.map((h) => ({ id: crypto.randomUUID(), owner: 'sally', ...h })))

console.log(`Reseeded: ${customers.length} customers, ${activities.length} activities, ${sallyMonthlyHistory.length} history rows`)
