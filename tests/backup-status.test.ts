import assert from "node:assert/strict";
import test from "node:test";
import { createBackupStatusHandler } from "../api/datocms/backup-status";
import { invokeVercelStyleHandler } from "../utils/platformAdapters";
import {
  BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
  BACKUPS_MPI_STATUS_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
  BACKUPS_STATUS_EVENT_TYPE,
} from "../utils/healthContract";

process.env.DATOCMS_BACKUPS_SHARED_SECRET = "test-shared-secret";
const withAuthHeaders = () => ({
  "x-datocms-backups-auth": "test-shared-secret",
});

const createValidRequestBody = () => ({
  event_type: BACKUPS_STATUS_EVENT_TYPE,
  mpi: {
    message: BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
    version: BACKUPS_MPI_VERSION,
  },
  plugin: {
    name: BACKUPS_PLUGIN_NAME,
    environment: "main",
  },
});

test("backup status returns deterministic payload for valid request", async () => {
  const handler = createBackupStatusHandler(async () => ({
    scheduler: {
      provider: "vercel",
      cadence: "daily",
    },
    slots: {
      daily: {
        scope: "daily",
        executionMode: "lambda_cron",
        lastBackupAt: "2026-02-27T01:00:00.000Z",
        nextBackupAt: "2026-02-28T02:05:00.000Z",
      },
      weekly: {
        scope: "weekly",
        executionMode: "lambda_cron",
        lastBackupAt: "2026-02-25T02:35:00.000Z",
        nextBackupAt: "2026-03-04T02:35:00.000Z",
      },
    },
    checkedAt: "2026-02-27T12:00:00.000Z",
  }));

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.mpi, {
    message: BACKUPS_MPI_STATUS_RESPONSE_MESSAGE,
    version: BACKUPS_MPI_VERSION,
  });
  assert.equal(payload.service, BACKUPS_SERVICE_NAME);
  assert.equal(payload.status, BACKUPS_SERVICE_STATUS);
  assert.equal(payload.scheduler.provider, "vercel");
  assert.equal(payload.slots.daily.executionMode, "lambda_cron");
});

test("backup status forwards internal api token hint to service loader", async () => {
  let receivedApiToken: string | undefined;
  const handler = createBackupStatusHandler(async (options) => {
    receivedApiToken = options?.apiToken;
    return {
      scheduler: {
        provider: "cloudflare",
        cadence: "daily",
      },
      slots: {
        daily: {
          scope: "daily",
          executionMode: "lambda_cron",
          lastBackupAt: null,
          nextBackupAt: null,
        },
        weekly: {
          scope: "weekly",
          executionMode: "lambda_cron",
          lastBackupAt: null,
          nextBackupAt: null,
        },
      },
      checkedAt: "2026-02-27T12:00:00.000Z",
    };
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
    headers: withAuthHeaders(),
    internalDatocmsApiToken: "cloudflare-bound-token",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedApiToken, "cloudflare-bound-token");
});

test("backup status rejects unsupported methods", async () => {
  const handler = createBackupStatusHandler(async () => {
    throw new Error("should not be called");
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "GET",
    body: undefined,
  });

  assert.equal(response.statusCode, 405);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("backup status rejects non-compliant payloads", async () => {
  const handler = createBackupStatusHandler(async () => {
    throw new Error("should not be called");
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: {
      ...createValidRequestBody(),
      plugin: {
        name: "wrong-plugin",
        environment: "main",
      },
    },
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_PLUGIN_NAME");
});
