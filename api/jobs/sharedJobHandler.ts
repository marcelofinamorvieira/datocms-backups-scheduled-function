import { MissingApiTokenError } from "../../services/backupService";
import type { VercelRequest, VercelResponse } from "../../types/vercel";
import { handleOptionsRequest, setCorsHeaders } from "../../utils/httpHandlers";
import { validateBackupsSharedSecret } from "../../utils/requestAuth";

const DEFAULT_ALLOWED_METHODS = ["POST"] as const;
const DEFAULT_OPTIONS_STATUS_CODE = 200;
const DEFAULT_METHOD_NOT_ALLOWED_MESSAGE = "Only POST and OPTIONS are supported.";
const DEFAULT_INTERNAL_ERROR_MESSAGE = "An unexpected internal error occurred.";
const MISSING_API_TOKEN_MESSAGE =
  "Missing API token. Configure DATOCMS_FULLACCESS_API_TOKEN.";

export const createErrorPayload = (code: string, message: string) => ({
  ok: false,
  error: {
    code,
    message,
    details: {},
  },
});

type CreateAuthenticatedJobHandlerOptions<Result> = {
  runJob: () => Promise<Result>;
  handleSuccess: (res: VercelResponse, result: Result) => void;
  handleKnownError?: (res: VercelResponse, error: unknown) => boolean;
  allowedMethods?: readonly string[];
  optionsStatusCode?: number;
  methodNotAllowedMessage?: string;
};

export const createAuthenticatedJobHandler = <Result>({
  runJob,
  handleSuccess,
  handleKnownError,
  allowedMethods = DEFAULT_ALLOWED_METHODS,
  optionsStatusCode = DEFAULT_OPTIONS_STATUS_CODE,
  methodNotAllowedMessage = DEFAULT_METHOD_NOT_ALLOWED_MESSAGE,
}: CreateAuthenticatedJobHandlerOptions<Result>) => {
  return async (req: VercelRequest, res: VercelResponse) => {
    const methodsHeader = [...allowedMethods, "OPTIONS"].join(",");
    setCorsHeaders(res, methodsHeader);

    if (handleOptionsRequest(req, res, optionsStatusCode)) {
      return;
    }

    if (!allowedMethods.includes(String(req.method))) {
      res
        .status(405)
        .json(createErrorPayload("METHOD_NOT_ALLOWED", methodNotAllowedMessage));
      return;
    }

    try {
      const authResult = validateBackupsSharedSecret({
        headers: req.headers as Record<string, unknown> | undefined,
      });
      if (!authResult.ok) {
        res
          .status(authResult.failure.statusCode)
          .json(createErrorPayload(authResult.failure.code, authResult.failure.message));
        return;
      }

      const result = await runJob();
      handleSuccess(res, result);
      return;
    } catch (error) {
      if (handleKnownError?.(res, error)) {
        return;
      }

      if (error instanceof MissingApiTokenError) {
        res
          .status(500)
          .json(createErrorPayload("MISSING_API_TOKEN", MISSING_API_TOKEN_MESSAGE));
        return;
      }

      res.status(500).json(
        createErrorPayload(
          "INTERNAL_SERVER_ERROR",
          error instanceof Error ? error.message : DEFAULT_INTERNAL_ERROR_MESSAGE,
        ),
      );
      return;
    }
  };
};
