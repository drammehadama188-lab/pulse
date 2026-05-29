#!/usr/bin/env python3
# One-time migration: parse ALL of Sally's Excel tracker into the Pulse
# customer-centric seed (customers + _activities). Run from staff-app root.
#   python3 bin/migrate-sally-excel.py "<path-to-xlsx>"
# Writes src/data/sally-sales-seed.js. Idempotent (regenerates from source).
import zipfile, re, sys, json
from xml.etree import ElementTree as ET

XLSX = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/adamadrammeh/Desktop/excel/HR/Team Excel/Sally´s Excel and performance Tracker .xlsx"
OUT = "src/data/sally-sales-seed.js"

ns = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def colnum(ref):
    c = re.match(r'[A-Z]+', ref).group(); n = 0
    for ch in c: n = n*26 + (ord(ch)-64)
    return n-1

def sheet(z, fn):
    sh = ET.fromstring(z.read(f'xl/worksheets/{fn}.xml')); out = []
    for r in sh.findall('.//a:row', ns):
        cells = {}
        for c in r.findall('a:c', ns):
            txt = ''.join(t.text or '' for t in c.iter(NS+'t'))
            v = c.find('a:v', ns)
            if not txt and v is not None: txt = v.text or ''
            cells[colnum(c.get('r'))] = txt.strip()
        if any(cells.values()): out.append(cells)
    return out

# ---- normalization helpers ----
def squash(s):
    return re.sub(r'\s+', ' ', (s or '').strip())

TYPO = {
    'furnitore': 'Furniture', 'furniture': 'Furniture', 'resturants': 'Restaurants',
    'vedhicle': 'vehicle', 'experienve': 'experience', 'wattsapp': 'WhatsApp',
    'definately': 'definitely', 'intrested': 'interested', 'avisit': 'a visit',
    'acall': 'a call', 'gmil.com': 'gmail.com',
}
SMALL = {'and', 'of', 'the', 'to', 'for'}

def fix_words(s, title=True):
    s = squash(s)
    out = []
    for w in s.split(' '):
        lw = w.lower()
        repl = TYPO.get(lw)
        if repl is not None:
            w = repl; lw = w.lower()
        if not title:
            out.append(w); continue
        if w.isupper() and len(w) >= 2:       # keep acronyms (APS, GBOS)
            out.append(w)
        elif lw in SMALL and out:
            out.append(lw)
        elif any(ch.isalpha() for ch in w):
            out.append(w[0].upper() + w[1:] if w[0].islower() else w)
        else:
            out.append(w)
    return ' '.join(out)

def clean_note(s):
    s = squash(s)
    for bad, good in TYPO.items():
        s = re.sub(r'\b'+re.escape(bad)+r'\b', good, s, flags=re.I)
    if s and s[0].islower(): s = s[0].upper() + s[1:]
    return s

SEG = {
    'furniture stores': 'Furniture Stores', 'financial service': 'Financial Services',
    'financial services': 'Financial Services', 'supermarkets': 'Supermarkets',
    'resturants': 'Restaurants', 'restaurants': 'Restaurants', 'banks': 'Banks',
    'pharmacy delivery': 'Pharmacies', 'pharmacies': 'Pharmacies', 'ngo': 'NGO',
    'gov.': 'Government', 'government': 'Government', 'company': 'Other',
    'telecom': 'Other', 'private': 'Private', 'rentals': 'Car Rentals',
    'car rental service': 'Car Rentals', 'car rentals': 'Car Rentals',
    'delivery': 'Other', '': 'Other',
}
def seg(s): return SEG.get(squash(s).lower(), 'Other')

PSTATUS = {'intrested': 'Interested', 'interested': 'Interested',
           'not available': 'Not Available', 'not now': 'Follow Up', '': 'New'}
def pstatus(s): return PSTATUS.get(squash(s).lower(), 'New')

CALLSTAT = {'not intrested': 'Not Interested'}
def callstat(s):
    s = squash(s)
    return CALLSTAT.get(s.lower(), s)

# customer status / next action derived from a call status
CALL_TO_STATUS = {
    'Interested - Lead': 'Interested', 'Wants More info': 'Contacted',
    'Ask for call back': 'Follow Up', 'Not Right Now': 'Follow Up',
    'No Answer': 'New', 'Not Interested': 'Lost', 'Proposal Sent': 'Proposal Sent',
    'Visited': 'Contacted', 'Wrong Number': 'Not Available',
}
CALL_TO_ACTION = {
    'Interested - Lead': 'Follow Up Later', 'Wants More info': 'Send Proposal',
    'Ask for call back': 'Call Back', 'Not Right Now': 'Call Back',
    'No Answer': 'Call Back', 'Not Interested': 'Close', 'Proposal Sent': 'Follow Up Later',
}
ORG_SEGS = {'Banks', 'Financial Services', 'Government', 'NGO', 'Supermarkets',
            'Furniture Stores', 'Restaurants', 'Pharmacies'}
def infer_action(status, segment, contact):
    if status == 'Interested': return 'Follow Up Later'
    if status == 'Follow Up': return 'Call Back'
    if status in ('Not Available', 'Lost'): return 'Call Back'
    if status == 'New':
        return 'Schedule Visit' if (segment in ORG_SEGS and not contact) else 'Call Back'
    return 'Call Back'

def digits(s): return re.sub(r'\D', '', s or '')
def valid_phone(s):
    d = digits(s)
    return d if len(d) >= 7 else ''

def classify_emailcol(val):
    """col4 (email col) sometimes holds a 2nd phone or a website. Returns (email, whatsapp, note)."""
    v = squash(val)
    if not v: return ('', '', '')
    if '@' in v:
        return (v.replace('gmil.com', 'gmail.com').replace(',', '.'), '', '')
    if valid_phone(v):
        return ('', valid_phone(v), '')
    return ('', '', f'Contact/site: {v}')   # e.g. comium.gm, info.nana.gm

STATUS_RANK = {'Won': 9, 'Demo Booked': 8, 'Proposal Sent': 7, 'Interested': 6,
               'Follow Up': 5, 'Contacted': 4, 'New': 1, 'Not Available': 0, 'Lost': 0}

# ---- build records ----
z = zipfile.ZipFile(XLSX)
records = []   # each: dict with fields + _activities + _names(set) + _phones(set)

def new_rec(**kw):
    r = {'company': '', 'segment': 'Other', 'contact': '', 'role': '', 'email': '',
         'phone': '', 'whatsapp': '', 'vehicles': '', 'status': 'New', 'nextAction': '',
         '_activities': [], '_phones': set(), '_names': set()}
    r.update(kw)
    return r

# --- Master Prospects (sheet3) ---
for row in sheet(z, 'sheet3')[1:]:
    g = lambda i: squash(row.get(i, ''))
    company = fix_words(g(0))
    if not company: continue
    email, wa, extranote = classify_emailcol(g(4))
    phone = valid_phone(g(5))
    status = pstatus(g(7))
    segment = seg(g(1))
    contact = fix_words(g(2))
    r = new_rec(company=company, segment=segment, contact=contact,
                role=g(3).lower(), email=email, phone=phone, whatsapp=wa,
                vehicles=digits(g(6)), status=status)
    r['nextAction'] = infer_action(status, segment, contact)
    notes = []
    if g(8): notes.append(clean_note(g(8)))
    if extranote: notes.append(extranote)
    for nt in notes:
        r['_activities'].append({'type': 'note', 'note': nt})
    if phone: r['_phones'].add(phone)
    if wa: r['_phones'].add(wa)
    r['_names'].add(company.lower())
    if contact: r['_names'].add(contact.lower())
    records.append(r)

# --- Call Log (sheet4): named + phone-only ---
for row in sheet(z, 'sheet4'):
    c0, c1, c2, c3, c4 = (squash(row.get(i, '')) for i in range(5))
    if c0 and not (c1 or c2 or c3):    # date separator like '46097'
        continue
    if c1.lower() in ('name', 'name / company') or c2.lower() == 'phone':
        continue
    name = fix_words(c1)
    phone = valid_phone(c2)
    cs = callstat(c3)
    note = clean_note(c4)
    if not name and not phone:
        continue
    status = CALL_TO_STATUS.get(cs, 'New')
    company = name if name else f'Unknown ({phone})'
    r = new_rec(company=company, segment='Private',
                contact=name, phone=phone, status=status)
    r['nextAction'] = CALL_TO_ACTION.get(cs, 'Call Back')
    act = {'type': 'call', 'callStatus': cs or 'No Answer'}
    if note: act['note'] = note
    act['nextAction'] = r['nextAction']
    if not name and not cs:
        # bare number from the call list, never reached
        r['status'] = 'New'; r['nextAction'] = 'Call Back'
        act = {'type': 'note', 'note': "From Sally's call list — not yet reached"}
    r['_activities'].append(act)
    if phone: r['_phones'].add(phone)
    if name: r['_names'].add(name.lower())
    records.append(r)

# --- Leads (sheet5) ---
for row in sheet(z, 'sheet5')[1:]:
    src, company_d, contact, phone = (squash(row.get(i, '')) for i in (1, 2, 3, 4))
    phone = valid_phone(phone)
    contact = fix_words(contact)
    vehicles = digits(squash(row.get(5, '')))
    # company descriptor like 'business man'/'car dealer' -> not a real company name
    is_descriptor = company_d.lower() in (
        'business man', 'private car owner', 'car dealer', 'car  dealer')
    company = '' if is_descriptor else fix_words(company_d)
    r = new_rec(company=company or contact, segment='Car Rentals' if 'dealer' in company_d.lower() or 'rental' in company_d.lower() else 'Private',
                contact=contact, phone=phone, vehicles=vehicles, status='Interested')
    r['nextAction'] = 'Follow Up Later'
    r['_activities'].append({'type': 'note', 'note': f'Lead (source: {src or "Calls"})' +
                             (f' — {company_d}' if is_descriptor else '')})
    r['_lead'] = True
    if phone: r['_phones'].add(phone)
    if contact: r['_names'].add(contact.lower())
    if company: r['_names'].add(company.lower())
    records.append(r)

# ---- merge ----
def lev(a, b):
    if abs(len(a)-len(b)) > 2: return 99
    prev = list(range(len(b)+1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j]+1, cur[-1]+1, prev[j-1]+(ca != cb)))
        prev = cur
    return prev[-1]

def merge_into(dst, src):
    for f in ('company', 'segment', 'contact', 'role', 'email', 'phone', 'whatsapp', 'vehicles'):
        if not dst.get(f) and src.get(f): dst[f] = src[f]
    # richer company name wins (longer, real over 'Unknown')
    if src['company'] and not src['company'].startswith('Unknown') and \
       (dst['company'].startswith('Unknown') or len(src['company']) > len(dst['company'])):
        dst['company'] = src['company']
    # best status by funnel rank
    if STATUS_RANK.get(src['status'], 1) > STATUS_RANK.get(dst['status'], 1):
        dst['status'] = src['status']; dst['nextAction'] = src['nextAction']
    dst['_activities'] += src['_activities']
    dst['_phones'] |= src['_phones']
    dst['_names'] |= src['_names']

merged = []
for r in records:
    hit = None
    for m in merged:
        # phone overlap
        if r['_phones'] & m['_phones']:
            hit = m; break
        # same normalized company name (orgs)
        if r['company'] and not r['company'].startswith('Unknown') and \
           r['company'].lower() in m['_names']:
            hit = m; break
        # fuzzy contact match for individuals
        if r['segment'] == 'Private' and m['segment'] == 'Private' and r['contact'] and m['contact']:
            if any(lev(r['contact'].lower(), n) <= 2 for n in m['_names'] if n):
                hit = m; break
    if hit: merge_into(hit, r)
    else: merged.append(r)

# de-dupe identical activities within a record
for m in merged:
    seen = set(); acts = []
    for a in m['_activities']:
        k = (a.get('type'), a.get('callStatus', ''), a.get('note', ''))
        if k in seen: continue
        seen.add(k); acts.append(a)
    m['_activities'] = acts

# ---- emit JS ----
def jsval(v): return json.dumps(v, ensure_ascii=False)

lines = []
lines.append("// Sally's pipeline, FULLY migrated from her Excel tracker (Master Prospects +")
lines.append("// Call Log + Leads) on 29 May 2026 — customer-centric model. Each customer")
lines.append("// carries its own activity history under `_activities`; the backend splits")
lines.append("// these into the `customers` and `activities` collections on seed. Owner = 'sally'.")
lines.append("// Generated by bin/migrate-sally-excel.py — re-run to regenerate, don't hand-edit.")
lines.append("")
lines.append("// April 2026 results from your records (5 sales × D6,500 ≈ D32,500).")
lines.append("export const sallyMonthlyHistory = [")
lines.append("  { month: '2026-04', sales: 5, revenue: 32500 },")
lines.append("]")
lines.append("")
lines.append("export const sallyCustomers = [")
FIELDS = ['company', 'segment', 'contact', 'role', 'email', 'phone', 'whatsapp', 'vehicles', 'status', 'nextAction']
for m in merged:
    parts = []
    for f in FIELDS:
        if m.get(f): parts.append(f"{f}: {jsval(m[f])}")
    head = "  { " + ", ".join(parts)
    if m['_activities']:
        acts = []
        for a in m['_activities']:
            ap = ", ".join(f"{k}: {jsval(v)}" for k, v in a.items() if v != '')
            acts.append("{ " + ap + " }")
        head += ",\n    _activities: [" + ", ".join(acts) + "] },"
    else:
        head += " },"
    lines.append(head)
lines.append("]")
out = "\n".join(lines) + "\n"
with open(OUT, 'w') as f:
    f.write(out)

# ---- report ----
print(f"Parsed -> merged into {len(merged)} customers")
named = sum(1 for m in merged if not m['company'].startswith('Unknown'))
print(f"  named: {named}   cold-list (Unknown): {len(merged)-named}")
print(f"  total activities: {sum(len(m['_activities']) for m in merged)}")
from collections import Counter
print("  by status:", dict(Counter(m['status'] for m in merged)))
print("  by segment:", dict(Counter(m['segment'] for m in merged)))
print(f"Wrote {OUT}")
