import assert from "node:assert/strict";
import test from "node:test";
import {
  getDistributedScheduleWindow,
  isDistributedScheduleDue,
  runScheduledDailyBackup,
  runScheduledWeeklyBackup,
} from "../services/backupService";

test("distributed schedule slots are deterministic and within expected UTC ranges", () => {
  const apiToken = "test-token";
  const first = getDistributedScheduleWindow(
    "weekly",
    apiToken,
    new Date("2026-02-26T00:00:00.000Z"),
  );
  const second = getDistributedScheduleWindow(
    "weekly",
    apiToken,
    new Date("2026-06-26T00:00:00.000Z"),
  );

  assert.equal(first.slotHourUtc, second.slotHourUtc);
  assert.equal(first.slotWeekdayUtc, second.slotWeekdayUtc);
  assert.ok(first.slotHourUtc >= 0 && first.slotHourUtc <= 23);
  assert.ok(first.slotWeekdayUtc !== null && first.slotWeekdayUtc >= 0 && first.slotWeekdayUtc <= 6);
});

test("distributed due check validates daily hour matching", () => {
  const schedule = {
    slotHourUtc: 13,
    slotWeekdayUtc: null,
    currentHourUtc: 13,
    currentWeekdayUtc: 4,
  };
  assert.equal(isDistributedScheduleDue("daily", schedule), true);
  assert.equal(
    isDistributedScheduleDue("daily", {
      ...schedule,
      currentHourUtc: 12,
    }),
    false,
  );
});

test("distributed due check supports daily cadence mode for hobby-compatible crons", () => {
  const dailySchedule = {
    slotHourUtc: 13,
    slotWeekdayUtc: null,
    currentHourUtc: 2,
    currentWeekdayUtc: 4,
  };
  assert.equal(isDistributedScheduleDue("daily", dailySchedule, "daily"), true);

  const weeklySchedule = {
    slotHourUtc: 19,
    slotWeekdayUtc: 4,
    currentHourUtc: 2,
    currentWeekdayUtc: 4,
  };
  assert.equal(isDistributedScheduleDue("weekly", weeklySchedule, "daily"), true);
  assert.equal(
    isDistributedScheduleDue(
      "weekly",
      {
        ...weeklySchedule,
        currentWeekdayUtc: 5,
      },
      "daily",
    ),
    false,
  );
});

test("scheduled daily backup skips outside assigned hour without calling Dato", async () => {
  const apiToken = "test-token";
  const schedule = getDistributedScheduleWindow(
    "daily",
    apiToken,
    new Date("2026-02-26T00:00:00.000Z"),
  );
  const outsideAssignedHour = new Date("2026-02-26T00:00:00.000Z");
  outsideAssignedHour.setUTCHours((schedule.slotHourUtc + 1) % 24, 0, 0, 0);

  const result = await runScheduledDailyBackup({
    apiToken,
    now: outsideAssignedHour,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.scope, "daily");
});

test("scheduled weekly backup skips outside assigned weekday/hour without calling Dato", async () => {
  const apiToken = "test-token";
  const schedule = getDistributedScheduleWindow(
    "weekly",
    apiToken,
    new Date("2026-02-26T00:00:00.000Z"),
  );
  const outsideAssignedHour = new Date("2026-02-26T00:00:00.000Z");
  outsideAssignedHour.setUTCHours((schedule.slotHourUtc + 1) % 24, 0, 0, 0);

  const result = await runScheduledWeeklyBackup({
    apiToken,
    now: outsideAssignedHour,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.scope, "weekly");
});
