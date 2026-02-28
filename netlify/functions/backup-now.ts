import backupNowHandler from "../../api/datocms/backup-now";
import {
  buildErrorEnvelope,
  buildJsonResponse,
  getHeaderValue,
  invokeVercelStyleHandler,
  parseRawBody,
} from "../../utils/platformAdapters";

type NetlifyFunctionEvent = {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body: string | null;
};

type NetlifyFunctionResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

export const handler = async (
  event: NetlifyFunctionEvent,
): Promise<NetlifyFunctionResponse> => {
  try {
    const contentType = getHeaderValue(event.headers, "content-type");
    const body = parseRawBody(event.body, contentType);

    return await invokeVercelStyleHandler(backupNowHandler, {
      method: event.httpMethod ?? "GET",
      body,
      headers: event.headers as Record<string, string> | undefined,
    });
  } catch {
    return buildJsonResponse(
      500,
      buildErrorEnvelope(
        "INTERNAL_SERVER_ERROR",
        "An unexpected internal error occurred",
      ),
    );
  }
};
