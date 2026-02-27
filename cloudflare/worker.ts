import {
  runDailyBackup,
  runScheduledBackups,
  runWeeklyBackup,
} from "../services/backupService";
import pluginHealthHandler from "../api/datocms/plugin-health";
import backupStatusHandler from "../api/datocms/backup-status";
import schedulerDisconnectHandler from "../api/datocms/scheduler-disconnect";
import backupNowHandler from "../api/datocms/backup-now";
import {
  buildErrorEnvelope,
  buildJsonResponse,
  normalizePathname,
  invokeVercelStyleHandler,
} from "../utils/platformAdapters";

const DAILY_CRON_SCHEDULE = "5 2 * * *";

type CloudflareBindings = {
  DATOCMS_FULLACCESS_API_TOKEN?: string;
  DATOCMS_FULLACCESS_TOKEN?: string;
};

type ScheduledController = {
  cron: string;
};

type ScheduledContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

const parseRequestBody = async (request: Request): Promise<unknown> => {
  const rawBody = await request.text();
  if (!rawBody.length) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
};

const buildResponseFromCapturedPayload = (payload: {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}) => {
  return new Response(payload.body, {
    status: payload.statusCode,
    headers: payload.headers,
  });
};

const resolveApiTokenFromBindings = (env: CloudflareBindings) =>
  env.DATOCMS_FULLACCESS_API_TOKEN || env.DATOCMS_FULLACCESS_TOKEN;

type CloudflareWorkerDependencies = {
  runDaily: (options: { apiToken?: string }) => Promise<unknown>;
  runWeekly: (options: { apiToken?: string }) => Promise<unknown>;
  runScheduled: (options: {
    apiToken?: string;
    providerHint?: "cloudflare";
  }) => Promise<unknown>;
};

const createCloudflareWorker = (
  dependencies: Partial<CloudflareWorkerDependencies> = {},
) => {
  const runDaily =
    dependencies.runDaily ??
    ((options: { apiToken?: string }) => runDailyBackup(options));
  const runWeekly =
    dependencies.runWeekly ??
    ((options: { apiToken?: string }) => runWeeklyBackup(options));
  const runScheduled =
    dependencies.runScheduled ??
    ((options: { apiToken?: string; providerHint?: "cloudflare" }) =>
      runScheduledBackups(options));

  return {
    async fetch(request: Request, env: CloudflareBindings): Promise<Response> {
      const url = new URL(request.url);
      const pathname = normalizePathname(url.pathname);

      if (pathname === "/api/datocms/plugin-health") {
        const body = await parseRequestBody(request);
        const response = await invokeVercelStyleHandler(pluginHealthHandler, {
          method: request.method,
          body,
        });
        return buildResponseFromCapturedPayload(response);
      }

      if (pathname === "/api/datocms/backup-status") {
        const rawBody = await parseRequestBody(request);
        const body =
          rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
            ? {
                ...rawBody,
                runtime: {
                  ...(typeof (rawBody as { runtime?: unknown }).runtime === "object" &&
                  (rawBody as { runtime?: unknown }).runtime &&
                  !Array.isArray((rawBody as { runtime?: unknown }).runtime)
                    ? ((rawBody as { runtime: Record<string, unknown> }).runtime ?? {})
                    : {}),
                  provider: "cloudflare",
                },
              }
            : rawBody;

        const response = await invokeVercelStyleHandler(backupStatusHandler, {
          method: request.method,
          body,
        });
        return buildResponseFromCapturedPayload(response);
      }

      if (pathname === "/api/datocms/scheduler-disconnect") {
        const body = await parseRequestBody(request);
        const response = await invokeVercelStyleHandler(
          schedulerDisconnectHandler,
          {
            method: request.method,
            body,
          },
        );
        return buildResponseFromCapturedPayload(response);
      }

      if (pathname === "/api/datocms/backup-now") {
        const body = await parseRequestBody(request);
        const response = await invokeVercelStyleHandler(backupNowHandler, {
          method: request.method,
          body,
        });
        return buildResponseFromCapturedPayload(response);
      }

      if (pathname === "/api/jobs/scheduled-backups") {
        try {
          const result = await runScheduled({
            apiToken: resolveApiTokenFromBindings(env),
            providerHint: "cloudflare",
          });
          return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        } catch (error) {
          const payload = buildErrorEnvelope(
            "INTERNAL_SERVER_ERROR",
            error instanceof Error
              ? error.message
              : "An unexpected internal error occurred",
          );
          return new Response(JSON.stringify(payload), {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        }
      }

      if (pathname === "/api/jobs/daily-backup") {
        try {
          const result = await runDaily({
            apiToken: resolveApiTokenFromBindings(env),
          });
          return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        } catch (error) {
          const payload = buildErrorEnvelope(
            "INTERNAL_SERVER_ERROR",
            error instanceof Error
              ? error.message
              : "An unexpected internal error occurred",
          );
          return new Response(JSON.stringify(payload), {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        }
      }

      if (pathname === "/api/jobs/weekly-backup") {
        try {
          const result = await runWeekly({
            apiToken: resolveApiTokenFromBindings(env),
          });
          return new Response(JSON.stringify({ ok: true, result }), {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        } catch (error) {
          const payload = buildErrorEnvelope(
            "INTERNAL_SERVER_ERROR",
            error instanceof Error
              ? error.message
              : "An unexpected internal error occurred",
          );
          return new Response(JSON.stringify(payload), {
            status: 500,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        }
      }

      const notFoundPayload = buildJsonResponse(
        404,
        buildErrorEnvelope("NOT_FOUND", "Requested route does not exist"),
      );

      return new Response(notFoundPayload.body, {
        status: notFoundPayload.statusCode,
        headers: notFoundPayload.headers,
      });
    },

    async scheduled(
      controller: ScheduledController,
      env: CloudflareBindings,
      context: ScheduledContext,
    ) {
      if (controller.cron !== DAILY_CRON_SCHEDULE) {
        return;
      }

      context.waitUntil(
        runScheduled({
          apiToken: resolveApiTokenFromBindings(env),
          providerHint: "cloudflare",
        }),
      );
    },
  };
};

export {
  createCloudflareWorker,
  DAILY_CRON_SCHEDULE,
};

export default createCloudflareWorker();
