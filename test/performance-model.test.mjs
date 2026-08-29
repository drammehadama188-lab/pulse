// The performance model, checked rather than trusted (Adama 29 Aug).
// The rule that matters most here is the one a page cannot show you: a source
// with no number must be ABSENT from the score, never counted as zero.
import {
  PERF_WEIGHTS, overallPerformance, kpiAttainment, workKpiScore,
  managerAssessment, perfStatus, scoreGrade,
} from '../lib/performance-model.js';

let bad = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

is('the three weights are 60 / 15 / 25', PERF_WEIGHTS, { work: 60, attendance: 15, manager: 25 });

// All three present: the plain weighted average.
is('all three sources', overallPerformance({ work: 60, attendance: 100, manager: 80 }), 71);

// 🔒 THE RULE. An unwritten review must not drag the score down.
const noReview = overallPerformance({ work: 58, attendance: 96, manager: null });
is('an unwritten review is absent, not zero', noReview, 66);
is('...and zero really is zero', overallPerformance({ work: 58, attendance: 96, manager: 0 }), 49);
if (noReview <= overallPerformance({ work: 58, attendance: 96, manager: 0 })) {
  bad++; console.log('✗ not reviewed scores no better than reviewed-as-zero');
}

is('nothing measurable is not a score', overallPerformance({ work: null, attendance: null, manager: null }), null);
is('one source alone carries the score', overallPerformance({ work: null, attendance: 90, manager: null }), 90);

// Attainment caps at 100 — beating a target cannot hide a miss elsewhere.
is('attainment caps at 100', kpiAttainment({ actual: 20, target: 10 }), 100);
is('no actual, no attainment', kpiAttainment({ actual: null, target: 10 }), null);
is('no target, no attainment', kpiAttainment({ actual: 5, target: 0 }), null);

// 🔒 The denominator is what is MEASURED. A KPI nothing feeds is not a miss.
const card = { kpis: [
  { label: 'Tracker sales', actual: 2, target: 5, weight: 40 },
  { label: 'Trackers online', actual: null, target: 75, weight: 20 },
] };
const w = workKpiScore(card);
is('unmeasured KPIs leave the denominator', [w.met, w.measured, w.total], [0, 1, 2]);
is('...and are named', w.unmeasured, ['Trackers online']);
is('score is the measured one', w.pct, 40);
is('nothing measured at all', workKpiScore({ kpis: [{ label: 'x', actual: null, target: 5, weight: 10 }] }).pct, null);

// 🔒 Only a locked review is an assessment.
// ⚠️ Axes are stored as PERCENTAGES (0–100) — this is what the review form
// has always written. Reading them as 1–5 stars turned an 80 into 1600%.
const reviews = [{ period: '2026-07', ratings: { Sales: 95, Attendance: 90, Communication: 85, 'Customer rating': 90, Initiative: 80 } }];
is('no review for the month', managerAssessment(reviews, '2026-08').reviewed, false);
is('...contributes nothing', managerAssessment(reviews, '2026-08').pct, null);
is('axes average as percentages', managerAssessment(reviews, '2026-07').pct, 88);
is('stars are only how that percentage is drawn', managerAssessment(reviews, '2026-07').stars, 4);
is('an axis is never read as a star rating', managerAssessment([{ period: '2026-07', ratings: { Sales: 80 } }], '2026-07').pct, 80);
is('a review with a score and no axes still counts', managerAssessment([{ period: '2026-07', score: 62 }], '2026-07').pct, 62);

is('70 is on track', perfStatus(70), 'on-track');
is('69 needs attention', perfStatus(69), 'needs-attention');
is('no score is not a bad score', perfStatus(null), 'not-scored');
is('90 is excellent', scoreGrade(90).id, 'excellent');
is('49 is poor', scoreGrade(49).id, 'poor');

if (bad) { console.error(`\n✗ ${bad} performance-model failure(s).`); process.exit(1); }
console.log('\n✓ Performance model: the score is calculated, and what is unknown stays unknown.');
