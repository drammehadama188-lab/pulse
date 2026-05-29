# Pulse (by Damia) — read this first

**Pulse** is Damia's internal staff/employee web app. React (Vite) frontend + Node/Express
backend. Folder is still `~/damia/staff-app` (not renamed to avoid breaking running servers).
Built **fresh** for staff — it is **not** The Desk (founder-app). It only **reuses logic/data**
copied from `~/damia/founder-app` (the roster `src/data/team.js`, `goals.js`, and the JSON-store
backend pattern). Never edit `~/damia/founder-app` from here.

## What it is

- **Audience:** staff (self-service) + managers (approvals + team view). Role-based, one app.
- **Design:** "warm people-platform" (BambooHR/Personio feel) — light, soft rounded cards,
  mobile-friendly. Brand = Damia blue `#1E4FCC`, font = Plus Jakarta Sans. Do NOT clone The
  Desk's dark sidebar look.
- **v1 scope:** real login, attendance check-in/out, leave requests + manager approval,
  staff dashboard, manager team/presence view.

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
