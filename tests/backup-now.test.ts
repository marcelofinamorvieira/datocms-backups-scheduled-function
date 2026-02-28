import assert from "node:assert/strict";
import test from "node:test";
import { createBackupNowHandler } from "../api/datocms/backup-now";
import { CadenceNotEnabledError } from "../services/backupService";
import { invokeVercelStyleHandler } from "../utils/platformAdapters";
import {
  BACKUPS_BACKUP_NOW_EVENT_TYPE,
  BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE,
  BACKUPS_MPI_BACKUP_NOW_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
} from "../utils/healthContract";

process.env.DATOCMS_BACKUPS_SHARED_SECRET = "test-shared-secret";

const withAuthHeaders = (sharedSecret = "test-shared-secret") => ({
  "x-datocms-backups-auth": sharedSecret,
});

const createValidRequestBody = () => ({
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
});

test("backup-now returns deterministic payload for valid request", async () => {
  const handler = createBackupNowHandler(async () => ({
    scope: "daily",
    status: "executed",
    executionMode: "lambda_cron",
    createdEnvironmentId: "backup-plugin-daily-2026-02-27",
    deletedEnvironmentId: null,
    completedAt: "2026-02-27T12:00:00.000Z",
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
    message: BACKUPS_MPI_BACKUP_NOW_RESPONSE_MESSAGE,
    version: BACKUPS_MPI_VERSION,
  });
  assert.equal(payload.service, BACKUPS_SERVICE_NAME);
  assert.equal(payload.status, BACKUPS_SERVICE_STATUS);
  assert.equal(payload.backup.scope, "daily");
  assert.equal(payload.backup.executionMode, "lambda_cron");
  assert.equal(payload.backup.createdEnvironmentId, "backup-plugin-daily-2026-02-27");
});

test("backup-now rejects unsupported methods", async () => {
  const handler = createBackupNowHandler(async () => {
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

test("backup-now validates slot scope", async () => {
  const handler = createBackupNowHandler(async () => {
    throw new Error("should not be called");
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: {
      ...createValidRequestBody(),
      slot: {
        scope: "yearly",
      },
    },
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_SLOT_SCOPE");
});

test("backup-now returns 409 when cadence is disabled", async () => {
  const handler = createBackupNowHandler(async () => {
    throw new CadenceNotEnabledError("monthly");
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: {
      ...createValidRequestBody(),
      slot: {
        scope: "monthly",
      },
    },
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 409);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "CADENCE_NOT_ENABLED");
});

test("backup-now returns 500 when backup execution fails", async () => {
  const handler = createBackupNowHandler(async () => ({
    scope: "daily",
    status: "failed",
    error: "fork failed",
    checkedAt: "2026-02-27T12:00:00.000Z",
  }));

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 500);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "BACKUP_NOW_FAILED");
});

test("backup-now rejects missing auth header", async () => {
  const handler = createBackupNowHandler(async () => {
    throw new Error("should not be called");
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
  });

  assert.equal(response.statusCode, 401);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "UNAUTHORIZED");
});
