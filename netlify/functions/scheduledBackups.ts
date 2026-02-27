import { schedule } from "@netlify/functions";
import {
  runScheduledBackups,
  type ScheduledBackupsRunResult,
} from "../../services/backupService";

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

export const runScheduledBackupsJob = async (
  runJob: () => Promise<ScheduledBackupsRunResult> = () => runScheduledBackups(),
): Promise<NetlifyResponse> => {
  try {
    const result = await runJob();
    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
};

export const handler = schedule(SCHEDULED_BACKUPS_NETLIFY_CRON, async () => {
  return runScheduledBackupsJob();
});
