import type { VercelRequest, VercelResponse } from "../../types/vercel";
import {
  getBackupStatus,
  MissingApiTokenError,
  type BackupStatusResult,
  type SchedulerProvider,
} from "../../services/backupService";
import {
  BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
  BACKUPS_MPI_STATUS_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
  BACKUPS_STATUS_EVENT_TYPE,
} from "../../utils/healthContract";

type ValidationError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

type BackupStatusRequestPayload = {
  event_type?: unknown;
  mpi?: {
    message?: unknown;
    version?: unknown;
  };
  plugin?: {
    name?: unknown;
    environment?: unknown;
  };
  runtime?: {
    provider?: unknown;
  };
};

const setCorsHeaders = (res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );
};

const sendError = (
  res: VercelResponse,
  statusCode: number,
  error: ValidationError,
) => {
  res.status(statusCode).json({
    ok: false,
    error,
  });
};

const parseBody = (body: unknown): BackupStatusRequestPayload => {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid-body");
      }

      return parsed as BackupStatusRequestPayload;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new SyntaxError("INVALID_JSON");
      }

      throw new Error("INVALID_BODY");
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("INVALID_BODY");
  }

  return body as BackupStatusRequestPayload;
};

const toProvider = (value: unknown): SchedulerProvider | undefined => {
  if (
    value === "vercel" ||
    value === "netlify" ||
    value === "cloudflare" ||
    value === "unknown"
  ) {
    return value;
  }

  return undefined;
};

const validatePayload = (
  payload: BackupStatusRequestPayload,
): ValidationError | null => {
  if (payload.event_type !== BACKUPS_STATUS_EVENT_TYPE) {
    return {
      code: "INVALID_EVENT_TYPE",
      message: `event_type must be ${BACKUPS_STATUS_EVENT_TYPE}`,
      details: {
        expected: BACKUPS_STATUS_EVENT_TYPE,
        received: payload.event_type,
      },
    };
  }

  if (payload.mpi?.message !== BACKUPS_MPI_STATUS_REQUEST_MESSAGE) {
    return {
      code: "INVALID_MPI_MESSAGE",
      message: `mpi.message must be ${BACKUPS_MPI_STATUS_REQUEST_MESSAGE}`,
      details: {
        expected: BACKUPS_MPI_STATUS_REQUEST_MESSAGE,
        received: payload.mpi?.message,
      },
    };
  }

  if (payload.mpi?.version !== BACKUPS_MPI_VERSION) {
    return {
      code: "INVALID_MPI_VERSION",
      message: `mpi.version must be ${BACKUPS_MPI_VERSION}`,
      details: {
        expected: BACKUPS_MPI_VERSION,
        received: payload.mpi?.version,
      },
    };
  }

  if (payload.plugin?.name !== BACKUPS_PLUGIN_NAME) {
    return {
      code: "INVALID_PLUGIN_NAME",
      message: `plugin.name must be ${BACKUPS_PLUGIN_NAME}`,
      details: {
        expected: BACKUPS_PLUGIN_NAME,
        received: payload.plugin?.name,
      },
    };
  }

  const pluginEnvironment =
    typeof payload.plugin?.environment === "string"
      ? payload.plugin.environment.trim()
      : "";

  if (!pluginEnvironment) {
    return {
      code: "INVALID_PLUGIN_ENVIRONMENT",
      message: "plugin.environment must be a non-empty string",
      details: {
        received: payload.plugin?.environment,
      },
    };
  }

  if (
    typeof payload.runtime?.provider !== "undefined" &&
    !toProvider(payload.runtime.provider)
  ) {
    return {
      code: "INVALID_RUNTIME_PROVIDER",
      message: "runtime.provider must be vercel, netlify, cloudflare, or unknown",
      details: {
        received: payload.runtime?.provider,
      },
    };
  }

  return null;
};

export const createBackupStatusHandler = (
  loadStatus: (options: {
    providerHint?: SchedulerProvider;
  }) => Promise<BackupStatusResult> = (options) => getBackupStatus(options),
) => {
  return async (req: VercelRequest, res: VercelResponse) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (req.method !== "POST") {
      sendError(res, 405, {
        code: "METHOD_NOT_ALLOWED",
        message: "Only POST and OPTIONS are supported",
        details: {
          received: req.method ?? null,
        },
      });
      return;
    }

    try {
      const parsedBody = parseBody(req.body);
      const validationError = validatePayload(parsedBody);
      if (validationError) {
        sendError(res, 400, validationError);
        return;
      }

      const providerHint = toProvider(parsedBody.runtime?.provider);
      const status = await loadStatus({ providerHint });

      res.status(200).json({
        ok: true,
        mpi: {
          message: BACKUPS_MPI_STATUS_RESPONSE_MESSAGE,
          version: BACKUPS_MPI_VERSION,
        },
        service: BACKUPS_SERVICE_NAME,
        status: BACKUPS_SERVICE_STATUS,
        scheduler: status.scheduler,
        slots: status.slots,
        checkedAt: status.checkedAt,
      });
      return;
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(res, 400, {
          code: "INVALID_JSON",
          message: "Request body is not valid JSON",
          details: {},
        });
        return;
      }

      if (error instanceof Error && error.message === "INVALID_BODY") {
        sendError(res, 400, {
          code: "INVALID_BODY",
          message: "Request body must be a JSON object",
          details: {},
        });
        return;
      }

      if (error instanceof MissingApiTokenError) {
        sendError(res, 500, {
          code: "MISSING_API_TOKEN",
          message:
            "Missing API token. Configure DATOCMS_FULLACCESS_API_TOKEN (or legacy DATOCMS_FULLACCESS_TOKEN).",
          details: {},
        });
        return;
      }

      sendError(res, 500, {
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected internal error occurred",
        details: {},
      });
      return;
    }
  };
};

export default createBackupStatusHandler();
