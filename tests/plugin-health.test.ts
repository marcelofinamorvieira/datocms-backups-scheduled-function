import assert from "node:assert/strict";
import test from "node:test";
import pluginHealthHandler from "../api/datocms/plugin-health";
import { invokeVercelStyleHandler } from "../utils/platformAdapters";
import {
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_PONG_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../utils/healthContract";

const SHARED_SECRET = "test-shared-secret";
const previousSharedSecret = process.env.DATOCMS_BACKUPS_SHARED_SECRET;
process.env.DATOCMS_BACKUPS_SHARED_SECRET = SHARED_SECRET;

const withAuthHeaders = (headers: Record<string, string> = {}) => ({
  "x-datocms-backups-auth": SHARED_SECRET,
  ...headers,
});

const createValidRequestBody = () => ({
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
});

test("plugin health returns deterministic pong for valid ping", async () => {
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
    method: "POST",
    body: createValidRequestBody(),
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload, {
    ok: true,
    mpi: {
      message: BACKUPS_MPI_PONG_MESSAGE,
      version: BACKUPS_MPI_VERSION,
    },
    service: BACKUPS_SERVICE_NAME,
    status: BACKUPS_SERVICE_STATUS,
  });
});

test("plugin health rejects unsupported methods with envelope", async () => {
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
    method: "GET",
    body: undefined,
  });

  assert.equal(response.statusCode, 405);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("plugin health rejects invalid JSON payload", async () => {
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
    method: "POST",
    body: "{",
    headers: withAuthHeaders(),
  });

  assert.equal(response.statusCode, 400);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_JSON");
});

test("plugin health rejects non-compliant request body", async () => {
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
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

test("plugin health rejects missing auth header", async () => {
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
    method: "POST",
    body: createValidRequestBody(),
  });

  assert.equal(response.statusCode, 401);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "UNAUTHORIZED");
});

test("plugin health falls back to default secret when shared secret is not configured", async () => {
  delete process.env.DATOCMS_BACKUPS_SHARED_SECRET;
  const response = await invokeVercelStyleHandler(pluginHealthHandler, {
    method: "POST",
    body: createValidRequestBody(),
    headers: {
      "x-datocms-backups-auth": "superSecretToken",
    },
  });

  process.env.DATOCMS_BACKUPS_SHARED_SECRET = SHARED_SECRET;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
});

process.on("exit", () => {
  if (typeof previousSharedSecret === "string") {
    process.env.DATOCMS_BACKUPS_SHARED_SECRET = previousSharedSecret;
  } else {
    delete process.env.DATOCMS_BACKUPS_SHARED_SECRET;
  }
});
