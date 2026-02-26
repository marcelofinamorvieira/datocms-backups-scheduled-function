import assert from "node:assert/strict";
import test from "node:test";
import { createDailyBackupHandler } from "../api/jobs/daily-backup";
import { createInitializationHandler } from "../api/jobs/initialize";
import { createWeeklyBackupHandler } from "../api/jobs/weekly-backup";
import {
  invokeVercelStyleHandler,
  type VercelStyleHandler,
} from "../utils/platformAdapters";
import { runDailyBackupJob } from "../netlify/functions/dailyBackup/dailyBackup";
import { runInitializationJob } from "../netlify/functions/initialization/initialization";
import { runWeeklyBackupJob } from "../netlify/functions/weeklyBackup/weeklyBackup";

test("vercel daily route returns expected success payload", async () => {
  const handler = createDailyBackupHandler(async () => ({
    scope: "daily",
    createdEnvironmentId: "backup-plugin-daily-2026-02-26",
    deletedEnvironmentId: "backup-plugin-daily-2026-02-25",
  }));

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "POST",
      body: {},
    },
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.scope, "daily");
});

test("vercel daily route returns a skip payload for cron invocations outside assigned slot", async () => {
  let manualRunnerInvoked = false;
  let scheduledCadence: string | undefined;
  const handler = createDailyBackupHandler(
    async () => {
      manualRunnerInvoked = true;
      return {
        scope: "daily",
        createdEnvironmentId: "backup-plugin-daily-2026-02-26",
        deletedEnvironmentId: null,
      };
    },
    async (options) => {
      scheduledCadence = options?.cadence;
      return {
        scope: "daily",
        status: "skipped",
        schedule: {
          slotHourUtc: 16,
          slotWeekdayUtc: null,
          currentHourUtc: 12,
          currentWeekdayUtc: 4,
        },
      };
    },
  );

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "GET",
      body: {},
      headers: {
        "user-agent": "vercel-cron/1.0",
      },
    },
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.skipped, true);
  assert.equal(manualRunnerInvoked, false);
  assert.equal(scheduledCadence, "daily");
});

test("vercel daily GET without cron headers keeps hourly cadence mode", async () => {
  let scheduledCadence: string | undefined;
  const handler = createDailyBackupHandler(
    async () => ({
      scope: "daily",
      createdEnvironmentId: "backup-plugin-daily-2026-02-26",
      deletedEnvironmentId: null,
    }),
    async (options) => {
      scheduledCadence = options?.cadence;
      return {
        scope: "daily",
        status: "skipped",
        schedule: {
          slotHourUtc: 16,
          slotWeekdayUtc: null,
          currentHourUtc: 12,
          currentWeekdayUtc: 4,
        },
      };
    },
  );

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "GET",
      body: {},
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(scheduledCadence, "hourly");
});

test("vercel weekly route rejects unsupported methods", async () => {
  const handler = createWeeklyBackupHandler(async () => ({
    scope: "weekly",
    createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
    deletedEnvironmentId: null,
  }));

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "PUT",
      body: {},
    },
  );

  assert.equal(response.statusCode, 405);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("vercel weekly route uses daily cadence mode for cron invocations", async () => {
  let scheduledCadence: string | undefined;
  const handler = createWeeklyBackupHandler(
    async () => ({
      scope: "weekly",
      createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
      deletedEnvironmentId: null,
    }),
    async (options) => {
      scheduledCadence = options?.cadence;
      return {
        scope: "weekly",
        status: "skipped",
        schedule: {
          slotHourUtc: 19,
          slotWeekdayUtc: 4,
          currentHourUtc: 2,
          currentWeekdayUtc: 3,
        },
      };
    },
  );

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "GET",
      body: {},
      headers: {
        "x-vercel-cron": "1",
      },
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(scheduledCadence, "daily");
});

test("vercel initialize route returns success payload", async () => {
  const handler = createInitializationHandler(async () => ({
    daily: {
      scope: "daily",
      createdEnvironmentId: "backup-plugin-daily-2026-02-26",
      deletedEnvironmentId: null,
    },
    weekly: {
      scope: "weekly",
      createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
      deletedEnvironmentId: null,
    },
  }));

  const response = await invokeVercelStyleHandler(
    handler as unknown as VercelStyleHandler,
    {
      method: "POST",
      body: {},
    },
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.message, "Initialization completed successfully!");
});

test("netlify daily/weekly/initialization jobs run shared operations", async () => {
  const daily = await runDailyBackupJob(async () => ({
    scope: "daily",
    createdEnvironmentId: "backup-plugin-daily-2026-02-26",
    deletedEnvironmentId: null,
  }));
  assert.equal(daily.statusCode, 200);

  const weekly = await runWeeklyBackupJob(async () => ({
    scope: "weekly",
    createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
    deletedEnvironmentId: null,
  }));
  assert.equal(weekly.statusCode, 200);

  const initialization = await runInitializationJob(async () => ({
    daily: {
      scope: "daily",
      createdEnvironmentId: "backup-plugin-daily-2026-02-26",
      deletedEnvironmentId: null,
    },
    weekly: {
      scope: "weekly",
      createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
      deletedEnvironmentId: null,
    },
  }));
  assert.equal(initialization.statusCode, 200);
});
