import { buildClient } from "@datocms/cma-client-node";

export const API_TOKEN_ENV_VAR = "DATOCMS_FULLACCESS_API_TOKEN";
export const LEGACY_API_TOKEN_ENV_VAR = "DATOCMS_FULLACCESS_TOKEN";

export class MissingApiTokenError extends Error {
  constructor() {
    super(
      `Missing API token. Set ${API_TOKEN_ENV_VAR} (preferred) or ${LEGACY_API_TOKEN_ENV_VAR}.`,
    );
    this.name = "MissingApiTokenError";
  }
}

export type BackupScope = "daily" | "weekly";

export type ScopedBackupResult = {
  scope: BackupScope;
  createdEnvironmentId: string;
  deletedEnvironmentId: string | null;
};

export type InitializationResult = {
  daily: ScopedBackupResult;
  weekly: ScopedBackupResult;
};

type BackupExecutionOptions = {
  apiToken?: string;
};

export type ScheduledCadence = "hourly" | "daily";

type ScheduledBackupExecutionOptions = BackupExecutionOptions & {
  now?: Date;
  cadence?: ScheduledCadence;
};

export type DistributedScheduleWindow = {
  slotHourUtc: number;
  slotWeekdayUtc: number | null;
  currentHourUtc: number;
  currentWeekdayUtc: number;
};

export type ScheduledScopedBackupResult =
  | {
      scope: BackupScope;
      status: "executed";
      schedule: DistributedScheduleWindow;
      result: ScopedBackupResult;
    }
  | {
      scope: BackupScope;
      status: "skipped";
      schedule: DistributedScheduleWindow;
    };

const getProcessEnv = (): NodeJS.ProcessEnv | undefined => {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env;
};

const getDateSuffix = () => new Date().toISOString().split("T")[0];

const getEnvironmentPrefix = (scope: BackupScope) =>
  scope === "daily" ? "backup-plugin-daily" : "backup-plugin-weekly";

const DISTRIBUTION_HASH_SALT = "datocms-backup-distribution-v1";
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const HOURS_PER_WEEK = HOURS_PER_DAY * DAYS_PER_WEEK;
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;

export const resolveApiToken = (apiToken?: string): string => {
  const processEnv = getProcessEnv();
  const token =
    apiToken ||
    processEnv?.[API_TOKEN_ENV_VAR] ||
    processEnv?.[LEGACY_API_TOKEN_ENV_VAR];

  if (!token) {
    throw new MissingApiTokenError();
  }

  return token;
};

export const assignApiTokenToProcessEnv = (apiToken: string) => {
  const processEnv = getProcessEnv();
  if (!processEnv) {
    return;
  }

  processEnv[API_TOKEN_ENV_VAR] = apiToken;
  if (!processEnv[LEGACY_API_TOKEN_ENV_VAR]) {
    processEnv[LEGACY_API_TOKEN_ENV_VAR] = apiToken;
  }
};

const hashString = (input: string): number => {
  let hash = FNV1A_OFFSET_BASIS;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME);
  }

  return hash >>> 0;
};

const buildDistributionSeed = (scope: BackupScope, apiToken: string) =>
  `${DISTRIBUTION_HASH_SALT}:${scope}:${apiToken}`;

export const getDistributedScheduleWindow = (
  scope: BackupScope,
  apiToken: string,
  now: Date = new Date(),
): DistributedScheduleWindow => {
  const currentHourUtc = now.getUTCHours();
  const currentWeekdayUtc = now.getUTCDay();
  const hash = hashString(buildDistributionSeed(scope, apiToken));

  if (scope === "daily") {
    return {
      slotHourUtc: hash % HOURS_PER_DAY,
      slotWeekdayUtc: null,
      currentHourUtc,
      currentWeekdayUtc,
    };
  }

  const weeklySlot = hash % HOURS_PER_WEEK;
  return {
    slotHourUtc: weeklySlot % HOURS_PER_DAY,
    slotWeekdayUtc: Math.floor(weeklySlot / HOURS_PER_DAY),
    currentHourUtc,
    currentWeekdayUtc,
  };
};

export const isDistributedScheduleDue = (
  scope: BackupScope,
  schedule: DistributedScheduleWindow,
  cadence: ScheduledCadence = "hourly",
): boolean => {
  if (cadence === "daily") {
    if (scope === "daily") {
      return true;
    }

    return schedule.currentWeekdayUtc === schedule.slotWeekdayUtc;
  }

  if (scope === "daily") {
    return schedule.currentHourUtc === schedule.slotHourUtc;
  }

  return (
    schedule.currentHourUtc === schedule.slotHourUtc &&
    schedule.currentWeekdayUtc === schedule.slotWeekdayUtc
  );
};

const executeScopedBackup = async (
  scope: BackupScope,
  options: BackupExecutionOptions = {},
): Promise<ScopedBackupResult> => {
  const apiToken = resolveApiToken(options.apiToken);
  assignApiTokenToProcessEnv(apiToken);

  const client = buildClient({ apiToken });
  const environments = await client.environments.list();

  const mainEnvironment = environments.find((environment) => environment.meta.primary);
  if (!mainEnvironment) {
    throw new Error("Could not locate the primary DatoCMS environment.");
  }

  const prefix = getEnvironmentPrefix(scope);
  const previousUnusedBackup = environments.find(
    (environment) =>
      environment.id.includes(prefix) && !environment.meta.primary,
  );

  if (previousUnusedBackup) {
    await client.environments.destroy(previousUnusedBackup.id);
  }

  const createdEnvironmentId = `${prefix}-${getDateSuffix()}`;

  await client.environments.fork(mainEnvironment.id, {
    id: createdEnvironmentId,
  });

  return {
    scope,
    createdEnvironmentId,
    deletedEnvironmentId: previousUnusedBackup?.id || null,
  };
};

const runScheduledScopedBackup = async (
  scope: BackupScope,
  options: ScheduledBackupExecutionOptions = {},
): Promise<ScheduledScopedBackupResult> => {
  const apiToken = resolveApiToken(options.apiToken);
  assignApiTokenToProcessEnv(apiToken);

  const schedule = getDistributedScheduleWindow(scope, apiToken, options.now);
  if (!isDistributedScheduleDue(scope, schedule, options.cadence)) {
    return {
      scope,
      status: "skipped",
      schedule,
    };
  }

  const result = await executeScopedBackup(scope, { apiToken });
  return {
    scope,
    status: "executed",
    schedule,
    result,
  };
};

export const runDailyBackup = async (
  options: BackupExecutionOptions = {},
): Promise<ScopedBackupResult> => {
  return executeScopedBackup("daily", options);
};

export const runWeeklyBackup = async (
  options: BackupExecutionOptions = {},
): Promise<ScopedBackupResult> => {
  return executeScopedBackup("weekly", options);
};

export const runScheduledDailyBackup = async (
  options: ScheduledBackupExecutionOptions = {},
): Promise<ScheduledScopedBackupResult> => {
  return runScheduledScopedBackup("daily", options);
};

export const runScheduledWeeklyBackup = async (
  options: ScheduledBackupExecutionOptions = {},
): Promise<ScheduledScopedBackupResult> => {
  return runScheduledScopedBackup("weekly", options);
};

export const runInitialization = async (
  options: BackupExecutionOptions = {},
): Promise<InitializationResult> => {
  const daily = await runDailyBackup(options);
  const weekly = await runWeeklyBackup(options);

  return {
    daily,
    weekly,
  };
};
