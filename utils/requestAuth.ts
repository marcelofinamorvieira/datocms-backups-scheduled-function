import { getHeaderValue } from "./platformAdapters";

export const BACKUPS_AUTH_HEADER_NAME = "X-Datocms-Backups-Auth";
export const BACKUPS_SHARED_SECRET_ENV_VAR = "DATOCMS_BACKUPS_SHARED_SECRET";

type AuthHeaderMap = Record<string, unknown> | Headers | undefined;

type AuthFailure = {
  statusCode: 401 | 500;
  code: "UNAUTHORIZED" | "MISSING_SHARED_SECRET_CONFIG";
  message: string;
};

export type AuthValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      failure: AuthFailure;
    };

const toHeaderString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const firstString = value.find((entry) => typeof entry === "string");
    return typeof firstString === "string" ? firstString : undefined;
  }

  return undefined;
};

export const getAuthHeaderValue = (headers: AuthHeaderMap): string | undefined => {
  if (!headers) {
    return undefined;
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const value = headers.get(BACKUPS_AUTH_HEADER_NAME);
    return value ?? undefined;
  }

  const loweredHeaders = Object.entries(headers).reduce(
    (accumulator, [name, value]) => {
      accumulator[name] = toHeaderString(value);
      return accumulator;
    },
    {} as Record<string, string | undefined>,
  );

  return getHeaderValue(loweredHeaders, BACKUPS_AUTH_HEADER_NAME);
};

export const resolveBackupsSharedSecret = (sharedSecret?: string): string | undefined => {
  if (typeof sharedSecret === "string" && sharedSecret.trim()) {
    return sharedSecret.trim();
  }

  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }

  const fromEnv = process.env[BACKUPS_SHARED_SECRET_ENV_VAR];
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : undefined;
};

export const validateBackupsSharedSecret = ({
  headers,
  sharedSecret,
}: {
  headers: AuthHeaderMap;
  sharedSecret?: string;
}): AuthValidationResult => {
  const resolvedSecret = resolveBackupsSharedSecret(sharedSecret);
  if (!resolvedSecret) {
    return {
      ok: false,
      failure: {
        statusCode: 500,
        code: "MISSING_SHARED_SECRET_CONFIG",
        message:
          "Server is missing DATOCMS_BACKUPS_SHARED_SECRET configuration.",
      },
    };
  }

  const incomingSecret = getAuthHeaderValue(headers);
  if (incomingSecret !== resolvedSecret) {
    return {
      ok: false,
      failure: {
        statusCode: 401,
        code: "UNAUTHORIZED",
        message:
          "Missing or invalid X-Datocms-Backups-Auth header.",
      },
    };
  }

  return {
    ok: true,
  };
};
