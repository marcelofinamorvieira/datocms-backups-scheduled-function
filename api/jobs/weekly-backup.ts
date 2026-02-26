import {
  MissingApiTokenError,
  runWeeklyBackup,
  runScheduledWeeklyBackup,
  type ScheduledCadence,
  type ScheduledScopedBackupResult,
  type ScopedBackupResult,
} from "../../services/backupService";
import type { VercelRequest, VercelResponse } from "../../types/vercel";

const setCorsHeaders = (res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );
};

const createErrorPayload = (code: string, message: string) => ({
  ok: false,
  error: {
    code,
    message,
    details: {},
  },
});

const getHeaderValue = (
  headers: Record<string, unknown> | undefined,
  headerName: string,
): string | undefined => {
  if (!headers) {
    return undefined;
  }

  const normalizedName = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === normalizedName && typeof value === "string") {
      return value;
    }
  }

  return undefined;
};

const isTruthyFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => isTruthyFlag(entry));
  }

  return false;
};

const readForceFlagFromUrl = (url: unknown): boolean => {
  if (typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url, "https://example.invalid");
    return isTruthyFlag(parsed.searchParams.get("force"));
  } catch {
    return false;
  }
};

const isForceRunRequested = (req: VercelRequest): boolean => {
  const query = req.query as Record<string, unknown> | undefined;
  if (isTruthyFlag(query?.force)) {
    return true;
  }

  if (readForceFlagFromUrl(req.url)) {
    return true;
  }

  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const body = req.body as Record<string, unknown>;
    if (isTruthyFlag(body.force)) {
      return true;
    }
  }

  return isTruthyFlag(
    getHeaderValue(
      req.headers as Record<string, unknown> | undefined,
      "x-datocms-force-run",
    ),
  );
};

const isVercelCronInvocation = (req: VercelRequest): boolean => {
  const headers = req.headers as Record<string, unknown> | undefined;
  const userAgent = getHeaderValue(headers, "user-agent");
  if (userAgent?.toLowerCase().includes("vercel-cron")) {
    return true;
  }

  return Boolean(getHeaderValue(headers, "x-vercel-cron"));
};

const createScheduledSkipPayload = (result: ScheduledScopedBackupResult) => ({
  ok: true,
  skipped: true,
  reason: "NOT_DUE_IN_DISTRIBUTED_SLOT",
  scope: result.scope,
  schedule: result.schedule,
});

export const createWeeklyBackupHandler = (
  runBackup: () => Promise<ScopedBackupResult> = () => runWeeklyBackup(),
  runScheduledBackup: (options?: { cadence?: ScheduledCadence }) => Promise<ScheduledScopedBackupResult> = (
    options,
  ) => runScheduledWeeklyBackup(options),
) => {
  return async (req: VercelRequest, res: VercelResponse) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res
        .status(405)
        .json(createErrorPayload("METHOD_NOT_ALLOWED", "Only GET and POST are supported."));
      return;
    }

    try {
      const isCronInvocation = isVercelCronInvocation(req);
      const shouldUseDistributedSchedule =
        (req.method === "GET" || isCronInvocation) && !isForceRunRequested(req);

      if (shouldUseDistributedSchedule) {
        const scheduledResult = await runScheduledBackup({
          cadence: isCronInvocation ? "daily" : "hourly",
        });
        if (scheduledResult.status === "skipped") {
          res.status(200).json(createScheduledSkipPayload(scheduledResult));
          return;
        }

        res.status(200).json({
          ok: true,
          result: scheduledResult.result,
          schedule: scheduledResult.schedule,
        });
        return;
      }

      const result = await runBackup();
      res.status(200).json({
        ok: true,
        result,
      });
      return;
    } catch (error) {
      if (error instanceof MissingApiTokenError) {
        res
          .status(500)
          .json(
            createErrorPayload(
              "MISSING_API_TOKEN",
              "Missing API token. Configure DATOCMS_FULLACCESS_API_TOKEN (or legacy DATOCMS_FULLACCESS_TOKEN).",
            ),
          );
        return;
      }

      res
        .status(500)
        .json(
          createErrorPayload(
            "INTERNAL_SERVER_ERROR",
            error instanceof Error
              ? error.message
              : "An unexpected internal error occurred.",
          ),
        );
      return;
    }
  };
};

export default createWeeklyBackupHandler();
