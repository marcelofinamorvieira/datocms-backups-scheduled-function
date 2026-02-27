import assert from "node:assert/strict";
import test from "node:test";
import { handler as backupNowNetlifyHandler } from "../netlify/functions/backup-now";
import { handler as backupStatusNetlifyHandler } from "../netlify/functions/backup-status";
import { handler as pluginHealthNetlifyHandler } from "../netlify/functions/plugin-health";
import {
  BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_STATUS_EVENT_TYPE,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../utils/healthContract";

const createEvent = ({
  method = "POST",
  body,
}: {
  method?: string;
  body?: unknown;
}) => ({
  httpMethod: method,
  headers: {
    "content-type": "application/json",
  },
  body: body === undefined ? null : JSON.stringify(body),
});

test("netlify wrapper passes valid ping through plugin-health handler", async () => {
  const response = await pluginHealthNetlifyHandler(
    createEvent({
      body: {
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
      },
    }),
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
});

test("netlify wrapper preserves method validation response", async () => {
  const response = await pluginHealthNetlifyHandler(
    createEvent({
      method: "GET",
    }),
  );

  assert.equal(response.statusCode, 405);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("netlify backup-now wrapper preserves method validation response", async () => {
  const response = await backupNowNetlifyHandler(
    createEvent({
      method: "PUT",
    }),
  );

  assert.equal(response.statusCode, 405);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});

test("netlify backup-status wrapper preserves method validation response", async () => {
  const response = await backupStatusNetlifyHandler(
    createEvent({
      method: "GET",
      body: {
        event_type: BACKUPS_STATUS_EVENT_TYPE,
        mpi: {
          message: BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
          version: BACKUPS_MPI_VERSION,
        },
        plugin: {
          name: BACKUPS_PLUGIN_NAME,
          environment: "main",
        },
      },
    }),
  );

  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 405);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "METHOD_NOT_ALLOWED");
});
