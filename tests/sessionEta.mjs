// tests/sessionEta.mjs — pure ETA timing, estimation and formatting helpers.
import {
  computeCardDurationMs,
  estimateRemainingMs,
  formatEta,
  isTrustworthySample,
  median,
  summarizeCalibration
} from "../src/tools/sessionEta.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

export async function run() {
// ---- Timing ---------------------------------------------------------------
eq("card duration subtracts hidden time", computeCardDurationMs({ shownAt: 1000, gradedAt: 14000, hiddenMs: 3000 }), 10000);
eq("card duration caps a walk-away", computeCardDurationMs({ shownAt: 0, gradedAt: 900000 }), 300000);
eq("card duration rejects missing timestamps", computeCardDurationMs({ shownAt: null, gradedAt: 5000 }), null);
eq("card duration rejects negative time", computeCardDurationMs({ shownAt: 5000, gradedAt: 1000 }), null);

check("sub-400ms flip is not trusted", !isTrustworthySample({ flipMs: 399, dwellMs: 2000 }));
check("400ms flip is trusted", isTrustworthySample({ flipMs: 400, dwellMs: 2000 }));
check("sub-300ms dwell is not trusted", !isTrustworthySample({ flipMs: 2000, dwellMs: 299 }));
check("300ms dwell is trusted", isTrustworthySample({ flipMs: 2000, dwellMs: 300 }));

// ---- Median and estimation ------------------------------------------------
eq("even median averages the middle pair", median([5, 1, 3, 9]), 4);
eq("odd median picks the middle", median([9, 1, 5]), 5);
eq("empty median is zero", median([]), 0);

const warm = estimateRemainingMs({
  durationsMs: [9000, 12000, 15000, 10000],
  priorMs: 9000,
  remainingCards: 10,
  missRate: 0
});
eq("warm estimate reports its sample count", warm.sampleCount, 4);
eq("warm estimate uses the observed median over the prior", Math.round(warm.perCardMs), 10143);
eq("warm estimate multiplies by remaining cards", Math.round(warm.totalMs), 101429);

const cold = estimateRemainingMs({ durationsMs: [], priorMs: 8000, remainingCards: 5, missRate: 0 });
eq("cold estimate falls back to the prior", Math.round(cold.totalMs), 40000);
eq("cold estimate has no samples", cold.sampleCount, 0);

const missy = estimateRemainingMs({ durationsMs: [10000], priorMs: 10000, remainingCards: 10, missRate: 0.5 });
check("miss rate inflates the estimate", missy.totalMs > 100000 && missy.totalMs < 160000, String(missy.totalMs));
check("miss rate is capped", estimateRemainingMs({ durationsMs: [10000], priorMs: 10000, remainingCards: 1, missRate: 5 }).totalMs < 180000);

const done = estimateRemainingMs({ durationsMs: [10000], priorMs: 10000, remainingCards: 0 });
eq("no remaining cards means zero time", done.totalMs, 0);

const steady = estimateRemainingMs({ durationsMs: [10000, 10000, 10000, 10000], priorMs: 10000, remainingCards: 10, missRate: 0 });
eq("steady session keeps the confidence floor", Math.round((steady.highMs / steady.totalMs - 1) * 1000) / 1000, 0.3);

const noisy = estimateRemainingMs({ durationsMs: [2000, 20000, 3000, 19000], priorMs: 10000, remainingCards: 10, missRate: 0 });
check("noisy session widens the range", noisy.highMs > steady.highMs, `${noisy.highMs} vs ${steady.highMs}`);

// ---- Formatting -----------------------------------------------------------
const three = formatEta({ totalMs: 3 * 60000, lowMs: 2 * 60000, highMs: 4 * 60000, cardsLeft: 5, sampleCount: 4 });
eq("short estimate keeps minute detail", three.main, "≈3 min");
eq("short estimate shows its range", three.range, "2 min–4 min");
eq("cards line pluralises", three.cards, "5 cards left");

const seven = formatEta({ totalMs: 7.4 * 60000, lowMs: 5 * 60000, highMs: 10 * 60000, cardsLeft: 3, sampleCount: 3 });
eq("seven minutes does not collapse to five", seven.main, "≈7 min");

const fortyFive = formatEta({ totalMs: 45 * 60000, lowMs: 38 * 60000, highMs: 52 * 60000, cardsLeft: 20, sampleCount: 8 });
eq("long estimate uses five-minute steps", fortyFive.main, "≈45 min");
eq("long range uses five-minute steps", fortyFive.range, "40 min–50 min");

const hours = formatEta({ totalMs: 130 * 60000, lowMs: 115 * 60000, highMs: 145 * 60000, cardsLeft: 40, sampleCount: 9 });
eq("very long estimate reads in hours", hours.main, "≈2 h 10 min");

const seconds = formatEta({ totalMs: 40000, lowMs: 20000, highMs: 60000, cardsLeft: 2, sampleCount: 3 });
eq("under a minute shows seconds", seconds.main, "≈40 sec");
eq("sub-minute range is shown", seconds.range, "20 sec–1 min");

const secondsTight = formatEta({ totalMs: 40000, lowMs: 20000, highMs: 50000, cardsLeft: 2, sampleCount: 3 });
eq("sub-minute range stays in seconds below a minute", secondsTight.range, "20 sec–50 sec");

const last = formatEta({ totalMs: 45000, lowMs: 30000, highMs: 60000, cardsLeft: 1, sampleCount: 3 });
eq("final card is labelled", last.cards, "Last card");

const nearlyMinute = formatEta({ totalMs: 59000, lowMs: 50000, highMs: 68000, cardsLeft: 3, sampleCount: 4 });
eq("59 seconds reads as a minute, never 60 sec", nearlyMinute.main, "≈1 min");

const early = formatEta({ totalMs: 12 * 60000, lowMs: 6 * 60000, highMs: 18 * 60000, cardsLeft: 8, sampleCount: 1 });
eq("early estimate avoids false precision", early.main, "Estimating…");
check("early estimate still shows a range", early.range.length > 0, JSON.stringify(early));

eq("no cards hides the pill", formatEta({ totalMs: 60000, cardsLeft: 0 }).visible, false);

const tight = formatEta({ totalMs: 4 * 60000, lowMs: 3.6 * 60000, highMs: 4.4 * 60000, cardsLeft: 2, sampleCount: 8 });
eq("a tight range is hidden", tight.range, "");

// ---- Calibration ----------------------------------------------------------
const summary = summarizeCalibration([
  { actualMs: 600000, predictedMs: 540000, lowMs: 480000, highMs: 660000 },
  { actualMs: 900000, predictedMs: 720000, lowMs: 600000, highMs: 840000 },
  { actualMs: 300000, predictedMs: 360000, lowMs: 300000, highMs: 420000 }
]);
eq("calibration counts valid sessions", summary.count, 3);
eq("calibration counts range hits", summary.hits, 2);
eq("calibration reports coverage", summary.coverage, 2 / 3);
eq("calibration reports mean absolute error", summary.maeMs, 100000);
eq("empty calibration is null", summarizeCalibration([]), null);

return { passed, failed };
}
