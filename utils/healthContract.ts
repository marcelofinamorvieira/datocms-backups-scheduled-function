export const PLUGIN_HEALTH_EVENT_TYPE = "plugin_health_ping";
export const BACKUPS_STATUS_EVENT_TYPE = "backup_status_request";
export const BACKUPS_BACKUP_NOW_EVENT_TYPE = "backup_now_request";
export const BACKUPS_MPI_PING_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_PING";
export const BACKUPS_MPI_PONG_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_PONG";
export const BACKUPS_MPI_STATUS_REQUEST_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_STATUS";
export const BACKUPS_MPI_STATUS_RESPONSE_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS";
export const BACKUPS_MPI_BACKUP_NOW_REQUEST_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_BACKUP_NOW";
export const BACKUPS_MPI_BACKUP_NOW_RESPONSE_MESSAGE =
  "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_BACKUP_NOW";
export const BACKUPS_MPI_VERSION = "2026-02-26";
export const BACKUPS_PLUGIN_NAME = "datocms-plugin-automatic-environment-backups";
export const BACKUPS_SERVICE_NAME = "datocms-backups-scheduled-function";
export const BACKUPS_SERVICE_STATUS = "ready";

export const BACKUPS_ACCEPTED_PHASES = [
  "finish_installation",
  "config_mount",
  "config_connect",
] as const;

export type BackupsMpiPhase = (typeof BACKUPS_ACCEPTED_PHASES)[number];
