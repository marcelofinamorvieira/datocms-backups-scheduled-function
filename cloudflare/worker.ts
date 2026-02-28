import {
  hasScheduledBackupFailures,
  runScheduledBackups,
  type ScheduledBackupsRunResult,
} from "../services/backupService";
import pluginHealthHandler from "../api/datocms/plugin-health";
import backupStatusHandler from "../api/datocms/backup-status";
import {
  buildErrorEnvelope,
  buildJsonResponse,
  normalizePathname,
  invokeVercelStyleHandler,
} from "../utils/platformAdapters";
import { validateBackupsSharedSecret } from "../utils/requestAuth";

const DAILY_CRON_SCHEDULE = "5 2 * * *";

type CloudflareBindings = {
  DATOCMS_FULLACCESS_API_TOKEN?: string;
  DATOCMS_BACKUPS_SHARED_SECRET?: string;
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

const buildHeadersRecord = (headers: Headers): Record<string, string> => {
  return Object.fromEntries(headers.entries());
};

const createCloudflareAuthErrorResponse = (failure: {
  statusCode: number;
  code: string;
  message: string;
}): Response => {
  return new Response(
    JSON.stringify(buildErrorEnvelope(failure.code, failure.message)),
    {
      status: failure.statusCode,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
};

const validateCloudflareRequestAuth = (
  request: Request,
  env: CloudflareBindings,
) => {
  return validateBackupsSharedSecret({
    headers: request.headers,
    sharedSecret: env.DATOCMS_BACKUPS_SHARED_SECRET,
  });
};

const resolveApiTokenFromBindings = (env: CloudflareBindings) =>
  env.DATOCMS_FULLACCESS_API_TOKEN;

type CloudflareWorkerDependencies = {
  runScheduled: (options: {
    apiToken?: string;
    providerHint?: "cloudflare";
  }) => Promise<ScheduledBackupsRunResult>;
  invokeHandler: typeof invokeVercelStyleHandler;
};

const createCloudflareWorker = (
  dependencies: Partial<CloudflareWorkerDependencies> = {},
) => {
  const runScheduled =
    dependencies.runScheduled ??
    ((options: { apiToken?: string; providerHint?: "cloudflare" }) =>
      runScheduledBackups(options));
  const invokeHandler = dependencies.invokeHandler ?? invokeVercelStyleHandler;

  return {
    async fetch(request: Request, env: CloudflareBindings): Promise<Response> {
      const url = new URL(request.url);
      const pathname = normalizePathname(url.pathname);
      const requestHeaders = buildHeadersRecord(request.headers);
      const bindingApiToken = resolveApiTokenFromBindings(env);

      if (pathname === "/api/datocms/plugin-health") {
        const body = await parseRequestBody(request);
        const response = await invokeHandler(pluginHealthHandler, {
          method: request.method,
          body,
          headers: requestHeaders,
          internalBackupsSharedSecret: env.DATOCMS_BACKUPS_SHARED_SECRET,
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

        const response = await invokeHandler(backupStatusHandler, {
          method: request.method,
          body,
          headers: requestHeaders,
          internalBackupsSharedSecret: env.DATOCMS_BACKUPS_SHARED_SECRET,
          internalDatocmsApiToken: bindingApiToken,
        });
        return buildResponseFromCapturedPayload(response);
      }

      if (pathname === "/api/jobs/scheduled-backups") {
        const authResult = validateCloudflareRequestAuth(request, env);
        if (!authResult.ok) {
          return createCloudflareAuthErrorResponse(authResult.failure);
        }

        try {
          const result = await runScheduled({
            apiToken: bindingApiToken,
            providerHint: "cloudflare",
          });
          if (hasScheduledBackupFailures(result)) {
            return new Response(
              JSON.stringify({
                ...buildErrorEnvelope(
                  "SCHEDULED_BACKUPS_PARTIAL_FAILURE",
                  "One or more scheduled backup cadences failed.",
                ),
                result,
              }),
              {
                status: 500,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Content-Type": "application/json; charset=utf-8",
                },
              },
            );
          }

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
        })
          .then((result) => {
            if (!hasScheduledBackupFailures(result)) {
              return;
            }

            const errorMessage =
              "Cloudflare scheduled backups completed with partial failures.";
            console.error(errorMessage, { result });
            throw new Error(errorMessage);
          })
          .catch((error) => {
            console.error("Cloudflare scheduled backups run failed", error);
            throw error;
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
