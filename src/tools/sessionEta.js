// Pure session-ETA helpers for the Memory tool.
//
// Two timers feed this module:
//   flipMs  = revealedAt - shownAt     (existing responseTimeMs — recognition)
//   cardMs  = gradedAt - shownAt       (new — full card, including answer review)
//
// The estimator only needs a robust per-card duration and a repeat inflation.
// Formatting is deliberately adaptive: short sessions keep minute detail, long
// sessions get calmer 5/10-minute steps, and seconds only appear under a minute.

export const ETA_MAX_CARD_MS = 300000;
export const ETA_MIN_FLIP_MS = 400;
export const ETA_MIN_DWELL_MS = 300;
export const ETA_DEFAULT_PRIOR_MS = 9000;

export function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function median(values = []) {
  const list = (values || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

export function computeCardDurationMs({ shownAt, gradedAt, hiddenMs = 0, maxMs = ETA_MAX_CARD_MS } = {}) {
  if (shownAt == null || gradedAt == null) return null;
  const start = Number(shownAt);
  const end = Number(gradedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const raw = end - start - Math.max(0, Number(hiddenMs) || 0);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.min(raw, Math.max(1, Number(maxMs) || ETA_MAX_CARD_MS));
}

export function isTrustworthySample({ flipMs, dwellMs } = {}) {
  const flip = Number(flipMs);
  const dwell = Number(dwellMs);
  if (Number.isFinite(flip) && flip >= 0 && flip < ETA_MIN_FLIP_MS) return false;
  if (Number.isFinite(dwell) && dwell >= 0 && dwell < ETA_MIN_DWELL_MS) return false;
  return true;
}

export function estimateRemainingMs({
  durationsMs = [],
  priorMs = ETA_DEFAULT_PRIOR_MS,
  remainingCards = 0,
  missRate = 0
} = {}) {
  const durations = (durationsMs || []).filter((value) => Number.isFinite(value) && value > 0);
  const sampleCount = durations.length;
  const prior = clampNumber(Number(priorMs) || ETA_DEFAULT_PRIOR_MS, 1500, 120000);
  const observed = sampleCount ? median(durations) : prior;
  // A small pseudo-count for the prior stops one unusually slow card from
  // taking over the estimate.
  const blended = sampleCount ? (observed * sampleCount + prior * 3) / (sampleCount + 3) : prior;
  const repeatFactor = 1 + clampNumber(Number(missRate) || 0, 0, 0.9) * 0.8;
  const perCardMs = clampNumber(blended * repeatFactor, 1500, 180000);
  const cards = Math.max(0, Math.floor(Number(remainingCards) || 0));
  const totalMs = cards * perCardMs;
  // Start wide while the session is cold, then tighten with sample count. A
  // noisy session widens it again via the median absolute deviation, so the
  // range reflects real dispersion rather than confidence alone.
  let spread = sampleCount >= 6 ? 0.22 : sampleCount >= 3 ? 0.3 : sampleCount >= 1 ? 0.42 : 0.5;
  if (sampleCount >= 3 && observed > 0) {
    const deviation = median(durations.map((value) => Math.abs(value - observed)));
    const relative = clampNumber((1.4826 * deviation) / observed, 0, 0.6);
    spread = Math.max(spread, relative);
  }
  return {
    totalMs,
    lowMs: totalMs * (1 - spread),
    highMs: totalMs * (1 + spread),
    perCardMs,
    sampleCount
  };
}

// Planner-friendly estimate for a known number of review cards. This is
// deliberately read-only: it borrows the calibrated pace from finished
// sessions but never feeds anything back into SRS scheduling.
export function estimateCardsMs({ cards = 0, records = [], priorMs = ETA_DEFAULT_PRIOR_MS } = {}) {
  const count = Math.max(0, Math.floor(Number(cards) || 0));
  if (count === 0) return 0;

  const samples = (records || [])
    .map((record) => {
      const actual = Number(record?.actualMs);
      const graded = Number(record?.graded);
      const seen = graded > 0 ? graded : Number(record?.cards);
      if (!(actual > 0) || !(seen > 0)) return null;
      return actual / seen;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const prior = clampNumber(Number(priorMs) || ETA_DEFAULT_PRIOR_MS, 1500, 120000);
  const perCardMs = samples.length
    ? clampNumber(median(samples), 1500, 120000)
    : prior;
  return Math.round(perCardMs * count);
}

function stepForMinutes(minutes) {
  if (minutes < 30) return 1;
  if (minutes < 120) return 5;
  return 10;
}

function roundToStep(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

function formatMinutes(minutes) {
  const whole = Math.max(0, Math.round(minutes));
  if (whole >= 120) {
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${whole} min`;
}

function formatSeconds(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return whole < 60 ? `${whole} sec` : formatMinutes(whole / 60);
}

export function formatEta({ totalMs = 0, lowMs = 0, highMs = 0, cardsLeft = 0, sampleCount = 0 } = {}) {
  const cards = Math.max(0, Math.floor(Number(cardsLeft) || 0));
  if (cards <= 0 || !(Number(totalMs) > 0)) {
    return { visible: false, main: "", range: "", cards: "", cardsLeft: cards, sampleCount };
  }

  const cardsLabel = cards === 1 ? "Last card" : `${cards} cards left`;

  if (totalMs < 60000) {
    const seconds = Math.max(10, Math.round(totalMs / 10000) * 10);
    // 59 s rounds to 60; switch to "1 min" rather than reading "60 sec".
    if (seconds < 60) {
      const lowSeconds = Math.max(10, Math.floor(Math.max(0, lowMs) / 10000) * 10);
      const highSeconds = Math.max(lowSeconds + 10, Math.ceil(Math.max(lowMs, highMs) / 10000) * 10);
      const range = sampleCount >= 2 && highSeconds - lowSeconds >= 20
        ? `${formatSeconds(lowSeconds)}–${formatSeconds(highSeconds)}`
        : "";
      return {
        visible: true,
        main: `≈${seconds} sec`,
        range,
        cards: cardsLabel,
        cardsLeft: cards,
        sampleCount
      };
    }
  }

  const totalMinutes = totalMs / 60000;
  const step = stepForMinutes(totalMinutes);
  const mainMinutes = roundToStep(totalMinutes, step);

  let lowMinutes = Math.max(1, Math.round((Math.max(0, lowMs) / 60000) / step) * step);
  let highMinutes = Math.max(lowMinutes, Math.round((Math.max(lowMs, highMs) / 60000) / step) * step);
  // A range narrower than two steps is noise, not information.
  const minWidth = 2 * step;
  const range = highMinutes - lowMinutes >= minWidth
    ? `${formatMinutes(lowMinutes)}–${formatMinutes(highMinutes)}`
    : "";

  return {
    visible: true,
    main: sampleCount < 2 ? "Estimating…" : `≈${formatMinutes(mainMinutes)}`,
    range,
    cards: cardsLabel,
    cardsLeft: cards,
    sampleCount
  };
}

export function summarizeCalibration(records = []) {
  const valid = (records || []).filter((record) => (
    Number.isFinite(Number(record?.actualMs))
    && Number.isFinite(Number(record?.predictedMs))
  ));
  if (valid.length === 0) return null;

  const errors = valid.map((record) => Math.abs(Number(record.actualMs) - Number(record.predictedMs)));
  const maeMs = errors.reduce((sum, error) => sum + error, 0) / valid.length;
  const hits = valid.filter((record) => (
    Number(record.actualMs) >= Number(record.lowMs)
    && Number(record.actualMs) <= Number(record.highMs)
  )).length;
  return {
    count: valid.length,
    maeMs,
    coverage: hits / valid.length,
    hits
  };
}
