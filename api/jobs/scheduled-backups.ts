import {
  hasScheduledBackupFailures,
  runScheduledBackups,
  type ScheduledBackupsRunResult,
} from "../../services/backupService";
import { createAuthenticatedJobHandler, createErrorPayload } from "./sharedJobHandler";

export const createScheduledBackupsHandler = (
  runJob: () => Promise<ScheduledBackupsRunResult> = () => runScheduledBackups(),
) => {
  return createAuthenticatedJobHandler({
    runJob,
    allowedMethods: ["POST"],
    methodNotAllowedMessage: "Only POST and OPTIONS are supported.",
    handleSuccess: (res, result) => {
      if (hasScheduledBackupFailures(result)) {
        res.status(500).json({
          ...createErrorPayload(
            "SCHEDULED_BACKUPS_PARTIAL_FAILURE",
            "One or more scheduled backup cadences failed.",
          ),
          result,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        result,
      });
    },
  });
};

export default createScheduledBackupsHandler();
