import {
  MissingApiTokenError,
  runWeeklyBackup,
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

export const createWeeklyBackupHandler = (
  runBackup: () => Promise<ScopedBackupResult> = () => runWeeklyBackup(),
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
