import assert from "node:assert/strict";
import test from "node:test";
import {
  createCloudflareWorker,
  DAILY_CRON_SCHEDULE,
  WEEKLY_CRON_SCHEDULE,
} from "../cloudflare/worker";
import {
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../utils/healthContract";

test("cloudflare worker exposes plugin-health route", async () => {
  const worker = createCloudflareWorker({
    runDaily: async () => ({
      scope: "daily",
      createdEnvironmentId: "backup-plugin-daily-2026-02-26",
      deletedEnvironmentId: null,
    }),
    runWeekly: async () => ({
      scope: "weekly",
      createdEnvironmentId: "backup-plugin-weekly-2026-02-26",
      deletedEnvironmentId: null,
    }),
  });

  const response = await worker.fetch(
    new Request("https://example.com/api/datocms/plugin-health", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: PLUGIN_HEALTH_EVENT_TYPE,
        mpi: {
          message: BACKUPS_MPI_PING_MESSAGE,
          version: BACKUPS_MPI_VERSION,
          phase: "config_connect",
        },
        plugin: {
          name: BACKUPS_PLUGIN_NAME,
          environment: "main",
        },
      }),
    }),
    {},
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

test("cloudflare worker triggers scheduled jobs for daily and weekly crons", async () => {
  const calls: string[] = [];
  const waitUntilCalls: Promise<unknown>[] = [];

  const worker = createCloudflareWorker({
    runDaily: async () => {
      calls.push("daily");
      return { ok: true };
    },
    runWeekly: async () => {
      calls.push("weekly");
      return { ok: true };
    },
  });

  await worker.scheduled(
    { cron: DAILY_CRON_SCHEDULE },
    { DATOCMS_FULLACCESS_API_TOKEN: "token" },
    {
      waitUntil: (promise) => {
        waitUntilCalls.push(promise);
      },
    },
  );

  await worker.scheduled(
    { cron: WEEKLY_CRON_SCHEDULE },
    { DATOCMS_FULLACCESS_TOKEN: "legacy-token" },
    {
      waitUntil: (promise) => {
        waitUntilCalls.push(promise);
      },
    },
  );

  await Promise.all(waitUntilCalls);
  assert.deepEqual(calls, ["daily", "weekly"]);
});
