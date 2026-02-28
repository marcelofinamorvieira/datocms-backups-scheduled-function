import type { VercelRequest, VercelResponse } from "../types/vercel";

export type ValidationError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export const setCorsHeaders = (
  res: VercelResponse,
  methods = "GET,OPTIONS,POST",
) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Datocms-Backups-Auth",
  );
};

export const sendError = (
  res: VercelResponse,
  statusCode: number,
  error: ValidationError,
) => {
  res.status(statusCode).json({
    ok: false,
    error,
  });
};

export const handleOptionsRequest = (
  req: VercelRequest,
  res: VercelResponse,
  statusCode = 204,
): boolean => {
  if (req.method !== "OPTIONS") {
    return false;
  }

  res.status(statusCode).end();
  return true;
};

export const parseJsonObjectBody = (body: unknown): Record<string, unknown> => {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid-body");
      }

      return parsed as Record<string, unknown>;
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

  return body as Record<string, unknown>;
};
