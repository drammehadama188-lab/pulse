# Pulse (by Damia) — read this first

**Pulse** is Damia's internal staff/employee web app. React (Vite) frontend + Node/Express
backend. Folder is still `~/damia/staff-app` (not renamed to avoid breaking running servers).
Built **fresh** for staff — it is **not** The Desk (founder-app). It only **reuses logic/data**
copied from `~/damia/founder-app` (the roster `src/data/team.js`, `goals.js`, and the JSON-store
backend pattern). Never edit `~/damia/founder-app` from here.

## What it is

- **Audience:** staff (self-service) + managers (approvals + team view). Role-based, one app.
- **Design:** governed by **`DESIGN.md`** — read it before touching any page. Light, soft
  rounded cards, dark sidebar, Inter, brand blue from the tokens. (This line used to name a
  different blue and a different font than the code actually ships; the tokens win, always.)
- **v1 scope:** real login, attendance check-in/out, leave requests + manager approval,
  staff dashboard, manager team/presence view.

## The design rules — not optional

Three files, in this order, before you design or change any page:

1. **`DESIGN.md`** — the rulebook Adama wrote. One job per page, the six page types,
   what a dashboard leads with, how a list ends, what a record header may carry, one
   source of truth, what each colour MEANS, spacing, type, empty states, tables.
2. **`src/design.js`** — the same rules as numbers. If a page needs a number this file
   does not have, the number goes IN this file. Never invent one on the page.
3. **`src/index.css`** (`@theme`) — every colour, radius and shadow. A page never writes
   a hex or a Tailwind palette class (`bg-red-100`, `text-blue-700`). Colour carries
   meaning: blue = action, green = healthy, amber = attention, red = critical, purple =
   special workflow, grey = neutral.

**`test/design-rules.test.mjs` runs inside `npm run build`, and the build is what deploys.**
A page that breaks a rule does not ship.

🔒 If a page cannot follow a rule, the answer is to change the page — or to raise it with
Adama and change the RULE. Never weaken the check to make a page pass, and never add a
second rulebook: these three files are the only ones.

Shared pieces that exist so pages stop reinventing them: `components/ui/Pager.jsx`
(how every list ends), `components/ui/EmptyState.jsx`, `components/ui/Skeleton.jsx`,
and the kit in `components/ui.jsx`.

## Ports

- Frontend (Vite): **http://localhost:4002**
- Backend (Express): **http://localhost:4003** (Vite proxies `/api` → 4003)
- The Desk uses 4000/4001 — these are deliberately different so they never collide.

## Run (during build — manual, no LaunchAgents yet)

Backend writes JSON to `./data`, so run it OUTSIDE the Claude sandbox:
```
cd ~/damia/staff-app
npm run server     # backend on :4003
npm run dev        # frontend on :4002 (separate terminal)
```

## Data store

JSON files in `./data/` (gitignored — never commit staff data). All reads/writes go through
the `db.*` helpers in `server.js` — that's the single seam to swap for Postgres later.
`data/users.json` is seeded from the roster on first backend start.

## Default credentials (seeded, CHANGE before real use)

Usernames = first name lowercased (e.g. `kaddy`, `sally`, `ebou`, `yafatou`), plus `adama`.
Default password for everyone: `damia2026`. Managers: Ya Fatou, Kaddy, Adama. The backend
logs the full seeded list on first start.

## Status

v1 in progress (28 May 2026). Phase 2 (payslips, performance reviews, leaderboard, training,
announcements, live sales wiring) and cleanup of The Desk are separate later steps.
