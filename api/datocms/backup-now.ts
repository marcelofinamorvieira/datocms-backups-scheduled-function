import type { VercelRequest, VercelResponse } from "../../types/vercel";
import {
  CadenceNotEnabledError,
  MissingApiTokenError,
  runManualBackupNow,
  type BackupCadence,
  type ManualBackupNowResult,
  type SchedulerProvider,
} from "../../services/backupService";
import {
  BACKUPS_BACKUP_NOW_EVENT_TYPE,
  BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE,
  BACKUPS_MPI_BACKUP_NOW_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
} from "../../utils/healthContract";
import {
  handleOptionsRequest,
  parseJsonObjectBody,
  sendError,
  setCorsHeaders,
  type ValidationError,
} from "../../utils/httpHandlers";
import { validateBackupsSharedSecret } from "../../utils/requestAuth";

type BackupNowRequestPayload = {
  event_type?: unknown;
  mpi?: {
    message?: unknown;
    version?: unknown;
  };
  plugin?: {
    name?: unknown;
    environment?: unknown;
  };
  slot?: {
    scope?: unknown;
  };
  runtime?: {
    provider?: unknown;
  };
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

const toCadence = (value: unknown): BackupCadence | undefined => {
  if (
    value === "daily" ||
    value === "weekly" ||
    value === "biweekly" ||
    value === "monthly"
  ) {
    return value;
  }

  return undefined;
};

const validatePayload = (
  payload: BackupNowRequestPayload,
): ValidationError | null => {
  if (payload.event_type !== BACKUPS_BACKUP_NOW_EVENT_TYPE) {
    return {
      code: "INVALID_EVENT_TYPE",
      message: `event_type must be ${BACKUPS_BACKUP_NOW_EVENT_TYPE}`,
      details: {
        expected: BACKUPS_BACKUP_NOW_EVENT_TYPE,
        received: payload.event_type,
      },
    };
  }

  if (payload.mpi?.message !== BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE) {
    return {
      code: "INVALID_MPI_MESSAGE",
      message: `mpi.message must be ${BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE}`,
      details: {
        expected: BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE,
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

  if (!toCadence(payload.slot?.scope)) {
    return {
      code: "INVALID_SLOT_SCOPE",
      message: "slot.scope must be daily, weekly, biweekly, or monthly",
      details: {
        received: payload.slot?.scope,
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

type ManualBackupNowLoader = (options: {
  scope: BackupCadence;
  providerHint?: SchedulerProvider;
  apiToken?: string;
}) => Promise<ManualBackupNowResult>;

export const createBackupNowHandler = (
  runBackupNow: ManualBackupNowLoader = (options) =>
    runManualBackupNow(options),
) => {
  return async (req: VercelRequest, res: VercelResponse) => {
    setCorsHeaders(res, "OPTIONS,POST");

    if (handleOptionsRequest(req, res, 204)) {
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
      const authResult = validateBackupsSharedSecret({
        headers: req.headers as Record<string, unknown> | undefined,
        sharedSecret:
          typeof req.internalBackupsSharedSecret === "string"
            ? req.internalBackupsSharedSecret
            : undefined,
      });
      if (!authResult.ok) {
        sendError(res, authResult.failure.statusCode, {
          code: authResult.failure.code,
          message: authResult.failure.message,
          details: {},
        });
        return;
      }

      const parsedBody = parseJsonObjectBody(req.body) as BackupNowRequestPayload;
      const validationError = validatePayload(parsedBody);
      if (validationError) {
        sendError(res, 400, validationError);
        return;
      }

      const scope = toCadence(parsedBody.slot?.scope) as BackupCadence;
      const providerHint = toProvider(parsedBody.runtime?.provider);
      const result = await runBackupNow({
        scope,
        providerHint,
        apiToken:
          typeof req.internalDatocmsApiToken === "string"
            ? req.internalDatocmsApiToken
            : undefined,
      });

      if (result.status === "failed") {
        sendError(res, 500, {
          code: "BACKUP_NOW_FAILED",
          message: result.error,
          details: {
            scope: result.scope,
          },
        });
        return;
      }

      res.status(200).json({
        ok: true,
        mpi: {
          message: BACKUPS_MPI_BACKUP_NOW_RESPONSE_MESSAGE,
          version: BACKUPS_MPI_VERSION,
        },
        service: BACKUPS_SERVICE_NAME,
        status: BACKUPS_SERVICE_STATUS,
        backup: {
          scope: result.scope,
          executionMode: result.executionMode,
          createdEnvironmentId: result.createdEnvironmentId,
          deletedEnvironmentId: result.deletedEnvironmentId,
          completedAt: result.completedAt,
        },
        checkedAt: result.checkedAt,
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

      if (error instanceof CadenceNotEnabledError) {
        sendError(res, 409, {
          code: "CADENCE_NOT_ENABLED",
          message: error.message,
          details: {
            scope: error.cadence,
          },
        });
        return;
      }

      if (error instanceof MissingApiTokenError) {
        sendError(res, 500, {
          code: "MISSING_API_TOKEN",
          message: "Missing API token. Configure DATOCMS_FULLACCESS_API_TOKEN.",
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

export default createBackupNowHandler();
