import assert from "node:assert/strict";
import test from "node:test";
import {
  getNextDueDateForCadence,
  isCadenceDue,
  normalizeBackupSchedule,
  toTimezoneLocalDateKey,
} from "../services/backupService";

test("daily cadence is due on current local date unless it already ran today", () => {
  const anchor = "2026-02-20";
  assert.equal(
    isCadenceDue({
      cadence: "daily",
      anchorLocalDate: anchor,
      currentLocalDate: "2026-02-27",
      lastRunLocalDate: undefined,
    }),
    true,
  );

  assert.equal(
    isCadenceDue({
      cadence: "daily",
      anchorLocalDate: anchor,
      currentLocalDate: "2026-02-27",
      lastRunLocalDate: "2026-02-27",
    }),
    false,
  );
});

test("weekly cadence uses anchor day and 7-day intervals", () => {
  assert.equal(
    isCadenceDue({
      cadence: "weekly",
      anchorLocalDate: "2026-02-26",
      currentLocalDate: "2026-03-05",
      lastRunLocalDate: undefined,
    }),
    true,
  );

  assert.equal(
    isCadenceDue({
      cadence: "weekly",
      anchorLocalDate: "2026-02-26",
      currentLocalDate: "2026-03-04",
      lastRunLocalDate: undefined,
    }),
    false,
  );
});

test("biweekly cadence stays anchored across month/year boundaries", () => {
  assert.equal(
    isCadenceDue({
      cadence: "biweekly",
      anchorLocalDate: "2025-12-25",
      currentLocalDate: "2026-01-08",
      lastRunLocalDate: undefined,
    }),
    true,
  );

  assert.equal(
    isCadenceDue({
      cadence: "biweekly",
      anchorLocalDate: "2025-12-25",
      currentLocalDate: "2026-01-15",
      lastRunLocalDate: undefined,
    }),
    false,
  );
});

test("monthly cadence clamps day 31 to shorter months", () => {
  assert.equal(
    getNextDueDateForCadence({
      cadence: "monthly",
      anchorLocalDate: "2026-01-31",
      currentLocalDate: "2026-02-01",
      lastRunLocalDate: undefined,
    }),
    "2026-02-28",
  );

  assert.equal(
    getNextDueDateForCadence({
      cadence: "monthly",
      anchorLocalDate: "2024-01-31",
      currentLocalDate: "2024-02-01",
      lastRunLocalDate: undefined,
    }),
    "2024-02-29",
  );
});

test("next due date moves to the next interval after current-day execution", () => {
  assert.equal(
    getNextDueDateForCadence({
      cadence: "daily",
      anchorLocalDate: "2026-02-26",
      currentLocalDate: "2026-02-26",
      lastRunLocalDate: "2026-02-26",
    }),
    "2026-02-27",
  );

  assert.equal(
    getNextDueDateForCadence({
      cadence: "weekly",
      anchorLocalDate: "2026-02-26",
      currentLocalDate: "2026-03-05",
      lastRunLocalDate: "2026-03-05",
    }),
    "2026-03-12",
  );
});

test("schedule normalization falls back to daily+weekly and valid timezone", () => {
  const normalized = normalizeBackupSchedule({
    value: {
      version: 99,
      enabledCadences: [],
      timezone: "Invalid/Zone",
      lambdalessTime: "99:99",
    },
    timezoneFallback: "America/New_York",
    now: new Date("2026-02-27T10:00:00.000Z"),
  });

  assert.equal(normalized.config.version, 1);
  assert.deepEqual(normalized.config.enabledCadences, ["daily", "weekly"]);
  assert.equal(normalized.config.timezone, "America/New_York");
  assert.equal(normalized.config.lambdalessTime, "00:00");
  assert.equal(normalized.requiresMigration, true);
});

test("timezone local date key tracks project timezone date boundaries", () => {
  const utcDate = new Date("2026-02-27T02:30:00.000Z");
  assert.equal(toTimezoneLocalDateKey(utcDate, "UTC"), "2026-02-27");
  assert.equal(
    toTimezoneLocalDateKey(utcDate, "America/Los_Angeles"),
    "2026-02-26",
  );
});
