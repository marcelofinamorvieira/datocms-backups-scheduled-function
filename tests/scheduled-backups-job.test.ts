import assert from "node:assert/strict";
import test from "node:test";
import { createScheduledBackupsHandler } from "../api/jobs/scheduled-backups";
import { runScheduledBackupsJob } from "../netlify/functions/scheduledBackups";
import { invokeVercelStyleHandler } from "../utils/platformAdapters";
import { createCloudflareWorker } from "../cloudflare/worker";

const SHARED_SECRET = "test-shared-secret";
process.env.DATOCMS_BACKUPS_SHARED_SECRET = SHARED_SECRET;

const createResult = (status: "executed" | "failed") => ({
  scheduler: {
    provider: "vercel" as const,
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

const withAuthHeaders = () => ({
  "x-datocms-backups-auth": SHARED_SECRET,
});

test("scheduled backups API returns 500 when at least one cadence fails", async () => {
  const handler = createScheduledBackupsHandler(async () => createResult("failed"));

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: {},
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "SCHEDULED_BACKUPS_PARTIAL_FAILURE");
  assert.equal(payload.result.results[0].status, "failed");
});

test("scheduled backups API returns 200 when all cadences execute", async () => {
  const handler = createScheduledBackupsHandler(async () => createResult("executed"));

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: {},
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.results[0].status, "executed");
});

test("netlify scheduled job helper returns 500 on partial failure", async () => {
  const response = await runScheduledBackupsJob(async () => createResult("failed"));
  assert.equal(response.statusCode, 500);
  const payload = JSON.parse(response.body ?? "{}");
  assert.equal(payload.error.code, "SCHEDULED_BACKUPS_PARTIAL_FAILURE");
});

test("cloudflare /api/jobs/scheduled-backups returns 500 on partial failure", async () => {
  const worker = createCloudflareWorker({
    runScheduled: async () => createResult("failed"),
  });

  const response = await worker.fetch(
    new Request("https://example.com/api/jobs/scheduled-backups", {
      method: "POST",
      headers: {
        "X-Datocms-Backups-Auth": SHARED_SECRET,
      },
    }),
    {
      DATOCMS_BACKUPS_SHARED_SECRET: SHARED_SECRET,
    },
  );

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error.code, "SCHEDULED_BACKUPS_PARTIAL_FAILURE");
});
