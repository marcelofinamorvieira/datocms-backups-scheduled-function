import assert from "node:assert/strict";
import test from "node:test";
import {
  createCloudflareWorker,
  DAILY_CRON_SCHEDULE,
} from "../cloudflare/worker";
import {
  BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
  BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
  BACKUPS_STATUS_EVENT_TYPE,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../utils/healthContract";

const withClearedApiTokens = async (run: () => Promise<void>) => {
  const previousPrimary = process.env.DATOCMS_FULLACCESS_API_TOKEN;
  const previousLegacy = process.env.DATOCMS_FULLACCESS_TOKEN;

  delete process.env.DATOCMS_FULLACCESS_API_TOKEN;
  delete process.env.DATOCMS_FULLACCESS_TOKEN;

  try {
    await run();
  } finally {
    if (typeof previousPrimary === "string") {
      process.env.DATOCMS_FULLACCESS_API_TOKEN = previousPrimary;
    } else {
      delete process.env.DATOCMS_FULLACCESS_API_TOKEN;
    }

    if (typeof previousLegacy === "string") {
      process.env.DATOCMS_FULLACCESS_TOKEN = previousLegacy;
    } else {
      delete process.env.DATOCMS_FULLACCESS_TOKEN;
    }
  }
};

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

test("cloudflare worker triggers scheduled unified job for daily cron", async () => {
  const calls: string[] = [];
  const waitUntilCalls: Promise<unknown>[] = [];

  const worker = createCloudflareWorker({
    runScheduled: async () => {
      calls.push("scheduled");
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

  await Promise.all(waitUntilCalls);
  assert.deepEqual(calls, ["scheduled"]);
});

test("cloudflare worker exposes backup-status route", async () => {
  await withClearedApiTokens(async () => {
    const worker = createCloudflareWorker();

    const response = await worker.fetch(
      new Request("https://example.com/api/datocms/backup-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: BACKUPS_STATUS_EVENT_TYPE,
          mpi: {
            message: BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
            version: BACKUPS_MPI_VERSION,
          },
          plugin: {
            name: BACKUPS_PLUGIN_NAME,
            environment: "main",
          },
        }),
      }),
      {},
    );

    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "MISSING_API_TOKEN");
  });
});

test("cloudflare worker exposes scheduler-disconnect route", async () => {
  await withClearedApiTokens(async () => {
    const worker = createCloudflareWorker();

    const response = await worker.fetch(
      new Request("https://example.com/api/datocms/scheduler-disconnect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
          mpi: {
            message: BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
            version: BACKUPS_MPI_VERSION,
          },
          plugin: {
            name: BACKUPS_PLUGIN_NAME,
            environment: "main",
          },
        }),
      }),
      {},
    );

    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "MISSING_API_TOKEN");
  });
});
