import assert from "node:assert/strict";
import test from "node:test";
import { createSchedulerDisconnectHandler } from "../api/datocms/scheduler-disconnect";
import { AutomaticBackupsPluginNotFoundError } from "../services/backupService";
import { invokeVercelStyleHandler } from "../utils/platformAdapters";
import {
  BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
  BACKUPS_MPI_SCHEDULER_DISCONNECT_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
} from "../utils/healthContract";

const createValidRequestBody = () => ({
  event_type: BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
  mpi: {
    message: BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
    version: BACKUPS_MPI_VERSION,
  },
  plugin: {
    name: BACKUPS_PLUGIN_NAME,
    environment: "main",
  },
});

test("scheduler-disconnect returns deterministic payload for valid request", async () => {
  const handler = createSchedulerDisconnectHandler(async () => ({
    enabled: false,
    disabledAt: "2026-02-27T15:00:00.000Z",
    pluginId: "123",
  }));

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.mpi, {
    message: BACKUPS_MPI_SCHEDULER_DISCONNECT_RESPONSE_MESSAGE,
    version: BACKUPS_MPI_VERSION,
  });
  assert.equal(payload.service, BACKUPS_SERVICE_NAME);
  assert.equal(payload.status, BACKUPS_SERVICE_STATUS);
  assert.equal(payload.scheduler.enabled, false);
  assert.equal(payload.scheduler.disconnectedAt, "2026-02-27T15:00:00.000Z");
  assert.equal(payload.plugin.id, "123");
});

test("scheduler-disconnect rejects unsupported methods", async () => {
  const handler = createSchedulerDisconnectHandler(async () => {
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

test("scheduler-disconnect rejects invalid payloads", async () => {
  const handler = createSchedulerDisconnectHandler(async () => {
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
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_PLUGIN_NAME");
});

test("scheduler-disconnect returns PLUGIN_NOT_FOUND when plugin cannot be resolved", async () => {
  const handler = createSchedulerDisconnectHandler(async () => {
    throw new AutomaticBackupsPluginNotFoundError();
  });

  const response = await invokeVercelStyleHandler(handler, {
    method: "POST",
    body: createValidRequestBody(),
  });

  assert.equal(response.statusCode, 404);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "PLUGIN_NOT_FOUND");
});
