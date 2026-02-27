# DatoCMS Automatic Environment Backups Service

Backend for the DatoCMS Automatic Environment Backups plugin.

This repository contains:

- daily backup endpoint
- weekly backup endpoint
- one-time initialization endpoint (legacy alias in Netlify)
- plugin health handshake endpoint
- three platform targets: Netlify Functions, Vercel serverless, Cloudflare Workers

## Repository links

- Plugin: https://github.com/datocms/plugins/tree/master/automatic-environment-backups
- Repo: https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function

## How it works

All deployment targets share the same core implementation:

- `services/backupService.ts` runs the actual work.
- `utils/platformAdapters.ts` converts platform-specific requests into the shared handler format.
- Platform entry points call shared handlers from:
  - `api/datocms/plugin-health.ts`
  - `api/jobs/daily-backup.ts`
  - `api/jobs/weekly-backup.ts`
  - `api/jobs/initialize.ts`
  - `netlify/functions/*`
  - `cloudflare/worker.ts`

### Backup flow

For each run, the service:

1. resolves API token from explicit input or environment
2. lists environments through the DatoCMS CMA client
3. identifies the primary environment
4. deletes the previous backup environment with the same scope prefix, if found
5. creates a new fork with deterministic id

Backup IDs:

- daily: `backup-plugin-daily-YYYY-MM-DD`
- weekly: `backup-plugin-weekly-YYYY-MM-DD`

Result payload includes:

- `scope`: `"daily"` or `"weekly"`
- `createdEnvironmentId`
- `deletedEnvironmentId` (`null` if none existed)

## Environment variables

Set this for new deployments:

- `DATOCMS_FULLACCESS_API_TOKEN` (preferred)

Backward compatibility is preserved:

- `DATOCMS_FULLACCESS_TOKEN` is still accepted as a legacy fallback

The service reads these in all targets. If neither is available the request fails with:

- `code: "MISSING_API_TOKEN"`
- `message: "Missing API token. Configure ..."`

## Scheduling model

### Cron expressions

Current cron defaults are platform-specific:

- Netlify + Cloudflare:
  - `5 * * * *` (minute 5, every hour UTC)
  - `35 * * * *` (minute 35, every hour UTC)
- Vercel:
  - `5 2 * * *` (daily at 02:05 UTC)
  - `35 2 * * *` (daily at 02:35 UTC)

Vercel values are intentionally once per day so the project always fits Vercel Hobby cron limits.

### Deterministic distributed slots

To avoid all projects running backups at the same time:

- hourly cadence mode:
  - daily scope gets one UTC hour per project from a deterministic hash of
    `scope + token + constant-salt`
  - weekly scope gets one UTC weekday + hour per project from the same deterministic hash
- daily cadence mode (used for Vercel cron):
  - daily scope always executes when invoked
  - weekly scope executes only on the assigned UTC weekday
- if current time is outside the assigned slot, the run is skipped as a safe no-op
- if inside the assigned slot, backup executes

Response example on skip:

```json
{
  "ok": true,
  "skipped": true,
  "reason": "NOT_DUE_IN_DISTRIBUTED_SLOT",
  "scope": "daily",
  "schedule": {
    "slotHourUtc": 13,
    "slotWeekdayUtc": null,
    "currentHourUtc": 7,
    "currentWeekdayUtc": 1
  }
}
```

For weekly, `slotWeekdayUtc` is `0..6` (`0` = Sunday).

## API contract

All responses use JSON.

### 1) Plugin health

`POST /api/datocms/plugin-health`

Request:

```json
{
  "event_type": "plugin_health_ping",
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_PING",
    "version": "2026-02-26",
    "phase": "finish_installation | config_mount | config_connect"
  },
  "plugin": {
    "name": "datocms-plugin-automatic-environment-backups",
    "environment": "main"
  }
}
```

Success:

```json
{
  "ok": true,
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_PONG",
    "version": "2026-02-26"
  },
  "service": "datocms-backups-scheduled-function",
  "status": "ready"
}
```

Error envelope pattern used across all handlers:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body is not valid JSON",
    "details": {}
  }
}
```

Supported health error codes:

- `METHOD_NOT_ALLOWED`
- `INVALID_JSON`
- `INVALID_BODY`
- `INVALID_EVENT_TYPE`
- `INVALID_MPI_MESSAGE`
- `INVALID_MPI_VERSION`
- `INVALID_MPI_PHASE`
- `INVALID_PLUGIN_NAME`
- `INVALID_PLUGIN_ENVIRONMENT`
- `INTERNAL_SERVER_ERROR`

`OPTIONS` is accepted with CORS preflight behavior.

### 2) Backup status

`POST /api/datocms/backup-status`

Request:

```json
{
  "event_type": "backup_status_request",
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_STATUS",
    "version": "2026-02-26"
  },
  "plugin": {
    "name": "datocms-plugin-automatic-environment-backups",
    "environment": "main"
  }
}
```

### 2b) Scheduler disconnect

`POST /api/datocms/scheduler-disconnect`

Request:

```json
{
  "event_type": "scheduler_disconnect_request",
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_PLUGIN_SCHEDULER_DISCONNECT",
    "version": "2026-02-26"
  },
  "plugin": {
    "name": "datocms-plugin-automatic-environment-backups",
    "environment": "main"
  }
}
```

Success:

```json
{
  "ok": true,
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_SCHEDULER_DISCONNECTED",
    "version": "2026-02-26"
  },
  "service": "datocms-backups-scheduled-function",
  "status": "ready",
  "scheduler": {
    "enabled": false,
    "disconnectedAt": "2026-02-27T15:00:00.000Z"
  },
  "plugin": {
    "id": "PLUGIN_ID"
  }
}
```

Success:

```json
{
  "ok": true,
  "mpi": {
    "message": "DATOCMS_AUTOMATIC_BACKUPS_LAMBDA_STATUS",
    "version": "2026-02-26"
  },
  "service": "datocms-backups-scheduled-function",
  "status": "ready",
  "scheduler": {
    "provider": "vercel",
    "cadence": "daily"
  },
  "slots": {
    "daily": {
      "scope": "daily",
      "executionMode": "lambda_cron",
      "lastBackupAt": "2026-02-26T02:05:00.000Z",
      "nextBackupAt": "2026-02-27T02:05:00.000Z"
    },
    "weekly": {
      "scope": "weekly",
      "executionMode": "lambda_cron",
      "lastBackupAt": "2026-02-24T02:35:00.000Z",
      "nextBackupAt": "2026-02-28T02:35:00.000Z"
    }
  },
  "checkedAt": "2026-02-26T12:00:00.000Z"
}
```

### 3) Daily backup endpoint

Vercel/API route: `GET|POST /api/jobs/daily-backup`

Cloudflare route: `GET|POST /api/jobs/daily-backup`

Netlify scheduled function:

- public on-demand route: `GET|POST /api/datocms/backup-now`
- scheduled cron function still runs through `netlify/functions/dailyBackup/dailyBackup.ts`

Behavior:

- Vercel cron invocations use daily cadence:
  - daily route executes on each cron trigger
  - weekly route executes only on its assigned UTC weekday
- Vercel `GET` without cron headers uses hourly distributed scheduling unless forced
- Vercel `POST` is manual unless force flag is set
- Cloudflare direct route always executes immediate backup
- Scheduled skip reasons:
  - `NOT_DUE_IN_DISTRIBUTED_SLOT`
  - `SCHEDULER_DISABLED`

Manual success:

```json
{
  "ok": true,
  "result": {
    "scope": "daily",
    "createdEnvironmentId": "backup-plugin-daily-2026-02-26",
    "deletedEnvironmentId": null
  }
}
```

Scheduled success:

```json
{
  "ok": true,
  "result": {
    "scope": "daily",
    "createdEnvironmentId": "backup-plugin-daily-2026-02-26",
    "deletedEnvironmentId": "backup-plugin-daily-2026-02-25"
  },
  "schedule": {
    "slotHourUtc": 13,
    "slotWeekdayUtc": null,
    "currentHourUtc": 13,
    "currentWeekdayUtc": 2
  }
}
```

Supported error codes:

- `METHOD_NOT_ALLOWED` (non-GET/POST on Vercel route)
- `MISSING_API_TOKEN`
- `INTERNAL_SERVER_ERROR`

### Force run options for scheduled logic

For Vercel daily/weekly handlers, distributed scheduling can be bypassed with:

- query string `?force=true`
- body `{ "force": true }`
- header `x-datocms-force-run: true`

When forced, handler performs immediate run.

### 4) Weekly backup endpoint

`GET|POST /api/jobs/weekly-backup`

Same structure as daily, with `scope: "weekly"` and weekday-aware scheduling.

### 5) Initialization endpoint

Vercel route: `GET|POST /api/jobs/initialize`

Legacy Netlify path: `/.netlify/functions/initialization`

Performs both daily and weekly backup operations and returns both results.

Success example:

```json
{
  "ok": true,
  "message": "Initialization completed successfully!",
  "result": {
    "daily": {
      "scope": "daily",
      "createdEnvironmentId": "backup-plugin-daily-2026-02-26",
      "deletedEnvironmentId": null
    },
    "weekly": {
      "scope": "weekly",
      "createdEnvironmentId": "backup-plugin-weekly-2026-02-26",
      "deletedEnvironmentId": null
    }
  }
}
```

## Platform-specific deployment

### Netlify

One-click:

- https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function

Files:

- `netlify.toml` includes template env vars and redirects for:
  - `/api/datocms/plugin-health`
  - `/api/datocms/backup-status`
  - `/api/datocms/backup-now`
  - `/api/datocms/scheduler-disconnect`
- `netlify/functions/backup-now.ts` wraps shared on-demand backup handler
- `netlify/functions/plugin-health.ts` wraps shared health handler
- `netlify/functions/backup-status.ts` wraps shared status handler
- `netlify/functions/scheduler-disconnect.ts` wraps shared scheduler disconnect handler
- `netlify/functions/dailyBackup/dailyBackup.ts` cron job
- `netlify/functions/weeklyBackup/weeklyBackup.ts` cron job
- `netlify/functions/initialization/initialization.ts` legacy initialization handler

### Vercel

One-click:

- https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function

Files:

- `api/datocms/plugin-health.ts`
- `api/datocms/backup-status.ts`
- `api/datocms/scheduler-disconnect.ts`
- `api/jobs/daily-backup.ts`
- `api/jobs/weekly-backup.ts`
- `api/jobs/initialize.ts`
- `vercel.json` (cron schedule)
- Vercel cron values are daily to remain Hobby-compatible:
  - `5 2 * * *` for daily endpoint
  - `35 2 * * *` for weekly endpoint

### Cloudflare Workers

- Entry point: `cloudflare/worker.ts`
- Route mapping:
  - `POST /api/datocms/plugin-health`
  - `POST /api/datocms/backup-status`
  - `POST /api/datocms/scheduler-disconnect`
  - `GET|POST /api/jobs/daily-backup`
  - `GET|POST /api/jobs/weekly-backup`
- Cron schedule in `wrangler.toml`:
  - `5 * * * *` for daily
  - `35 * * * *` for weekly

## Project structure

- `services/backupService.ts`: backup orchestration, token resolution, distributed scheduling
- `services` shared business logic and deterministic scheduling functions
- `utils/healthContract.ts`: constants for plugin health contract
- `utils/platformAdapters.ts`: request/response bridging helpers
- `api/`: Vercel handlers
- `netlify/functions/`: Netlify wrappers and scheduled handlers
- `cloudflare/`: Worker implementation
- `tests/`: Node test suite for scheduling + API behavior

## Local setup

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Notes:

- Netlify function-specific packages are under each function package directory (`netlify/functions/*/package.json`), but root dependencies are sufficient for shared code checks.
- API and tests consume the shared TypeScript runtime directly.

## Common gotchas

- `plugin-health` requires exact contract values from `utils/healthContract.ts`.
- `plugin.environment` must be a non-empty string.
- `runScheduled*` logic is UTC-based (`getUTCHours` / `getUTCDay`).
- `runScheduled*` supports two cadence modes:
  - `hourly` (daily uses hour slot, weekly uses weekday+hour slot)
  - `daily` (daily always due, weekly uses weekday slot)
- Weekly scheduling `slotWeekdayUtc` is only present for weekly scope.
- If `runScheduled*` runs outside the assigned slot, it returns structured skip response with `200`.
- If the plugin is disconnected, scheduled runs return skip reason `SCHEDULER_DISABLED` with `200`.

## Compatibility

This repository is designed to work both with the latest plugin handshake contract and legacy token env var name.
