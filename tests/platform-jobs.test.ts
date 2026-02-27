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

test("vercel daily GET route executes compatibility backup handler", async () => {
  let called = false;
  const handler = createDailyBackupHandler(async () => {
    called = true;
    return {
      scope: "daily",
      createdEnvironmentId: "backup-plugin-daily-2026-02-26",
      deletedEnvironmentId: null,
    };
  });

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
  assert.equal(called, true);
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

test("vercel weekly GET route executes compatibility backup handler", async () => {
  let called = false;
  const handler = createWeeklyBackupHandler(async () => {
    called = true;
    return {
      scope: "weekly",
      createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
      deletedEnvironmentId: null,
    };
  });

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
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(called, true);
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
