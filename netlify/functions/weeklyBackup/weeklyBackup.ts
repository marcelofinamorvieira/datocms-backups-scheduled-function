import { Handler } from "@netlify/functions";
import {
  runWeeklyBackup,
  type ScopedBackupResult,
} from "../../../services/backupService";

type NetlifyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
  "Access-Control-Allow-Headers": "*",
};

const createSuccessResponse = (result: ScopedBackupResult): NetlifyResponse => ({
  statusCode: 200,
  headers: BASE_HEADERS,
  body: JSON.stringify({
    ok: true,
    result,
  }),
});

const createErrorResponse = (error: unknown): NetlifyResponse => ({
  statusCode: 500,
  headers: {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      details: {},
    },
  }),
});

const createMethodNotAllowedResponse = (): NetlifyResponse => ({
  statusCode: 405,
  headers: {
    ...BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    ok: false,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Only GET, POST and OPTIONS are supported.",
      details: {},
    },
  }),
});

export const runWeeklyBackupJob = async (
  runJob: () => Promise<ScopedBackupResult> = () => runWeeklyBackup(),
): Promise<NetlifyResponse> => {
  try {
    const result = await runJob();
    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: BASE_HEADERS,
    };
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return createMethodNotAllowedResponse();
  }

  return runWeeklyBackupJob();
};
