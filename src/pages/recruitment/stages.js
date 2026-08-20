// The hiring stages, in the order a call actually goes. Shared by every screen
// in Recruitment so a count on the dashboard and a chip on the list can never
// disagree.
//
// 🔒 The keys are stored on the record and must stay in step with
// APPLICANT_STAGES in server.js — the PUT silently ignores a stage the server
// does not know, so the dropdown looks like it works and nothing saves.
export const STAGES = [
  ['cv_received', 'CV Received', 'bg-blue-50 text-blue-700', 'bg-blue-500'],
  ['no_answer', 'Called, no answer', 'bg-orange-50 text-orange-700', 'bg-orange-400'],
  ['unreachable', 'Unreachable', 'bg-gray-100 text-gray-500', 'bg-gray-400'],
  ['not_interested', 'Not interested', 'bg-rose-50 text-rose-700', 'bg-rose-400'],
  ['not_qualified', 'Not qualified', 'bg-gray-100 text-gray-500', 'bg-gray-400'],
  ['interviewed', 'Interviewed', 'bg-amber-50 text-amber-700', 'bg-amber-500'],
  ['hired', 'Hired', 'bg-emerald-50 text-emerald-700', 'bg-emerald-500'],
  ['rejected', 'Rejected', 'bg-gray-100 text-gray-500', 'bg-gray-400'],
];

// Which stages mean a given thing happened. A stage is a point on the way
// through, so the counts are built from sets, not from one key.
export const CALLED = ['no_answer', 'unreachable', 'not_interested', 'not_qualified', 'interviewed', 'hired', 'rejected'];
export const REACHED = ['not_interested', 'not_qualified', 'interviewed', 'hired', 'rejected'];
export const INTERVIEWED = ['interviewed', 'hired', 'rejected'];

export const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l]));
