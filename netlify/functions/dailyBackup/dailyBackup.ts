import { schedule } from "@netlify/functions";
import {
  runScheduledDailyBackup,
  type ScheduledScopedBackupResult,
  type ScopedBackupResult,
} from "../../../services/backupService";

type NetlifyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

export const DAILY_NETLIFY_CRON_SCHEDULE = "5 * * * *";

const createSuccessResponse = (result: ScopedBackupResult): NetlifyResponse => ({
  statusCode: 200,
  headers: {
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify({
    ok: true,
    result,
  }),
});

const createSkipResponse = (result: ScheduledScopedBackupResult): NetlifyResponse => ({
  statusCode: 200,
  headers: {
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify({
    ok: true,
    skipped: true,
    reason: "NOT_DUE_IN_DISTRIBUTED_SLOT",
    scope: result.scope,
    schedule: result.schedule,
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

const isScheduledBackupResult = (
  value: ScopedBackupResult | ScheduledScopedBackupResult,
): value is ScheduledScopedBackupResult => {
  return Boolean(value) && typeof value === "object" && "status" in value;
};

export const runDailyBackupJob = async (
  runJob: () => Promise<ScopedBackupResult | ScheduledScopedBackupResult> = () =>
    runScheduledDailyBackup(),
): Promise<NetlifyResponse> => {
  try {
    const result = await runJob();

    if (isScheduledBackupResult(result)) {
      if (result.status === "skipped") {
        return createSkipResponse(result);
      }

      return createSuccessResponse(result.result);
    }

    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
};

export const handler = schedule(DAILY_NETLIFY_CRON_SCHEDULE, async () => {
  return runDailyBackupJob();
});
