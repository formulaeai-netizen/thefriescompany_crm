# Fry Guys WhatsApp Worker — Deployment Guide

This worker is a separate, always-on Node process from the root CRM (which
deploys to Vercel/Cloudflare). It must run on a persistent host — a
serverless/edge platform cannot hold a WhatsApp-web session open.

No secrets are documented here. Every value below is a **name only** — the
actual values live in `worker/.env` (git-ignored) on the host.

## 1. Required environment variables (names only)

| Variable                        | Purpose                                                                                                                                                  | Safe default                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `SUPABASE_URL`                  | Supabase project URL the worker connects to                                                                                                              | (from the NEW project, `uclo...mbud`) |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service-role key for privileged reads/writes and the service-role-only RPCs (`claim_wastage_ai_processing`, `claim_due_credit_purchase_reminders`, etc.) | never printed/logged                  |
| `WHATSAPP_PROVIDER`             | `whatsapp-web` or `meta-cloud`                                                                                                                           | `whatsapp-web`                        |
| `WHATSAPP_AUTOMATION_ENABLED`   | Master on/off for the reminder scheduler                                                                                                                 | `false`                               |
| `WHATSAPP_DRY_RUN`              | Worker-level dry-run gate (mirrors DB `*_settings.dry_run`)                                                                                              | `true`                                |
| `WHATSAPP_ALLOW_REAL_SEND`      | Final send gate — the WhatsApp provider refuses to send unless this is `true`                                                                            | `false`                               |
| `WHATSAPP_SESSION_PATH`         | Persistent WhatsApp-web session/auth directory                                                                                                           | `.worker-data/whatsapp-session`       |
| `WHATSAPP_MESSAGE_DELAY_MS`     | Delay between consecutive sends                                                                                                                          | `5000`                                |
| `WHATSAPP_MAX_SEND_RETRIES`     | Per-message send attempts                                                                                                                                | `2`                                   |
| `OPENAI_API_KEY`                | Only needed if this host also runs OpenAI-calling code (it currently does not — wastage AI runs in the root CRM, not the worker)                         | n/a for this worker                   |
| `WEB_PUSH_ENABLED`              | Enables scheduled PWA push dispatch                                                                                                                      | `false`                               |
| `WEB_PUSH_DRY_RUN`              | Keeps push dispatch in dry-run mode                                                                                                                      | `true`                                |
| `WEB_PUSH_VAPID_PUBLIC_KEY`     | VAPID public key for web push                                                                                                                            | configured only after key generation  |
| `WEB_PUSH_VAPID_PRIVATE_KEY`    | VAPID private key for web push                                                                                                                           | never printed/logged                  |
| `WEB_PUSH_SUBJECT`              | VAPID contact subject                                                                                                                                    | `mailto:admin@example.com`            |
| `OPERATIONS_BRIEF_ENABLED`      | Enables morning/evening in-app operations brief notifications                                                                                            | `false`                               |
| `OPERATIONS_BRIEF_MORNING_CRON` | Morning brief schedule in Asia/Karachi                                                                                                                   | `0 9 * * *`                           |
| `OPERATIONS_BRIEF_EVENING_CRON` | Evening brief schedule in Asia/Karachi                                                                                                                   | `0 20 * * *`                          |
| `AI_WATCHDOG_SCHEDULER_ENABLED` | Reserved gate for future periodic watchdog evaluation                                                                                                    | `false`                               |

Recurring workflows are additionally gated **in the database**, not just by
env vars — see `invoice_reminder_settings`, `operational_alert_dispatch_settings`,
and `whatsapp_routing_numbers` (Settings page, Admin-only). All three gates
(DB `enabled`, DB `dry_run`, env `WHATSAPP_ALLOW_REAL_SEND`) must align
before any real send is possible — this is intentional defense in depth,
preserved by every prompt in this project.

## 2. Persistent WhatsApp session directory

`WHATSAPP_SESSION_PATH` (default `.worker-data/whatsapp-session`) must live
on a persistent volume, not an ephemeral container filesystem — losing it
means re-scanning the WhatsApp QR code and a new session. Back it up like
any other stateful credential store; treat it as sensitive (it is
equivalent to an active login session).

## 3. Process management (PM2)

`ecosystem.config.cjs` (repo root of `worker/`) defines the production
process. It contains no secrets — real config comes from `worker/.env`.

```powershell
cd worker
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save            # persist across host reboots (with pm2 startup/pm2-windows-startup)
pm2 logs fryguys-whatsapp-worker
pm2 status
```

Key policy encoded in `ecosystem.config.cjs`:

- **Single instance, fork mode only.** The scheduler's overlap guard and the
  DB's atomic claim RPCs assume exactly one worker process. Never run this
  under PM2 cluster mode or with `instances > 1`.
- **Restart policy:** auto-restart on crash, `max_restarts: 10` with a
  `restart_delay` and `min_uptime` guard so a fast crash-loop against real
  credentials backs off instead of hammering Supabase/WhatsApp.
- **Memory restart limit:** `max_memory_restart: "500M"` — Puppeteer/Chromium
  (used by `whatsapp-web.js`) is the most likely long-run leak source.
- **Graceful shutdown:** `kill_timeout: 10000` gives `index.ts`'s existing
  SIGINT/SIGTERM handler (stop scheduler → stop inbound listener →
  disconnect WhatsApp provider → exit) time to finish before a hard kill.
- **Timestamped logs:** `log_date_format` stamps every captured log line;
  `out_file`/`error_file` write to `worker/logs/` (already git-ignored).

## 4. Health / status checks

No HTTP health endpoint exists (this is a background worker, not a web
service). Use these instead:

```powershell
pm2 status fryguys-whatsapp-worker      # process up/down, restart count, memory
pm2 logs fryguys-whatsapp-worker --lines 100
npm run scheduler:status                # prints current invoice_reminder_settings + worker connection state (read-only)
```

A healthy worker logs, on startup: `Worker config loaded`, then (once a
WhatsApp-web session is connected) `Inbound payment confirmation listener
started` and `Worker scheduler started`. Repeated `disconnected`/reconnect
log lines indicate a WhatsApp-web session problem, not a code problem.

## 5. Deployment order

1. `npm install && npm run build` on the target host.
2. Confirm `worker/.env` is present and correct (never commit it).
3. Confirm `WHATSAPP_SESSION_PATH` points at a persistent volume.
4. Start under PM2 as above; do **not** enable `WHATSAPP_ALLOW_REAL_SEND` or
   any DB `enabled` flag until the project's controlled activation checklist
   (staged deploy → connect session → dry-run verification → one controlled
   test send per flow → enable recurring schedules one at a time) has been
   followed in order.

## 6. What this worker does NOT do

- No secrets are ever written to this file, `ecosystem.config.cjs`, or any
  other repository file.
- This guide does not deploy anything by itself — running the commands
  above is a manual, human-triggered action.
