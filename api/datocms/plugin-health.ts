import type { VercelRequest, VercelResponse } from "../../types/vercel";
import {
  BACKUPS_ACCEPTED_PHASES,
  BACKUPS_MPI_PING_MESSAGE,
  BACKUPS_MPI_PONG_MESSAGE,
  BACKUPS_MPI_VERSION,
  BACKUPS_PLUGIN_NAME,
  BACKUPS_SERVICE_NAME,
  BACKUPS_SERVICE_STATUS,
  PLUGIN_HEALTH_EVENT_TYPE,
} from "../../utils/healthContract";

const VALID_MPI_PHASES_MESSAGE =
  "mpi.phase must be finish_installation, config_mount, or config_connect";

type ValidationError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

const setCorsHeaders = (res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
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

type PluginHealthRequest = {
  event_type?: unknown;
  mpi?: {
    message?: unknown;
    version?: unknown;
    phase?: unknown;
  };
  plugin?: {
    name?: unknown;
    environment?: unknown;
  };
};

const parseBody = (body: unknown): PluginHealthRequest => {
  if (typeof body === "string") {
    try {
      const parsedBody = JSON.parse(body) as unknown;
      if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        throw new Error("invalid-body");
      }
      return parsedBody as PluginHealthRequest;
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

  return body as PluginHealthRequest;
};

const validatePayload = (payload: PluginHealthRequest): ValidationError | null => {
  if (payload.event_type !== PLUGIN_HEALTH_EVENT_TYPE) {
    return {
      code: "INVALID_EVENT_TYPE",
      message: `event_type must be ${PLUGIN_HEALTH_EVENT_TYPE}`,
      details: {
        expected: PLUGIN_HEALTH_EVENT_TYPE,
        received: payload.event_type,
      },
    };
  }

  if (payload.mpi?.message !== BACKUPS_MPI_PING_MESSAGE) {
    return {
      code: "INVALID_MPI_MESSAGE",
      message: `mpi.message must be ${BACKUPS_MPI_PING_MESSAGE}`,
      details: {
        expected: BACKUPS_MPI_PING_MESSAGE,
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

  if (!BACKUPS_ACCEPTED_PHASES.includes(payload.mpi?.phase as any)) {
    return {
      code: "INVALID_MPI_PHASE",
      message: VALID_MPI_PHASES_MESSAGE,
      details: {
        expected: BACKUPS_ACCEPTED_PHASES,
        received: payload.mpi?.phase,
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

export default async function pluginHealthHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
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

    res.status(200).json({
      ok: true,
      mpi: {
        message: BACKUPS_MPI_PONG_MESSAGE,
        version: BACKUPS_MPI_VERSION,
      },
      service: BACKUPS_SERVICE_NAME,
      status: BACKUPS_SERVICE_STATUS,
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

    sendError(res, 500, {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected internal error occurred",
      details: {},
    });
    return;
  }
}
