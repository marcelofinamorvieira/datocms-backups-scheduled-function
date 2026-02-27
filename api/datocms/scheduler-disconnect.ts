import type { VercelRequest, VercelResponse } from "../../types/vercel";
import {
  AutomaticBackupsPluginNotFoundError,
  disableAutomaticBackupsScheduler,
  MissingApiTokenError,
} from "../../services/backupService";
import {
  BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
  BACKUPS_MPI_SCHEDULER_DISCONNECT_RESPONSE_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
} from "../../utils/healthContract";

type ValidationError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

type SchedulerDisconnectRequestPayload = {
  event_type?: unknown;
  mpi?: {
    message?: unknown;
    version?: unknown;
  };
  plugin?: {
    name?: unknown;
    environment?: unknown;
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

const parseBody = (body: unknown): SchedulerDisconnectRequestPayload => {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid-body");
      }

      return parsed as SchedulerDisconnectRequestPayload;
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

  return body as SchedulerDisconnectRequestPayload;
};

const validatePayload = (
  payload: SchedulerDisconnectRequestPayload,
): ValidationError | null => {
  if (payload.event_type !== BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE) {
    return {
      code: "INVALID_EVENT_TYPE",
      message: `event_type must be ${BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE}`,
      details: {
        expected: BACKUPS_SCHEDULER_DISCONNECT_EVENT_TYPE,
        received: payload.event_type,
      },
    };
  }

  if (payload.mpi?.message !== BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE) {
    return {
      code: "INVALID_MPI_MESSAGE",
      message: `mpi.message must be ${BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE}`,
      details: {
        expected: BACKUPS_MPI_SCHEDULER_DISCONNECT_REQUEST_MESSAGE,
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

  return null;
};

export const createSchedulerDisconnectHandler = (
  disconnectScheduler: () => Promise<{
    enabled: false;
    disabledAt: string;
    pluginId: string;
  }> = () => disableAutomaticBackupsScheduler(),
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

      const result = await disconnectScheduler();
      res.status(200).json({
        ok: true,
        mpi: {
          message: BACKUPS_MPI_SCHEDULER_DISCONNECT_RESPONSE_MESSAGE,
          version: BACKUPS_MPI_VERSION,
        },
        service: BACKUPS_SERVICE_NAME,
        status: BACKUPS_SERVICE_STATUS,
        scheduler: {
          enabled: result.enabled,
          disconnectedAt: result.disabledAt,
        },
        plugin: {
          id: result.pluginId,
        },
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

      if (error instanceof AutomaticBackupsPluginNotFoundError) {
        sendError(res, 404, {
          code: "PLUGIN_NOT_FOUND",
          message: error.message,
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

export default createSchedulerDisconnectHandler();
