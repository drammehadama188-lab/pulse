// The hiring stages, in the order a call actually goes. Shared by every screen
// in Recruitment so a count on the dashboard and a chip on the list can never
// disagree.
//
// 🔒 The keys are stored on the record and must stay in step with
// APPLICANT_STAGES in server.js — the PUT silently ignores a stage the server
// does not know, so the dropdown looks like it works and nothing saves.
//
// One colour per stage, everywhere in the product (Adama's design rules,
// 20 Aug 2026). Red is reserved for rejection, so it keeps its meaning: the
// other ways someone leaves are grey, not alarming.
export const STAGES = [
  ['cv_received', 'CV Received', 'bg-[var(--color-stage-new-bg)] text-[var(--color-stage-new)]', 'bg-[var(--color-stage-new)]'],
  ['no_answer', 'Called, no answer', 'bg-[var(--color-stage-screening-bg)] text-[var(--color-stage-screening)]', 'bg-[var(--color-stage-screening)]'],
  ['unreachable', 'Unreachable', 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', 'bg-[var(--color-ink-faint)]'],
  ['not_interested', 'Not interested', 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', 'bg-[var(--color-ink-faint)]'],
  ['not_qualified', 'Not qualified', 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]', 'bg-[var(--color-ink-faint)]'],
  ['interviewed', 'Interviewed', 'bg-[var(--color-stage-interview-bg)] text-[var(--color-stage-interview)]', 'bg-[var(--color-stage-interview)]'],
  ['shortlisted', 'Shortlisted', 'bg-[var(--color-stage-short-bg)] text-[var(--color-stage-short)]', 'bg-[var(--color-stage-short)]'],
  ['offer', 'Offer', 'bg-[var(--color-stage-offer-bg)] text-[var(--color-stage-offer)]', 'bg-[var(--color-stage-offer)]'],
  ['hired', 'Hired', 'bg-[var(--color-stage-hired-bg)] text-[var(--color-stage-hired)]', 'bg-[var(--color-stage-hired)]'],
  ['rejected', 'Rejected', 'bg-[var(--color-stage-out-bg)] text-[var(--color-stage-out)]', 'bg-[var(--color-stage-out)]'],
];

// The pipeline is the six steps someone moves THROUGH. The ways out of it —
// dead number, not interested, not qualified, rejected — are counted as
// drop-off instead, or the bar would read as if a hire went backwards.
export const PIPELINE = [
  ['new', 'New', ['cv_received'], 'var(--color-stage-new)'],
  ['screening', 'Screening', ['no_answer'], 'var(--color-stage-screening)'],
  ['interview', 'Interview', ['interviewed'], 'var(--color-stage-interview)'],
  ['shortlisted', 'Shortlisted', ['shortlisted'], 'var(--color-stage-short)'],
  ['offer', 'Offer', ['offer'], 'var(--color-stage-offer)'],
  ['hired', 'Hired', ['hired'], 'var(--color-stage-hired)'],
];
export const DROPPED = ['unreachable', 'not_interested', 'not_qualified', 'rejected'];

// Which stages mean a given thing happened. A stage is a point on the way
// through, so the counts are built from sets, not from one key.
export const CALLED = ['no_answer', 'unreachable', 'not_interested', 'not_qualified', 'interviewed', 'shortlisted', 'offer', 'hired', 'rejected'];
export const REACHED = ['not_interested', 'not_qualified', 'interviewed', 'shortlisted', 'offer', 'hired', 'rejected'];
export const INTERVIEWED = ['interviewed', 'shortlisted', 'offer', 'hired', 'rejected'];
export const SHORTLISTED = ['shortlisted', 'offer', 'hired'];
export const OFFERED = ['offer', 'hired'];

export const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l]));
