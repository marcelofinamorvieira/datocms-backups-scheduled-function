import { schedule } from "@netlify/functions";
import {
  hasScheduledBackupFailures,
  runScheduledBackups,
  type ScheduledBackupsRunResult,
} from "../../services/backupService";
import { validateBackupsSharedSecret } from "../../utils/requestAuth";

type NetlifyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

export const SCHEDULED_BACKUPS_NETLIFY_CRON = "5 2 * * *";

const createSuccessResponse = (result: ScheduledBackupsRunResult): NetlifyResponse => ({
  statusCode: 200,
  headers: {
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify({
    ok: true,
    result,
  }),
});

const createErrorResponse = (error: unknown): NetlifyResponse => ({
  statusCode: 500,
  headers: {
    "Access-Control-Allow-Origin": "*",
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

const createPartialFailureResponse = (
  result: ScheduledBackupsRunResult,
): NetlifyResponse => ({
  statusCode: 500,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    ok: false,
    error: {
      code: "SCHEDULED_BACKUPS_PARTIAL_FAILURE",
      message: "One or more scheduled backup cadences failed.",
      details: {},
    },
    result,
  }),
});

const createAuthErrorResponse = (failure: {
  code: string;
  message: string;
  statusCode: number;
}): NetlifyResponse => ({
  statusCode: failure.statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      details: {},
    },
  }),
});

export const runScheduledBackupsJob = async (
  runJob: () => Promise<ScheduledBackupsRunResult> = () => runScheduledBackups(),
): Promise<NetlifyResponse> => {
  try {
    const result = await runJob();
    if (hasScheduledBackupFailures(result)) {
      return createPartialFailureResponse(result);
    }
    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
};

export const handler = schedule(SCHEDULED_BACKUPS_NETLIFY_CRON, async (event) => {
  if (event && typeof event === "object" && "headers" in event && event.headers) {
    const authResult = validateBackupsSharedSecret({
      headers: event.headers as Record<string, unknown> | undefined,
    });
    if (!authResult.ok) {
      return createAuthErrorResponse(authResult.failure);
    }
  }

  return runScheduledBackupsJob();
});
