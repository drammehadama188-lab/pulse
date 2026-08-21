// Pulse — the measurements. DESIGN.md is the rulebook in words; this file is
// the same rules as numbers, so a page cannot quietly pick its own.
//
// 🔒 If a page needs a number this file does not have, the number goes IN this
// file. Colour, radius and shadow live in index.css (@theme) — not here.

// The only spacing steps that exist (Adama, 21 Aug). Nothing between them.
export const space = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
  section: 28,   // page sections sit 24–32px apart
  card: 22,      // card padding is 20–24px
  grid: 16,      // gap between cards in a grid
};

// Size and weight make the hierarchy. Nothing is bold by default.
// 🔒 13px is the platform's standard body token (Adama, 21 Aug). Do NOT move
// the platform to 14–15px body text. Consistency here means a shared hierarchy,
// not every element at the same size.
export const type = {
  pageTitle: { size: 30, weight: 600 },      // 28–32
  sectionHeading: { size: 17, weight: 600 }, // 16–18
  metric: { size: 28, weight: 600 },         // 26–32
  body: { size: 13, weight: 400 },           // 🔒 the standard
  emphasis: { size: 14, weight: 500 },       // only where hierarchy needs it
  label: { size: 13, weight: 500 },          // UI labels and table content
  secondary: { size: 12, weight: 400 },      // metadata
};

// Operational screens may be dense; record and management screens breathe.
// Consistency means shared rules, not identical layouts.
export const density = {
  operational: { rowPadY: 10, minHeight: 44 },
  comfortable: { rowPadY: 14, minHeight: 56 },
};

// HOW A LIST ENDS — one pattern everywhere: the range being shown, the page
// buttons, and the rows-per-page choice. A list that scrolls forever never
// tells you how much there is.
// 🔒 The CONTROLS are identical across the platform — placement, the page-size
// selector, the interaction. The NUMBER is not: Pulse operational lists default
// to 25, admin to 10, and a stretched panel works its own out from the height it
// was given. Never change a page's established count just to match the other
// product.
export const pageEnding = {
  rows: 25,                 // Pulse operational lists
  options: [10, 25, 50],    // what a person may switch to
  cards: 12,                // a grid of cards pages at twelve
  panel: 8,                 // a side panel's FLOOR — fill the height where there is height to fill
};

// A dashboard leads with 3–5 metrics, never a wall of them.
export const dashboard = {
  minMetrics: 3,
  maxMetrics: 5,
};

// A list page may carry stat tiles only when they help understand or filter it.
export const list = {
  maxTiles: 5,
};

// A record header shows one status and at most three actions.
export const record = {
  maxHeaderActions: 3,
};
