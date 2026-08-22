# Pulse & Damia Admin — product and design rules

Set by Adama, 21 August 2026. These are the rules for both products. Where a
number is given, it is the number: do not invent a different one on your page.

The values are mirrored in code so they can be checked, not just remembered:

- Colour, surface, radius and shadow — `src/index.css` (`@theme`)
- Spacing, type, density, pagination — `src/design.js`
- The pieces the rules require — `src/components/ui/`

Run `npm run design-check` before a deploy. It fails on the violations it can
see (a page inventing its own pagination, a raw colour, a bare "No data").

---

## Purpose

Every page has ONE primary job. Before designing a page, answer three questions:

1. What is the user here to understand?
2. What decision might they need to make?
3. What action might they need to take?

Anything that does not serve those three is removed, moved deeper, or belongs on
another page.

**If information does not help the user understand, decide or act, it does not
belong on the page.**

---

## Page types

Every page is one of these six. Do not mix two without a clear reason.

| Type | Answers |
| --- | --- |
| Dashboard | What needs my attention, and what is happening? |
| List / Queue | Which record, and what do I do with it? |
| Record / Detail | Everything true about this one thing |
| Workflow | Take me through these steps |
| Report / Analytics | Explain the pattern |
| Settings | Configure behaviour |

### Dashboards

Not a collection of every statistic available. In this order:

```
Page title + period + actions
3–5 important metrics
Needs attention / operational priorities
Primary operational information
Trends / secondary analytics
Recent activity, if useful
```

A metric must lead to a decision. If clicking a metric naturally reveals its
records, make it clickable. No card exists to fill space.

### List pages

For finding, comparing and processing records.

- **Stat tiles** — only when they help understand or filter the list. Max 4–5.
- **Tabs** — major views only.
- **Filters** — search, then primary filters, then secondary, then date, then reset.
- **Actions** — the primary page action sits top right.
- **Rows** — only what identifies, compares or acts on the record. A table is not
  a miniature detail page.
- **Row click** opens the record. One obvious row action may be visible;
  everything else goes under `•••`.
- **Pagination** — see below. In Pulse: default 25, options 10 / 25 / 50.

### Record pages

The single source of truth for one thing: customer, employee, vehicle, tracker,
installation, case, payment, subscription.

Header: breadcrumb · record name / ID · ONE current status · identifying facts.
Right side: primary action, secondary action, `•••`. **Maximum three visible
actions.** Never cover the header in status badges. At-a-glance facts go in one
compact summary band below the header.

Tabs: Overview is always first and is the summary. Then the domain tabs, then
Activity / Notes / Files where relevant.

```
Overview · Vehicles · Billing · Support · Activity · Notes · Files
```

A tab represents a meaningful job, not the existence of data.

**Overview answers "what is the current situation?"** — current state, important
facts, anything needing attention, recent relevant activity, useful next
actions. It summarises the other tabs; it does not duplicate them. Detailed
management belongs inside its own tab.

---

## One source of truth

Never make anyone enter the same information twice. One event, many
consequences, all automatic:

- Payment recorded → subscription, customer account, revenue, activity history
- Installation completed → tracker assigned, vehicle, customer, install history
- Leave approved → attendance, schedule, employee record

---

## Status

Every record has ONE primary current status. Secondary indicators only for
genuinely different concepts. Never two badges competing to describe the same
state. The same status never carries a different name on a different page.

---

## Colour

Colour carries meaning, never decoration.

| Colour | Means |
| --- | --- |
| Blue | Primary action, selected, navigation |
| Green | Successful, active, completed, healthy |
| Amber | Attention, approaching, late |
| Red | Critical, failed, overdue, blocked |
| Purple | Special workflow, review, processing |
| Grey | Neutral, inactive, unavailable |

Prefer soft tinted backgrounds, small icons, status pills, thin progress bars.
The interface stays predominantly neutral.

**Visual system:** page background is a very light cool grey; cards are white
with a very light neutral border and an almost invisible shadow; primary text is
near-black navy; secondary text is soft slate; the accent is Pulse blue. Cards
feel softly lifted, not boxed in. No heavy outlines, no large areas of saturated
colour.

---

## Spacing

Space is part of the design. Only these steps: **8 · 12 · 16 · 24 · 32 · 40**.

- Page sections: 24–32px apart
- Card padding: 20–24px
- Table rows: comfortable, never cramped

Never reduce spacing just to fit more on screen.

---

## Typography

**13px is the platform's standard body token.** Do not move the platform to
14–15px body text.

| Role | Size / weight |
| --- | --- |
| Page title | 28–32px semibold |
| Section heading | 16–18px semibold |
| Large metric | 26–32px semibold |
| Body — the standard | 13px |
| UI labels and table content | 13px |
| Emphasised body | 14px, only where hierarchy requires it |
| Secondary / metadata | 12px |

Hierarchy comes from size and weight. Do not make everything bold. Secondary
information recedes.

Typography consistency means a shared hierarchy and shared tokens — not every
text element at the same size.

---

## Buttons

One primary blue button per section or page wherever possible. Filled blue for
primary, white with a subtle border for secondary, text for tertiary, red only
when the action destroys something. Blue buttons must not compete.

---

## Empty states, loading, errors

Never "No data." An empty state is a title, a short explanation, and an action
where one exists:

```
No installations scheduled
Upcoming installations appear here once they are booked.
[ + Schedule installation ]
```

Loading uses skeletons shaped like the real content. Full-page spinners only
while the application itself boots; buttons use a small inline spinner.

Errors appear where the failure happened, with a way to retry. A toast alone is
not enough for an important failure.

---

## Forms, modals, drawers

Forms are grouped by meaning, in sections, required first and optional later.
Advanced fields appear only when needed. Save and cancel stay predictable.

Modals are for short focused actions: record a payment, change a status, assign
a technician, confirm a cancellation. A full management page never goes in a
modal — if the task grows, use a drawer or its own page.

Drawers carry contextual information or a medium workflow where seeing the page
underneath helps. A drawer is not a permanent sidebar.

---

## Tables

Tables contain work. Columns are purposeful and never repeat each other. Text
aligns left; numbers align right when they are compared; status sits in the same
place on every table. A long description must not make rows tall — open the
record for detail.

---

## Activity, history and notes

Activity answers "what recently happened?" History answers "what has happened to
this record over its lifetime?" Both are generated by the system wherever
possible. Never ask staff to retype an event the system already knows.

Notes add human context. A note is not a substitute for structured data: a
payment belongs in Payments, a warning in Warnings, a repair in Service, a
salary change in Job & Pay. A note may explain the event; it may not replace it.

---

## Needs attention

The system surfaces exceptions rather than waiting to be asked: subscription
overdue, vehicle offline too long, installation overdue, payment awaiting
verification, SIM expiring, follow-up overdue, probation ending, attendance
issue, unresolved case.

Normal records stay visually quiet. Only exceptions get attention — otherwise
every screen looks urgent and none of it means anything.

---

## Side rails

A right rail is not the default. A list page normally has none — it steals width
from the thing the page exists to show.

A record page may have one **only when it carries context worth keeping on
screen the whole time**: upcoming HR actions, account alerts, the exceptions on
this record, the two or three likely next actions. If it is only a second place
to put facts, it is not earning its width; put them in the summary band or a tab.

A drawer is not a rail. A drawer opens for one task and closes.

---

## Quick editing

Change a small thing where it is shown. A status, a date, an attendance mark —
these are one click on the cell and a short menu, not a journey.

**Wrong:** click the employee → leave the page → find Attendance → edit → come
back.
**Right:** click the attendance cell → pick the status → done.

Navigation is a cost. Spend it on real work, not on toggling a value.

---

## HR records

The employee record is the single source of truth for a person:

```
Overview · Job & Pay · Attendance · Performance · Documents · Notes · History
```

🔒 **An employee's name always opens their record.** It is never wired to an
attendance edit or any other in-place action — a name means "show me this
person". The attendance cell carries the attendance action.

---

## Performance

Performance is not one invented score. Keep these apart, because they answer
different questions: targets, actual results, KPIs, trend, reviews, feedback,
coaching, development.

Every KPI carries: **KPI · target · actual · progress · status · trend.**

🔒 **Status must account for the period elapsed.** An annual target is not
"behind" in February because the year's total has not been reached. Judge
against the share of the period that has passed, or say nothing.

---

## Attendance

**Schedule is what should happen. Attendance is what did.** Keep them separate —
merging them loses the difference between an absence and a day off.

Statuses: Working · Worked · Late · Absent · Annual leave · Sick · Excused ·
Off · Not started.

Approved leave updates attendance by itself. Nobody records it twice.

---

## Before shipping a page

Answer every one of these. The last one is a veto.

- Does the page have ONE clear job, and is it the right page type?
- Is anything here already shown somewhere else?
- Is there one obvious primary action?
- Is colour carrying meaning, are normal states calm, are exceptions visible?
- Body 13px, spacing on the 8px scale, cards soft rather than boxed?
- Search → filters → chips → date → reset, with page actions kept out of that bar?
- Does clicking a record open its canonical page?
- Are empty, loading and error states designed — not "No data" and a spinner?
- Is the user typing something the system already knows?
- Should this action be updating another module automatically?
- **Is this genuinely easier to use than the page it replaces?**

If the last answer is no, it does not ship.

---

## Actions

Actions appear where they are naturally needed, and nowhere else. The question
is always: what is the most likely next action from this screen?

---

## Pagination

The behaviour is the same everywhere; the row count depends on the product and
the space available.

- **Pulse operational lists** — default 25, allow 10 / 25 / 50 where appropriate.
- **Admin** — default 10, unless the page has an established contextual rule.
- **Stretched / fill-height panels** — work the visible rows out from the
  vertical space available, rather than forcing a fixed default.

Consistency applies to the controls, their placement, the page-size selector,
the interaction and the behaviour. It does **not** require every list to show the
same number of rows. Never change a page's established pagination just to make
its number match another product.

---

## Consistency

The same concept looks and behaves the same everywhere: search, filters, date
selectors, tables, status badges, `•••` menus, modals, pagination. Someone who
learns one page already understands most of the next one.

**Density is the exception:** operational screens may be dense, record and
management screens breathe. Consistency means shared rules, not identical
layouts.

---

## Responsiveness

Desktop first for operational work. As width drops: shed columns, move secondary
information into the record, collapse secondary actions, protect the primary
task. Never squeeze the desktop layout.

---

## Permissions and audit

Do not show an action the user cannot perform, unless explaining why it is
unavailable helps them. Payroll, salaries and disciplinary records respect role
permissions — and the server, not the screen, is what enforces that.

Important changes record what changed, the previous value where it matters, the
new value, who did it, when, and the reason where one is required. This applies
to payments, subscriptions, tracker and SIM assignment, salary, contracts,
warnings, attendance corrections and account status.

---

## The final rule

Dashboards surface what matters. Lists organise the work. Filters narrow it.
Records hold the truth. Tabs separate the jobs. Actions change the record.
History remembers. Reports explain. Settings configure.

The system records an event once and reuses it everywhere.
