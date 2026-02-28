# DatoCMS Automatic Environment Backups Service

Backend service for the DatoCMS Automatic Environment Backups plugin.

This repository is now **lambda-full only** with a **single scheduled cron flow** for backups.

## What this service exposes

### 1) Plugin health

- `POST /api/datocms/plugin-health`
- Validates plugin handshake payload and returns service readiness.

### 2) Backup status

- `POST /api/datocms/backup-status`
- Returns scheduler metadata and cadence slots (`daily`, `weekly`, `biweekly`, `monthly`) with:
  - `executionMode: "lambda_cron"`
  - latest backup timestamp
  - next due timestamp

### 3) Scheduled backups job

- `POST /api/jobs/scheduled-backups`
- Authenticated cron-triggered aggregate job.
- Executes all due cadences from plugin schedule configuration.
- Returns `500` with `SCHEDULED_BACKUPS_PARTIAL_FAILURE` if any cadence fails.

## Intentionally removed

The codebase no longer supports:

- lambdaless runtime mode
- manual backup triggers (`backup-now`)
- scheduler disconnect endpoint
- legacy per-scope backup job endpoints (`daily-backup`, `weekly-backup`, `initialize`)

## Environment variables

Required:

- `DATOCMS_BACKUPS_SHARED_SECRET` (for authenticated HTTP routes, defaults to `superSecretToken` if omitted)
- `DATOCMS_FULLACCESS_API_TOKEN` (DatoCMS CMA token)

## Scheduling

Default cron schedule across targets:

- `5 2 * * *` (daily at 02:05 UTC)

The scheduled job uses plugin-backed cadence configuration and due-date logic.

## Platform targets

Quick deploy links:

- Vercel: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarcelofinamorvieira%2Fdatocms-backups-scheduled-function&env=DATOCMS_FULLACCESS_API_TOKEN,DATOCMS_BACKUPS_SHARED_SECRET&project-name=datocms-backups-scheduled-function&repo-name=datocms-backups-scheduled-function
- Netlify: https://app.netlify.com/start/deploy?repository=https://github.com/marcelofinamorvieira/datocms-backups-scheduled-function

### Netlify

- `netlify/functions/scheduledBackups.ts`
- `netlify/functions/plugin-health.ts`
- `netlify/functions/backup-status.ts`
- routing in `netlify.toml`

### Vercel

- API handlers in `api/`
- cron configured in `vercel.json`:
  - `/api/jobs/scheduled-backups` at `5 2 * * *`

### Cloudflare Workers

- entrypoint: `cloudflare/worker.ts`
- supports:
  - `POST /api/datocms/plugin-health`
  - `POST /api/datocms/backup-status`
  - `POST /api/jobs/scheduled-backups`
- scheduled hook also runs the unified job at `5 2 * * *`

#### Deploying on Cloudflare Workers

Set both secrets during deploy (these commands prompt for values):

```bash
wrangler secret put DATOCMS_FULLACCESS_API_TOKEN
wrangler secret put DATOCMS_BACKUPS_SHARED_SECRET
```

If `DATOCMS_BACKUPS_SHARED_SECRET` is omitted, auth falls back to `superSecretToken`.

## Local setup

```bash
npm install
npm test
```

## Notes

- All externally callable endpoints require `X-Datocms-Backups-Auth` matching `DATOCMS_BACKUPS_SHARED_SECRET`.
- The service persists schedule metadata on the plugin instance and always records cron executions as `lambda_cron`.
