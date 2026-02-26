import { Handler } from "@netlify/functions";
import {
  runInitialization,
  type InitializationResult,
} from "../../../services/backupService";

type NetlifyResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

const createSuccessResponse = (result: InitializationResult): NetlifyResponse => ({
  statusCode: 200,
  body: JSON.stringify({
    message: "Initialization completed successfully!",
    result,
  }),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
  },
});

const createErrorResponse = (error: unknown): NetlifyResponse => ({
  statusCode: 500,
  body: JSON.stringify({
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      details: {},
    },
  }),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json; charset=utf-8",
  },
});

export const runInitializationJob = async (
  runJob: () => Promise<InitializationResult> = () => runInitialization(),
): Promise<NetlifyResponse> => {
  try {
    const result = await runJob();
    return createSuccessResponse(result);
  } catch (error) {
    return createErrorResponse(error);
  }
};

export const handler: Handler = async () => {
  return runInitializationJob();
};
