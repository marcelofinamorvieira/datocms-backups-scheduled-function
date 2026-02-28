import assert from "node:assert/strict";
import test from "node:test";
import {
  createCloudflareWorker,
  DAILY_CRON_SCHEDULE,
} from "../cloudflare/worker";
import {
  BACKUPS_BACKUP_NOW_EVENT_TYPE,
  BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE,
  BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_STATUS_EVENT_TYPE,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../utils/healthContract";

const SHARED_SECRET = "test-shared-secret";

const createScheduledResult = (status: "executed" | "failed" = "executed") => ({
  scheduler: {
    provider: "cloudflare" as const,
    cadence: "daily" as const,
  },
  schedule: {
    timezone: "UTC",
    enabledCadences: ["daily", "weekly"] as const,
    anchorLocalDate: "2026-02-27",
  },
  checkedAt: "2026-02-27T12:00:00.000Z",
  skipped: false,
  results:
    status === "executed"
      ? [
          {
            scope: "daily" as const,
            status: "executed" as const,
            result: {
              scope: "daily" as const,
              createdEnvironmentId: "backup-plugin-daily-2026-02-27",
              deletedEnvironmentId: null,
            },
          },
        ]
      : [
          {
            scope: "daily" as const,
            status: "failed" as const,
            error: "fork failed",
          },
        ],
});

const withClearedApiTokens = async (run: () => Promise<void>) => {
  const previousPrimary = process.env.DATOCMS_FULLACCESS_API_TOKEN;

  delete process.env.DATOCMS_FULLACCESS_API_TOKEN;

  try {
    await run();
  } finally {
    if (typeof previousPrimary === "string") {
      process.env.DATOCMS_FULLACCESS_API_TOKEN = previousPrimary;
    } else {
      delete process.env.DATOCMS_FULLACCESS_API_TOKEN;
    }
  }
};

test("cloudflare worker exposes plugin-health route", async () => {
  const worker = createCloudflareWorker();

  const response = await worker.fetch(
    new Request("https://example.com/api/datocms/plugin-health", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datocms-Backups-Auth": SHARED_SECRET,
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
    { DATOCMS_BACKUPS_SHARED_SECRET: SHARED_SECRET },
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
      return createScheduledResult("executed");
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

test("cloudflare worker scheduled hook rejects waitUntil promise on partial failures", async () => {
  const waitUntilCalls: Promise<unknown>[] = [];

  const worker = createCloudflareWorker({
    runScheduled: async () => createScheduledResult("failed"),
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

  assert.equal(waitUntilCalls.length, 1);
  await assert.rejects(waitUntilCalls[0]);
});

test("cloudflare worker forwards bound api token to datocms route handlers", async () => {
  let capturedInternalApiToken: string | undefined;
  const worker = createCloudflareWorker({
    invokeHandler: async (_handler, request) => {
      capturedInternalApiToken = request.internalDatocmsApiToken;
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ ok: true }),
      };
    },
  });

  const response = await worker.fetch(
    new Request("https://example.com/api/datocms/backup-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datocms-Backups-Auth": SHARED_SECRET,
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
    {
      DATOCMS_BACKUPS_SHARED_SECRET: SHARED_SECRET,
      DATOCMS_FULLACCESS_API_TOKEN: "cloudflare-bound-token",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedInternalApiToken, "cloudflare-bound-token");
});

test("cloudflare worker exposes backup-status route", async () => {
  await withClearedApiTokens(async () => {
    const worker = createCloudflareWorker();

    const response = await worker.fetch(
      new Request("https://example.com/api/datocms/backup-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Datocms-Backups-Auth": "superSecretToken",
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
      { DATOCMS_BACKUPS_SHARED_SECRET: "" },
    );

    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "MISSING_API_TOKEN");
  });
});

test("cloudflare worker exposes backup-now route and injects runtime provider", async () => {
  let capturedInternalApiToken: string | undefined;
  let capturedRuntimeProvider: string | undefined;

  const worker = createCloudflareWorker({
    invokeHandler: async (_handler, request) => {
      capturedInternalApiToken = request.internalDatocmsApiToken;
      const body =
        request.body && typeof request.body === "object" && !Array.isArray(request.body)
          ? (request.body as { runtime?: { provider?: string } })
          : undefined;
      capturedRuntimeProvider = body?.runtime?.provider;
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ ok: true }),
      };
    },
  });

  const response = await worker.fetch(
    new Request("https://example.com/api/datocms/backup-now", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datocms-Backups-Auth": SHARED_SECRET,
      },
      body: JSON.stringify({
        event_type: BACKUPS_BACKUP_NOW_EVENT_TYPE,
        mpi: {
          message: BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE,
          version: BACKUPS_MPI_VERSION,
        },
        plugin: {
          name: BACKUPS_PLUGIN_NAME,
          environment: "main",
        },
        slot: {
          scope: "daily",
        },
      }),
    }),
    {
      DATOCMS_BACKUPS_SHARED_SECRET: SHARED_SECRET,
      DATOCMS_FULLACCESS_API_TOKEN: "cloudflare-bound-token",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedInternalApiToken, "cloudflare-bound-token");
  assert.equal(capturedRuntimeProvider, "cloudflare");
});
