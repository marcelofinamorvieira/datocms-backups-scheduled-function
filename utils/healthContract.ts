export const PLUGIN_HEALTH_EVENT_TYPE = "plugin_health_ping";
export const BACKUPS_MPI_PING_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_PING";
export const BACKUPS_MPI_PONG_MESSAGE = "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_PONG";
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
