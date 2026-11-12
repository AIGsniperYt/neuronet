// tests/commitments.mjs — pure recurring-commitment helpers. No IndexedDB.
import {
  WEEKDAY_ORDER,
  activeCommitments,
  addDays,
  commitmentsDueOn,
  completeOccurrence,
  countDueCommitments,
  formatCadence,
  nextOccurrenceDate,
  nextOccurrenceLabel,
  occurrenceStatus,
  occursOn,
  skipOccurrence,
  startOfWeek,
  summarizeCommitment,
  summarizeWeek,
  undoOccurrence,
  weekdayOf
} from "../src/tools/commitmentsModel.js";

let passed = 0;
let failed = 0;
const check = (name, cond, extra = "") => {
  if (cond) { passed += 1; console.log(`ok   ${name}`); }
  else { failed += 1; console.log(`FAIL ${name} ${extra}`); }
};
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `\n      got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const daily = (overrides = {}) => ({
  id: "c-daily",
  type: "commitment",
  title: "Biology recall",
  subject: "Biology",
  recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-01", endDate: "" },
  completions: {},
  archivedAt: null,
  ...overrides
});

const weekly = (weekdays, overrides = {}) => daily({
  id: `c-${weekdays.join("")}`,
  recurrence: { frequency: "weekly", weekdays, startDate: "2026-11-01", endDate: "" },
  ...overrides
});

export async function run() {
  const today = "2026-11-12"; // Thursday

  // ---- Calendar helpers -----------------------------------------------------
  eq("weekday 2026-11-12 is Thursday", weekdayOf(today), 4);
  eq("weekday 2026-11-15 is Sunday", weekdayOf("2026-11-15"), 0);
  eq("Monday starts the week", startOfWeek(today), "2026-11-09");
  eq("Sunday belongs to the same week", startOfWeek("2026-11-15"), "2026-11-09");
  eq("Monday is its own week start", startOfWeek("2026-11-09"), "2026-11-09");
  eq("addDays crosses a month", addDays("2026-11-30", 1), "2026-12-01");
  eq("addDays crosses a leap day", addDays("2024-02-28", 1), "2024-02-29");
  eq("addDays straddles a DST change", addDays("2026-03-28", 2), "2026-03-30");
  eq("invalid date key has no weekday", weekdayOf("nope"), -1);
  eq("UI weekday order is Monday first", WEEKDAY_ORDER, [1, 2, 3, 4, 5, 6, 0]);

  // ---- Occurrence rules -----------------------------------------------------
  const bounded = daily({
    recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-10", endDate: "2026-11-20" }
  });
  eq("daily starts before its start date", occursOn(bounded, "2026-11-09"), false);
  eq("daily includes its start date", occursOn(bounded, "2026-11-10"), true);
  eq("daily includes its end date", occursOn(bounded, "2026-11-20"), true);
  eq("daily stops after its end date", occursOn(bounded, "2026-11-21"), false);
  eq("archived commitment never occurs", occursOn({ ...daily(), archivedAt: 1 }, today), false);
  eq("missing schedule never occurs", occursOn({ ...daily(), recurrence: {} }, today), false);

  const mwf = weekly([1, 3, 5]);
  eq("weekly Monday occurs", occursOn(mwf, "2026-11-09"), true);
  eq("weekly Tuesday does not occur", occursOn(mwf, "2026-11-10"), false);
  eq("weekly Wednesday occurs", occursOn(mwf, "2026-11-11"), true);
  eq("weekly Friday occurs", occursOn(mwf, "2026-11-13"), true);
  eq("weekly Sunday does not occur", occursOn(mwf, "2026-11-15"), false);

  const sunday = weekly([0]);
  eq("Sunday schedule includes Sunday", occursOn(sunday, "2026-11-15"), true);
  eq("Sunday schedule excludes Monday", occursOn(sunday, "2026-11-16"), false);
  eq("all seven weekdays is daily", formatCadence({ frequency: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6] }), "Every day");

  // ---- Status and completion map -------------------------------------------
  eq("scheduled and unmarked is due", occurrenceStatus(daily(), today), "due");
  eq("not scheduled is none", occurrenceStatus(weekly([5]), today), "none");
  eq("completed is done", occurrenceStatus(daily({ completions: { [today]: { completedAt: 1 } } }), today), "done");
  eq("skipped is skipped", occurrenceStatus(daily({ completions: { [today]: { skipped: true, at: 1 } } }), today), "skipped");
  eq("archived status is none", occurrenceStatus({ ...daily(), archivedAt: 1 }, today), "none");

  const original = daily();
  const completed = completeOccurrence(original, today, { at: 123, via: "memory" });
  eq("complete sets the date entry", completed.completions[today], { completedAt: 123, via: "memory" });
  eq("complete does not mutate the original", original.completions, {});
  check("complete updates the timestamp", completed.updatedAt === 123);

  const skipped = skipOccurrence(original, today, { at: 456 });
  eq("skip sets the date entry", skipped.completions[today], { skipped: true, at: 456 });
  eq("skip does not mutate the original", original.completions, {});

  const undone = undoOccurrence(completed, today);
  eq("undo removes the date entry", undone.completions, {});
  check("undo keeps other entries", Object.keys(undoOccurrence({
    ...original,
    completions: { "2026-11-10": { completedAt: 1 }, [today]: { completedAt: 2 } }
  }, today).completions).includes("2026-11-10"));

  // ---- Next occurrence ------------------------------------------------------
  eq("open daily is due today", nextOccurrenceDate(daily(), today), today);
  eq("completed daily moves to tomorrow", nextOccurrenceDate(daily({ completions: { [today]: { completedAt: 1 } } }), today), "2026-11-13");
  eq("skipped daily moves to tomorrow", nextOccurrenceDate(daily({ completions: { [today]: { skipped: true, at: 1 } } }), today), "2026-11-13");
  eq("weekly skips to the next selected day", nextOccurrenceDate(mwf, "2026-11-10"), "2026-11-11");
  eq("weekly rolls over the weekend", nextOccurrenceDate(mwf, "2026-11-14"), "2026-11-16");
  eq("future start is respected", nextOccurrenceDate(daily({
    recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-20", endDate: "" }
  }), today), "2026-11-20");
  eq("ended schedule has no next date", nextOccurrenceDate(weekly([6], {
    recurrence: { frequency: "weekly", weekdays: [6], startDate: "2026-11-01", endDate: "2026-11-14" }
  }), "2026-11-15"), "");
  eq("archived has no next date", nextOccurrenceDate({ ...daily(), archivedAt: 1 }, today), "");
  eq("empty weekday set has no next date", nextOccurrenceDate(weekly([]), today), "");
  eq("skipCompleted false keeps today", nextOccurrenceDate(daily({ completions: { [today]: { completedAt: 1 } } }), today, { skipCompleted: false }), today);
  eq("next label is Today", nextOccurrenceLabel(daily(), today), "Today");
  eq("next label is Tomorrow", nextOccurrenceLabel(daily({ completions: { [today]: { completedAt: 1 } } }), today), "Tomorrow");
  eq("paused label", nextOccurrenceLabel({ ...daily(), archivedAt: 1 }, today), "Paused");
  eq("ended label", nextOccurrenceLabel(weekly([6], {
    recurrence: { frequency: "weekly", weekdays: [6], startDate: "2026-11-01", endDate: "2026-11-07" }
  }), today), "Ended");

  // ---- Cadence formatting ---------------------------------------------------
  eq("daily cadence", formatCadence({ frequency: "daily" }), "Every day");
  eq("weekly cadence lists days", formatCadence({ frequency: "weekly", weekdays: [5, 1, 3] }), "Mon, Wed, Fri");
  eq("single day cadence reads naturally", formatCadence({ frequency: "weekly", weekdays: [0] }), "Every Sun");
  eq("empty cadence is explicit", formatCadence({ frequency: "weekly", weekdays: [] }), "No days set");
  eq("missing cadence is explicit", formatCadence({}), "No schedule");

  // ---- Collections ----------------------------------------------------------
  const collection = [
    weekly([4], { id: "c-chem", title: "Chemistry recall", subject: "Chemistry" }),
    daily({ id: "c-bio", title: "Biology recall", subject: "Biology" }),
    weekly([5], { id: "c-fri", title: "Friday only", subject: "Maths" }),
    daily({ id: "c-archived", title: "Archived", archivedAt: 1 }),
    daily({
      id: "c-ended",
      title: "Ended",
      recurrence: { frequency: "daily", weekdays: [], startDate: "2026-11-01", endDate: "2026-11-11" }
    })
  ];
  const dueNow = commitmentsDueOn(collection, today);
  eq("due list excludes future, archived and ended", dueNow.map((c) => c.id), ["c-bio", "c-chem"]);
  eq("due list sorts by subject then title", dueNow.map((c) => c.subject), ["Biology", "Chemistry"]);
  eq("due count ignores completed and skipped", countDueCommitments([
    daily({ id: "a" }),
    daily({ id: "b", completions: { [today]: { completedAt: 1 } } }),
    daily({ id: "c", completions: { [today]: { skipped: true, at: 1 } } })
  ], today), 1);
  eq("active list excludes archived and ended", activeCommitments(collection, today).map((c) => c.id), ["c-chem", "c-bio", "c-fri"]);

  // ---- Weekly summary -------------------------------------------------------
  const week = summarizeWeek(mwf, today);
  eq("week starts Monday", week.startDate, "2026-11-09");
  eq("week ends Sunday", week.endDate, "2026-11-15");
  eq("week scheduled total", week.scheduled, 3);
  eq("week expected through today", week.expectedSoFar, 2);
  eq("week expected before today", week.expectedPast, 2);
  eq("week completed so far", week.completed, 0);
  eq("week adherence is zero with nothing done", week.adherence, 0);

  const weekDone = summarizeWeek(weekly([1, 3, 5], {
    completions: {
      "2026-11-09": { completedAt: 1 },
      "2026-11-11": { completedAt: 2 }
    }
  }), today);
  eq("week counts completed days", weekDone.completed, 2);
  eq("week is fully adherent so far", weekDone.adherence, 1);
  eq("week has no misses yet", weekDone.missed, 0);

  const weekMissed = summarizeWeek(weekly([1, 3, 5], {
    completions: { "2026-11-11": { completedAt: 2 } }
  }), today);
  eq("week counts a missed past day", weekMissed.missed, 1);
  eq("week adherence halves with one miss", weekMissed.adherence, 0.5);

  const dailyWeek = summarizeWeek(daily({
    completions: {
      "2026-11-09": { completedAt: 1 },
      "2026-11-10": { completedAt: 2 },
      "2026-11-11": { completedAt: 3 }
    }
  }), today);
  eq("open today is not a miss", dailyWeek.missed, 0);
  eq("open today is excluded from adherence", dailyWeek.adherence, 1);
  eq("open today is counted in the week-to-date", dailyWeek.expectedSoFar, 4);

  const mixedWeek = summarizeWeek(daily({
    completions: {
      "2026-11-09": { skipped: true, at: 1 },
      "2026-11-10": { completedAt: 2 }
    }
  }), today);
  eq("week tracks skips separately", mixedWeek.skipped, 1);
  eq("week counts missing days as missed", mixedWeek.missed, 1);
  eq("week adherence excludes skips from the numerator", mixedWeek.adherence, 1 / 3);

  // ---- Rolling summary ------------------------------------------------------
  const rolling = summarizeCommitment(daily({
    completions: {
      "2026-11-06": { completedAt: 1 },
      "2026-11-07": { skipped: true, at: 2 },
      "2026-11-09": { completedAt: 3 },
      "2026-11-10": { completedAt: 4 }
    }
  }), { todayKey: today, windowDays: 7 });
  eq("rolling window starts seven days back", rolling.startDate, "2026-11-06");
  eq("rolling window ends today", rolling.endDate, today);
  eq("rolling scheduled count includes today", rolling.scheduled, 7);
  eq("rolling expected-past excludes today", rolling.expectedPast, 6);
  eq("rolling completed count", rolling.completed, 3);
  eq("rolling skipped count", rolling.skipped, 1);
  eq("rolling missed count", rolling.missed, 2);
  eq("rolling adherence", rolling.adherence, 0.5);
  eq("rolling last completed date", rolling.lastCompletedDate, "2026-11-10");

  const empty = summarizeCommitment(weekly([0]), { todayKey: today, windowDays: 7 });
  eq("no scheduled days means no adherence", empty.adherence, 0);
  eq("no completions means no last date", empty.lastCompletedDate, "");

  return { passed, failed };
}
