import { buildClient } from "@datocms/cma-client-node";
import { BACKUPS_PLUGIN_NAME } from "../utils/healthContract";

export const API_TOKEN_ENV_VAR = "DATOCMS_FULLACCESS_API_TOKEN";

export class MissingApiTokenError extends Error {
  constructor() {
    super(`Missing API token. Set ${API_TOKEN_ENV_VAR}.`);
    this.name = "MissingApiTokenError";
  }
}

export type BackupCadence = "daily" | "weekly" | "biweekly" | "monthly";

export type ScopedBackupResult = {
  scope: BackupCadence;
  createdEnvironmentId: string;
  deletedEnvironmentId: string | null;
};

type BackupExecutionOptions = {
  apiToken?: string;
  now?: Date;
};

export type SchedulerProvider = "vercel" | "netlify" | "cloudflare" | "unknown";

export type ScheduledSkipReason = "NOT_DUE";

export type BackupStatusSlot = {
  scope: BackupCadence;
  executionMode: "lambda_cron";
  lastBackupAt: string | null;
  nextBackupAt: string | null;
};

export type BackupStatusResult = {
  scheduler: {
    provider: SchedulerProvider;
    cadence: "daily";
  };
  slots: {
    daily: BackupStatusSlot;
    weekly: BackupStatusSlot;
    biweekly: BackupStatusSlot;
    monthly: BackupStatusSlot;
  };
  checkedAt: string;
};

export type ScheduledCadenceExecutionResult =
  | {
      scope: BackupCadence;
      status: "executed";
      result: ScopedBackupResult;
    }
  | {
      scope: BackupCadence;
      status: "failed";
      error: string;
    };

export type ScheduledBackupsRunResult = {
  scheduler: {
    provider: SchedulerProvider;
    cadence: "daily";
  };
  schedule: {
    timezone: string;
    enabledCadences: BackupCadence[];
    anchorLocalDate: string;
  };
  checkedAt: string;
  skipped: boolean;
  reason?: ScheduledSkipReason;
  results: ScheduledCadenceExecutionResult[];
};

export type ManualBackupNowResult =
  | {
      scope: BackupCadence;
      status: "executed";
      executionMode: "lambda_cron";
      createdEnvironmentId: string;
      deletedEnvironmentId: string | null;
      completedAt: string;
      checkedAt: string;
    }
  | {
      scope: BackupCadence;
      status: "failed";
      error: string;
      checkedAt: string;
    };

export class CadenceNotEnabledError extends Error {
  readonly cadence: BackupCadence;

  constructor(cadence: BackupCadence) {
    super(
      `Backup cadence "${cadence}" is not enabled in the current plugin schedule.`,
    );
    this.name = "CadenceNotEnabledError";
    this.cadence = cadence;
  }
}

const BACKUP_CADENCES: BackupCadence[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
];
const DEFAULT_ENABLED_CADENCES: BackupCadence[] = ["daily", "weekly"];
const DEFAULT_TIMEZONE = "UTC";
const BACKUP_SCHEDULE_VERSION = 1 as const;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type AutomaticBackupsPlugin = {
  id: string;
  name: string;
  package_name: string | null;
  parameters: Record<string, unknown>;
};

type BackupScheduleConfig = {
  version: 1;
  enabledCadences: BackupCadence[];
  timezone: string;
  anchorLocalDate: string;
  updatedAt: string;
};

type AutomaticBackupsScheduleState = {
  lastRunLocalDateByCadence?: Partial<Record<BackupCadence, string>>;
  lastRunAtByCadence?: Partial<Record<BackupCadence, string>>;
  lastManagedEnvironmentIdByCadence?: Partial<Record<BackupCadence, string>>;
  lastExecutionModeByCadence?: Partial<Record<BackupCadence, "lambda_cron">>;
  lastErrorByCadence?: Partial<Record<BackupCadence, string>>;
  dailyLastRunDate?: string;
  weeklyLastRunKey?: string;
  lastDailyRunAt?: string;
  lastWeeklyRunAt?: string;
  lastDailyManagedEnvironmentId?: string;
  lastWeeklyManagedEnvironmentId?: string;
  lastDailyExecutionMode?: "lambda_cron";
  lastWeeklyExecutionMode?: "lambda_cron";
  lastDailyError?: string;
  lastWeeklyError?: string;
};

type BackupContext = {
  apiToken: string;
  client: ReturnType<typeof buildClient>;
  pluginId: string | null;
  pluginParameters: Record<string, unknown>;
  scheduleConfig: BackupScheduleConfig;
  scheduleState: AutomaticBackupsScheduleState;
};

const getProcessEnv = (): NodeJS.ProcessEnv | undefined => {
  if (typeof process === "undefined") {
    return undefined;
  }

  return process.env;
};

export const resolveApiToken = (apiToken?: string): string => {
  const processEnv = getProcessEnv();
  const token = apiToken || processEnv?.[API_TOKEN_ENV_VAR];

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
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const isBackupCadence = (value: unknown): value is BackupCadence => {
  return BACKUP_CADENCES.includes(value as BackupCadence);
};

const isAutomaticBackupsPluginName = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized === BACKUPS_PLUGIN_NAME.toLowerCase() ||
    normalized === "automatic environment backups"
  );
};

const findAutomaticBackupsPlugin = async (
  apiToken: string,
): Promise<AutomaticBackupsPlugin | null> => {
  const client = buildClient({ apiToken });
  const plugins = (await client.plugins.list()) as AutomaticBackupsPlugin[];
  const byPackageName = plugins.find(
    (plugin) => plugin.package_name === BACKUPS_PLUGIN_NAME,
  );

  if (byPackageName) {
    return byPackageName;
  }

  const byPluginName = plugins.find((plugin) =>
    isAutomaticBackupsPluginName(plugin.name),
  );
  return byPluginName ?? null;
};

const isValidTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
      year: "numeric",
    }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const ensureTimezone = (value: unknown, fallback: string): string => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate && isValidTimezone(candidate)) {
    return candidate;
  }

  if (isValidTimezone(fallback)) {
    return fallback;
  }

  return DEFAULT_TIMEZONE;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const parseLocalDateKey = (value: string): LocalDateParts | null => {
  if (!DATE_KEY_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }

  const maxDay = getDaysInMonth(year, month);
  if (month < 1 || month > 12 || day < 1 || day > maxDay) {
    return null;
  }

  return { year, month, day };
};

const toLocalDateKeyFromParts = (parts: LocalDateParts): string =>
  `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;

const buildUtcDateFromLocalParts = (parts: LocalDateParts): Date => {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

const toLocalDateParts = (date: Date, timezone: string): LocalDateParts => {
  const safeTimezone = ensureTimezone(timezone, DEFAULT_TIMEZONE);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }

  return { year, month, day };
};

const toLocalDateKey = (date: Date, timezone: string): string => {
  return toLocalDateKeyFromParts(toLocalDateParts(date, timezone));
};

const compareDateKeys = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const getDayDiff = (startDateKey: string, endDateKey: string): number => {
  const startParts = parseLocalDateKey(startDateKey);
  const endParts = parseLocalDateKey(endDateKey);

  if (!startParts || !endParts) {
    return 0;
  }

  const diffMs =
    buildUtcDateFromLocalParts(endParts).getTime() -
    buildUtcDateFromLocalParts(startParts).getTime();
  return Math.floor(diffMs / 86400000);
};

const addDaysToDateKey = (dateKey: string, dayDelta: number): string => {
  const parts = parseLocalDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }

  const base = buildUtcDateFromLocalParts(parts);
  base.setUTCDate(base.getUTCDate() + dayDelta);
  return toLocalDateKeyFromParts({
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  });
};

const addMonthsToDateKey = (dateKey: string, monthDelta: number): string => {
  const parts = parseLocalDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }

  const rawMonthIndex = parts.month - 1 + monthDelta;
  const year = parts.year + Math.floor(rawMonthIndex / 12);
  const monthIndex = ((rawMonthIndex % 12) + 12) % 12;
  const month = monthIndex + 1;
  const day = Math.min(parts.day, getDaysInMonth(year, month));
  return toLocalDateKeyFromParts({ year, month, day });
};

const normalizeCadences = (value: unknown): BackupCadence[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_CADENCES];
  }

  const selected = new Set<BackupCadence>();
  for (const entry of value) {
    if (isBackupCadence(entry)) {
      selected.add(entry);
    }
  }

  if (selected.size === 0) {
    return [...DEFAULT_ENABLED_CADENCES];
  }

  return BACKUP_CADENCES.filter((cadence) => selected.has(cadence));
};

const normalizeBackupScheduleConfig = ({
  value,
  timezoneFallback,
  now,
}: {
  value: unknown;
  timezoneFallback: string;
  now: Date;
}): { config: BackupScheduleConfig; requiresMigration: boolean } => {
  const fallbackTimezone = ensureTimezone(timezoneFallback, DEFAULT_TIMEZONE);
  const fallbackAnchor = toLocalDateKey(now, fallbackTimezone);
  const fallbackUpdatedAt = now.toISOString();

  if (!isObject(value)) {
    return {
      config: {
        version: BACKUP_SCHEDULE_VERSION,
        enabledCadences: [...DEFAULT_ENABLED_CADENCES],
        timezone: fallbackTimezone,
        anchorLocalDate: fallbackAnchor,
        updatedAt: fallbackUpdatedAt,
      },
      requiresMigration: true,
    };
  }

  const timezone = ensureTimezone(value.timezone, fallbackTimezone);
  const anchorLocalDate =
    typeof value.anchorLocalDate === "string" &&
    parseLocalDateKey(value.anchorLocalDate.trim())
      ? value.anchorLocalDate.trim()
      : toLocalDateKey(now, timezone);

  const config: BackupScheduleConfig = {
    version: BACKUP_SCHEDULE_VERSION,
    enabledCadences: normalizeCadences(value.enabledCadences),
    timezone,
    anchorLocalDate,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : fallbackUpdatedAt,
  };

  const rawTimezone = typeof value.timezone === "string" ? value.timezone.trim() : "";
  const rawAnchor =
    typeof value.anchorLocalDate === "string" ? value.anchorLocalDate.trim() : "";
  const rawUpdatedAt = typeof value.updatedAt === "string" ? value.updatedAt.trim() : "";
  const requiresMigration =
    value.version !== BACKUP_SCHEDULE_VERSION ||
    !Array.isArray(value.enabledCadences) ||
    normalizeCadences(value.enabledCadences).length === 0 ||
    !rawTimezone ||
    !parseLocalDateKey(rawAnchor) ||
    !rawUpdatedAt;

  return {
    config,
    requiresMigration,
  };
};

export const normalizeBackupSchedule = normalizeBackupScheduleConfig;

const toCadenceMap = (
  value: unknown,
): Partial<Record<BackupCadence, string>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const mapped: Partial<Record<BackupCadence, string>> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!isBackupCadence(key)) {
      continue;
    }

    const stringValue = toOptionalString(rawValue);
    if (stringValue) {
      mapped[key] = stringValue;
    }
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

const toExecutionModeCadenceMap = (
  value: unknown,
): Partial<Record<BackupCadence, "lambda_cron">> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const mapped: Partial<Record<BackupCadence, "lambda_cron">> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!isBackupCadence(key)) {
      continue;
    }

    if (rawValue === "lambda_cron") {
      mapped[key] = rawValue;
    }
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

const toScheduleState = (value: unknown): AutomaticBackupsScheduleState => {
  if (!isObject(value)) {
    return {};
  }

  return {
    ...value,
    lastRunLocalDateByCadence: toCadenceMap(value.lastRunLocalDateByCadence),
    lastRunAtByCadence: toCadenceMap(value.lastRunAtByCadence),
    lastManagedEnvironmentIdByCadence: toCadenceMap(
      value.lastManagedEnvironmentIdByCadence,
    ),
    lastExecutionModeByCadence: toExecutionModeCadenceMap(
      value.lastExecutionModeByCadence,
    ),
    lastErrorByCadence: toCadenceMap(value.lastErrorByCadence),
    dailyLastRunDate: toOptionalString(value.dailyLastRunDate),
    weeklyLastRunKey: toOptionalString(value.weeklyLastRunKey),
    lastDailyRunAt: toOptionalString(value.lastDailyRunAt),
    lastWeeklyRunAt: toOptionalString(value.lastWeeklyRunAt),
    lastDailyManagedEnvironmentId: toOptionalString(value.lastDailyManagedEnvironmentId),
    lastWeeklyManagedEnvironmentId: toOptionalString(value.lastWeeklyManagedEnvironmentId),
    lastDailyExecutionMode:
      value.lastDailyExecutionMode === "lambda_cron"
        ? value.lastDailyExecutionMode
        : undefined,
    lastWeeklyExecutionMode:
      value.lastWeeklyExecutionMode === "lambda_cron"
        ? value.lastWeeklyExecutionMode
        : undefined,
    lastDailyError: toOptionalString(value.lastDailyError),
    lastWeeklyError: toOptionalString(value.lastWeeklyError),
  };
};

const toUtcIsoWeekKey = (date: Date): string => {
  const workingDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((workingDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${workingDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const getLastRunLocalDateForCadence = ({
  scheduleState,
  cadence,
  now,
  timezone,
}: {
  scheduleState: AutomaticBackupsScheduleState;
  cadence: BackupCadence;
  now: Date;
  timezone: string;
}): string | undefined => {
  const fromCadenceMap = scheduleState.lastRunLocalDateByCadence?.[cadence];
  if (fromCadenceMap && parseLocalDateKey(fromCadenceMap)) {
    return fromCadenceMap;
  }

  if (cadence === "daily") {
    if (scheduleState.dailyLastRunDate && parseLocalDateKey(scheduleState.dailyLastRunDate)) {
      return scheduleState.dailyLastRunDate;
    }
  }

  if (cadence === "weekly" && scheduleState.weeklyLastRunKey) {
    const currentWeek = toUtcIsoWeekKey(now);
    if (scheduleState.weeklyLastRunKey === currentWeek) {
      return toLocalDateKey(now, timezone);
    }
  }

  return undefined;
};

const isCadenceScheduledOnDate = ({
  cadence,
  anchorLocalDate,
  localDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  localDate: string;
}): boolean => {
  if (!parseLocalDateKey(anchorLocalDate) || !parseLocalDateKey(localDate)) {
    return cadence === "daily";
  }

  if (compareDateKeys(localDate, anchorLocalDate) < 0) {
    return false;
  }

  if (cadence === "daily") {
    return true;
  }

  if (cadence === "weekly" || cadence === "biweekly") {
    const interval = cadence === "weekly" ? 7 : 14;
    const diffDays = getDayDiff(anchorLocalDate, localDate);
    return diffDays >= 0 && diffDays % interval === 0;
  }

  const anchorParts = parseLocalDateKey(anchorLocalDate);
  const currentParts = parseLocalDateKey(localDate);
  if (!anchorParts || !currentParts) {
    return false;
  }

  const dueDay = Math.min(
    anchorParts.day,
    getDaysInMonth(currentParts.year, currentParts.month),
  );
  return currentParts.day === dueDay;
};

const isCadenceDueNow = ({
  cadence,
  anchorLocalDate,
  currentLocalDate,
  lastRunLocalDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  currentLocalDate: string;
  lastRunLocalDate?: string;
}): boolean => {
  if (
    typeof lastRunLocalDate === "string" &&
    compareDateKeys(lastRunLocalDate, currentLocalDate) === 0
  ) {
    return false;
  }

  return isCadenceScheduledOnDate({
    cadence,
    anchorLocalDate,
    localDate: currentLocalDate,
  });
};

export const isCadenceDue = isCadenceDueNow;

const getNextDueLocalDate = ({
  cadence,
  anchorLocalDate,
  currentLocalDate,
  lastRunLocalDate,
}: {
  cadence: BackupCadence;
  anchorLocalDate: string;
  currentLocalDate: string;
  lastRunLocalDate?: string;
}): string => {
  const alreadyRanToday =
    typeof lastRunLocalDate === "string" &&
    compareDateKeys(lastRunLocalDate, currentLocalDate) === 0;

  if (
    !alreadyRanToday &&
    isCadenceScheduledOnDate({ cadence, anchorLocalDate, localDate: currentLocalDate })
  ) {
    return currentLocalDate;
  }

  if (cadence === "daily") {
    return addDaysToDateKey(currentLocalDate, 1);
  }

  if (cadence === "weekly" || cadence === "biweekly") {
    const interval = cadence === "weekly" ? 7 : 14;
    const diffDays = getDayDiff(anchorLocalDate, currentLocalDate);

    if (diffDays < 0) {
      return anchorLocalDate;
    }

    const remainder = diffDays % interval;
    const offset = remainder === 0 ? interval : interval - remainder;
    return addDaysToDateKey(currentLocalDate, offset);
  }

  const currentParts = parseLocalDateKey(currentLocalDate);
  const anchorParts = parseLocalDateKey(anchorLocalDate);
  if (!currentParts || !anchorParts) {
    return currentLocalDate;
  }

  const dueThisMonth = toLocalDateKeyFromParts({
    year: currentParts.year,
    month: currentParts.month,
    day: Math.min(anchorParts.day, getDaysInMonth(currentParts.year, currentParts.month)),
  });

  if (
    compareDateKeys(dueThisMonth, currentLocalDate) > 0 ||
    (compareDateKeys(dueThisMonth, currentLocalDate) === 0 && !alreadyRanToday)
  ) {
    return dueThisMonth;
  }

  const firstOfCurrentMonth = toLocalDateKeyFromParts({
    year: currentParts.year,
    month: currentParts.month,
    day: 1,
  });
  const firstOfNextMonth = addMonthsToDateKey(firstOfCurrentMonth, 1);
  const nextMonthParts = parseLocalDateKey(firstOfNextMonth);
  if (!nextMonthParts) {
    return firstOfNextMonth;
  }

  return toLocalDateKeyFromParts({
    year: nextMonthParts.year,
    month: nextMonthParts.month,
    day: Math.min(anchorParts.day, getDaysInMonth(nextMonthParts.year, nextMonthParts.month)),
  });
};

export const getNextDueDateForCadence = getNextDueLocalDate;

export const toTimezoneLocalDateKey = toLocalDateKey;

const toUtcDateFromLocalDateKey = (localDateKey: string): Date | undefined => {
  const parsed = parseLocalDateKey(localDateKey);
  if (!parsed) {
    return undefined;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0));
};

const getEnvironmentPrefix = (scope: BackupCadence) => {
  switch (scope) {
    case "daily":
      return "backup-plugin-daily";
    case "weekly":
      return "backup-plugin-weekly";
    case "biweekly":
      return "backup-plugin-biweekly";
    case "monthly":
      return "backup-plugin-monthly";
  }
};

const getDateSuffix = (now: Date) => now.toISOString().split("T")[0];

const resolveSchedulerProvider = (
  providerHint?: SchedulerProvider,
): SchedulerProvider => {
  if (
    providerHint === "vercel" ||
    providerHint === "netlify" ||
    providerHint === "cloudflare"
  ) {
    return providerHint;
  }

  const processEnv = getProcessEnv();
  if (!processEnv) {
    return providerHint ?? "unknown";
  }

  if (processEnv.VERCEL || processEnv.VERCEL_ENV || processEnv.VERCEL_URL) {
    return "vercel";
  }

  if (processEnv.NETLIFY) {
    return "netlify";
  }

  if (processEnv.CF_PAGES || processEnv.CLOUDFLARE_ACCOUNT_ID) {
    return "cloudflare";
  }

  return providerHint ?? "unknown";
};

const getProjectTimezone = async (
  client: ReturnType<typeof buildClient>,
): Promise<string> => {
  try {
    const site = (await client.site.find()) as Record<string, unknown>;
    const timezone = toOptionalString(site.timezone);
    return ensureTimezone(timezone, DEFAULT_TIMEZONE);
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

const persistPluginParameters = async ({
  client,
  pluginId,
  parameters,
}: {
  client: ReturnType<typeof buildClient>;
  pluginId: string;
  parameters: Record<string, unknown>;
}) => {
  await client.plugins.update(pluginId, {
    parameters,
  });
};

const getBackupContext = async (
  options: BackupExecutionOptions = {},
): Promise<BackupContext> => {
  const now = options.now ?? new Date();
  const apiToken = resolveApiToken(options.apiToken);
  assignApiTokenToProcessEnv(apiToken);

  const client = buildClient({ apiToken });
  const plugin = await findAutomaticBackupsPlugin(apiToken);
  const siteTimezone = await getProjectTimezone(client);

  if (!plugin) {
    const normalized = normalizeBackupScheduleConfig({
      value: undefined,
      timezoneFallback: siteTimezone,
      now,
    });

    return {
      apiToken,
      client,
      pluginId: null,
      pluginParameters: {},
      scheduleConfig: normalized.config,
      scheduleState: {},
    };
  }

  const pluginParameters = isObject(plugin.parameters) ? plugin.parameters : {};
  const normalized = normalizeBackupScheduleConfig({
    value: pluginParameters.backupSchedule,
    timezoneFallback: siteTimezone,
    now,
  });

  const updatedParameters = {
    ...pluginParameters,
    ...(normalized.requiresMigration ? { backupSchedule: normalized.config } : {}),
  };

  if (normalized.requiresMigration) {
    await persistPluginParameters({
      client,
      pluginId: plugin.id,
      parameters: updatedParameters,
    });
  }

  return {
    apiToken,
    client,
    pluginId: plugin.id,
    pluginParameters: updatedParameters,
    scheduleConfig: normalized.config,
    scheduleState: toScheduleState(updatedParameters.automaticBackupsSchedule),
  };
};

const persistScheduleState = async ({
  context,
  scheduleState,
}: {
  context: BackupContext;
  scheduleState: AutomaticBackupsScheduleState;
}) => {
  if (!context.pluginId) {
    return;
  }

  const nextParameters = {
    ...context.pluginParameters,
    automaticBackupsSchedule: scheduleState,
  };

  await persistPluginParameters({
    client: context.client,
    pluginId: context.pluginId,
    parameters: nextParameters,
  });
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const executeScopedBackup = async (
  scope: BackupCadence,
  options: BackupExecutionOptions = {},
): Promise<ScopedBackupResult> => {
  const apiToken = resolveApiToken(options.apiToken);
  assignApiTokenToProcessEnv(apiToken);

  const now = options.now ?? new Date();
  const client = buildClient({ apiToken });
  const environments = await client.environments.list();

  const mainEnvironment = environments.find((environment) => environment.meta.primary);
  if (!mainEnvironment) {
    throw new Error("Could not locate the primary DatoCMS environment.");
  }

  const prefix = getEnvironmentPrefix(scope);
  const previousBackups = environments.filter(
    (environment) =>
      !environment.meta.primary && environment.id.startsWith(`${prefix}-`),
  );

  // Intentional order: delete before fork to avoid temporary double-backup overlap
  // that can push clients into environment overages during rotation windows.
  for (const previousBackup of previousBackups) {
    await client.environments.destroy(previousBackup.id);
  }

  const createdEnvironmentId = `${prefix}-${getDateSuffix(now)}`;
  await client.environments.fork(mainEnvironment.id, {
    id: createdEnvironmentId,
  });

  return {
    scope,
    createdEnvironmentId,
    deletedEnvironmentId: previousBackups[0]?.id ?? null,
  };
};

const executeCadencesAndPersistState = async ({
  context,
  cadences,
  now,
}: {
  context: BackupContext;
  cadences: BackupCadence[];
  now: Date;
}): Promise<ScheduledCadenceExecutionResult[]> => {
  const currentLocalDate = toLocalDateKey(now, context.scheduleConfig.timezone);
  const scheduleState = context.scheduleState;
  const runLocalDateByCadence: Partial<Record<BackupCadence, string>> = {
    ...(scheduleState.lastRunLocalDateByCadence ?? {}),
  };
  const runAtByCadence: Partial<Record<BackupCadence, string>> = {
    ...(scheduleState.lastRunAtByCadence ?? {}),
  };
  const managedEnvironmentIdByCadence: Partial<Record<BackupCadence, string>> = {
    ...(scheduleState.lastManagedEnvironmentIdByCadence ?? {}),
  };
  const executionModeByCadence: Partial<Record<BackupCadence, "lambda_cron">> = {
    ...(scheduleState.lastExecutionModeByCadence ?? {}),
  };
  const errorByCadence: Partial<Record<BackupCadence, string>> = {
    ...(scheduleState.lastErrorByCadence ?? {}),
  };

  const results: ScheduledCadenceExecutionResult[] = [];

  for (const cadence of cadences) {
    try {
      const result = await executeScopedBackup(cadence, {
        apiToken: context.apiToken,
        now,
      });
      const completedAt = new Date().toISOString();

      runLocalDateByCadence[cadence] = currentLocalDate;
      runAtByCadence[cadence] = completedAt;
      managedEnvironmentIdByCadence[cadence] = result.createdEnvironmentId;
      executionModeByCadence[cadence] = "lambda_cron";
      delete errorByCadence[cadence];

      results.push({
        scope: cadence,
        status: "executed",
        result,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      errorByCadence[cadence] = message;
      results.push({
        scope: cadence,
        status: "failed",
        error: message,
      });
    }
  }

  if (context.pluginId && cadences.length > 0) {
    const nextState: AutomaticBackupsScheduleState = {
      ...scheduleState,
      lastRunLocalDateByCadence: runLocalDateByCadence,
      lastRunAtByCadence: runAtByCadence,
      lastManagedEnvironmentIdByCadence: managedEnvironmentIdByCadence,
      lastExecutionModeByCadence: executionModeByCadence,
      lastErrorByCadence: errorByCadence,
    };

    if (runLocalDateByCadence.daily) {
      nextState.dailyLastRunDate = runLocalDateByCadence.daily;
    }
    if (runAtByCadence.daily) {
      nextState.lastDailyRunAt = runAtByCadence.daily;
      nextState.lastDailyExecutionMode = executionModeByCadence.daily;
      nextState.lastDailyManagedEnvironmentId = managedEnvironmentIdByCadence.daily;
      nextState.lastDailyError = errorByCadence.daily;
    }

    if (runLocalDateByCadence.weekly) {
      nextState.weeklyLastRunKey = toUtcIsoWeekKey(now);
    }
    if (runAtByCadence.weekly) {
      nextState.lastWeeklyRunAt = runAtByCadence.weekly;
      nextState.lastWeeklyExecutionMode = executionModeByCadence.weekly;
      nextState.lastWeeklyManagedEnvironmentId = managedEnvironmentIdByCadence.weekly;
      nextState.lastWeeklyError = errorByCadence.weekly;
    }

    await persistScheduleState({
      context,
      scheduleState: nextState,
    });
  }

  return results;
};

const getDueCadences = ({
  context,
  now,
}: {
  context: BackupContext;
  now: Date;
}): BackupCadence[] => {
  const currentLocalDate = toLocalDateKey(now, context.scheduleConfig.timezone);

  return context.scheduleConfig.enabledCadences.filter((cadence) => {
    const lastRunLocalDate = getLastRunLocalDateForCadence({
      scheduleState: context.scheduleState,
      cadence,
      now,
      timezone: context.scheduleConfig.timezone,
    });

    return isCadenceDueNow({
      cadence,
      anchorLocalDate: context.scheduleConfig.anchorLocalDate,
      currentLocalDate,
      lastRunLocalDate,
    });
  });
};

export const hasScheduledBackupFailures = (
  result: ScheduledBackupsRunResult,
): boolean => {
  return result.results.some((entry) => entry.status === "failed");
};

export const runScheduledBackups = async (
  options: BackupExecutionOptions & { providerHint?: SchedulerProvider } = {},
): Promise<ScheduledBackupsRunResult> => {
  const now = options.now ?? new Date();
  const provider = resolveSchedulerProvider(options.providerHint);
  const context = await getBackupContext(options);
  const checkedAt = new Date().toISOString();

  const dueCadences = getDueCadences({ context, now });
  if (dueCadences.length === 0) {
    return {
      scheduler: {
        provider,
        cadence: "daily",
      },
      schedule: {
        timezone: context.scheduleConfig.timezone,
        enabledCadences: context.scheduleConfig.enabledCadences,
        anchorLocalDate: context.scheduleConfig.anchorLocalDate,
      },
      checkedAt,
      skipped: true,
      reason: "NOT_DUE",
      results: [],
    };
  }

  const results = await executeCadencesAndPersistState({
    context,
    cadences: dueCadences,
    now,
  });

  return {
    scheduler: {
      provider,
      cadence: "daily",
    },
    schedule: {
      timezone: context.scheduleConfig.timezone,
      enabledCadences: context.scheduleConfig.enabledCadences,
      anchorLocalDate: context.scheduleConfig.anchorLocalDate,
    },
    checkedAt,
    skipped: false,
    results,
  };
};

type ManualBackupNowOptions = BackupExecutionOptions & {
  scope: BackupCadence;
  providerHint?: SchedulerProvider;
};

export const runManualBackupNow = async (
  options: ManualBackupNowOptions,
): Promise<ManualBackupNowResult> => {
  const now = options.now ?? new Date();
  const context = await getBackupContext(options);
  const { scope } = options;

  if (!context.scheduleConfig.enabledCadences.includes(scope)) {
    throw new CadenceNotEnabledError(scope);
  }

  const [result] = await executeCadencesAndPersistState({
    context,
    cadences: [scope],
    now,
  });
  const checkedAt = new Date().toISOString();

  if (!result || result.status === "failed") {
    return {
      scope,
      status: "failed",
      checkedAt,
      error:
        result?.status === "failed"
          ? result.error
          : "Backup execution did not produce a result.",
    };
  }

  return {
    scope,
    status: "executed",
    executionMode: "lambda_cron",
    createdEnvironmentId: result.result.createdEnvironmentId,
    deletedEnvironmentId: result.result.deletedEnvironmentId,
    completedAt: checkedAt,
    checkedAt,
  };
};

export const getLatestBackupCreatedAtForScope = (
  environments: Array<{
    id: string;
    meta: {
      primary: boolean;
      created_at: string;
    };
  }>,
  scope: BackupCadence,
): string | null => {
  const prefix = getEnvironmentPrefix(scope);

  const matching = environments
    .filter(
      (environment) =>
        !environment.meta.primary && environment.id.startsWith(`${prefix}-`),
    )
    .slice()
    .sort(
      (left, right) =>
        new Date(right.meta.created_at).getTime() -
        new Date(left.meta.created_at).getTime(),
    );

  return matching[0]?.meta.created_at ?? null;
};

type BackupStatusOptions = BackupExecutionOptions & {
  providerHint?: SchedulerProvider;
};

export const getBackupStatus = async (
  options: BackupStatusOptions = {},
): Promise<BackupStatusResult> => {
  const now = options.now ?? new Date();
  const provider = resolveSchedulerProvider(options.providerHint);
  const context = await getBackupContext(options);
  const environments = await context.client.environments.list();
  const currentLocalDate = toLocalDateKey(now, context.scheduleConfig.timezone);

  const slots = BACKUP_CADENCES.reduce((accumulator, cadence) => {
    const enabled = context.scheduleConfig.enabledCadences.includes(cadence);
    const lastRunLocalDate = getLastRunLocalDateForCadence({
      scheduleState: context.scheduleState,
      cadence,
      now,
      timezone: context.scheduleConfig.timezone,
    });
    const nextDueDate = enabled
      ? getNextDueLocalDate({
          cadence,
          anchorLocalDate: context.scheduleConfig.anchorLocalDate,
          currentLocalDate,
          lastRunLocalDate,
        })
      : null;

    const nextDueAt = nextDueDate
      ? toUtcDateFromLocalDateKey(nextDueDate)?.toISOString() ?? null
      : null;

    accumulator[cadence] = {
      scope: cadence,
      executionMode: "lambda_cron",
      lastBackupAt: getLatestBackupCreatedAtForScope(environments, cadence),
      nextBackupAt: nextDueAt,
    };

    return accumulator;
  }, {} as Record<BackupCadence, BackupStatusSlot>);

  return {
    scheduler: {
      provider,
      cadence: "daily",
    },
    slots: {
      daily: slots.daily,
      weekly: slots.weekly,
      biweekly: slots.biweekly,
      monthly: slots.monthly,
    },
    checkedAt: new Date().toISOString(),
  };
};
