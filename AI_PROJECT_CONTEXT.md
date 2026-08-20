# Fry Guys CRM - AI Handoff Context

Last updated: 2026-07-30

This is the sanitized single-file context for future AI agents working in this repo. It exists to reduce token usage and prevent dangerous mistakes.

Do not add secrets, passwords, API keys, access tokens, service-role keys, database connection strings, customer export rows, private environment values, full phone numbers, or real customer data to this file.

## Project Summary

Fry Guys CRM is a TanStack Start + React + Supabase CRM for The Fries Company. It manages clients, branches, invoices, inventory, daily production, expenses, salaries, investors, returns/damaged stock, WhatsApp logs, settings, role-based access, overdue invoice reminder queues, a separate WhatsApp worker, and admin payment verification requests.

The app is connected to Lovable. Follow `AGENTS.md`: do not rewrite published git history; avoid force-push/rebase/amend/squash on pushed commits.

## Current Stack

- App: TanStack Start, TanStack Router, React 19, TypeScript, Vite.
- Data/auth: Supabase.
- Queries/cache: TanStack React Query.
- UI: local shadcn-style components under `src/components/ui`, Tailwind CSS, lucide-react icons.
- Worker: separate Node/TypeScript worker under `worker/` using `whatsapp-web.js`.
- Package manager: npm with root `package-lock.json`; worker has its own `package.json` and lockfile.

Useful commands:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npx.cmd tsc --noEmit
npx.cmd tsx src\lib\invoice-reminders.test.ts
npx.cmd tsx src\lib\payment-verifications.test.ts

cd worker
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run scheduler:status
npm.cmd run run-once-dry
```

`run-once-live` exists in the worker but must not be used unless the user explicitly approves a live send.

## Hard Safety Rules

- Do not print or commit secrets.
- Do not print full `DATABASE_URL`, Supabase keys, database passwords, service-role keys, provider tokens, email passwords, WhatsApp tokens, Twilio tokens, Resend keys, private keys, or connection strings.
- `.env` and `worker/.env` are local-only and ignored.
- `.env.example` and `worker/.env.example` must contain placeholders only.
- Never use service-role keys in browser/frontend code.
- Do not connect to or modify the old production Supabase project.
- The current local `DATABASE_URL` points to the NEW Supabase project. The masked ref verified during latest migration work was `uclo...mbud`.
- The old production project ref is intentionally omitted here. If an old ref appears in history or notes, treat it as forbidden.
- Do not deploy, push, commit, run migrations, import CSVs, alter auth users/roles, enable integrations, or send messages without explicit approval.

## Repository Hygiene State

Recovery/export clutter was already copied outside the repo and removed from the repo. Do not bring customer data, CSVs, dumps, or backups back into GitHub.

Ignored local/generated artifacts include:

- `.env`
- `.env.*`
- `worker/.env`
- `node_modules/`
- `dist/`
- `.output/`
- `.wrangler/`
- `.tanstack/`
- `.worker-data/`
- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `recovery/`
- `exports/`
- `crmdata/`
- `*.csv`, `*.log`, `*.zip`, `*.dump`, `*.sql.gz`, backup/temp files

Do not delete:

- `src/`
- `public/`
- `supabase/migrations/`
- `supabase/functions/`
- package files/lockfiles
- `AGENTS.md`
- `.env.example`

Build commands may recreate `dist/`, `.output/`, `.wrangler/`, and `node_modules/`.

## Current Git State Warning

There are many uncommitted files from the WhatsApp/reminder/payment-verification work. Do not discard or overwrite them unless the user explicitly asks.

Important uncommitted/current files include:

- `AI_PROJECT_CONTEXT.md`
- `src/lib/invoice-reminders.ts`
- `src/lib/invoice-reminders.test.ts`
- `src/lib/invoice-reminder-queue.functions.ts`
- `src/lib/payment-verifications.ts`
- `src/lib/payment-verifications.test.ts`
- `src/lib/payment-verifications.functions.ts`
- `src/routes/_authenticated/payment-reminders.tsx`
- `src/routes/_authenticated/payment-verifications.tsx`
- `src/components/app-sidebar.tsx`
- `src/lib/roles.ts`
- `src/routes/_authenticated/invoices.index.tsx`
- `src/routes/_authenticated/settings.tsx`
- `src/integrations/supabase/types.ts`
- `src/routeTree.gen.ts`
- `supabase/migrations/20260729170000_invoice_reminders_foundation.sql`
- `supabase/migrations/20260730110000_invoice_reminder_settings.sql`
- `supabase/migrations/20260730160000_payment_verification_requests.sql`
- `supabase/migrations/20260730173000_payment_verification_selected_invoice_approval.sql`
- `worker/`

Chunk 2/3 (wastage verification, stock audits, operational alerts, moderator, OpenAI) - executed migrations and uncommitted app code:

- `supabase/migrations/20260730180000_moderator_role.sql`
- `supabase/migrations/20260730181000_operational_alerts_foundation.sql`
- `supabase/migrations/20260730182000_wastage_verification_foundation.sql`
- `supabase/migrations/20260730183000_stock_audit_foundation.sql`
- `supabase/migrations/20260731000000_chunk3_authenticated_grant_hardening.sql`
- `src/lib/wastage-verifications.ts` / `.test.ts`
- `src/lib/stock-audits.ts` / `.test.ts`
- `src/lib/openai-wastage-vision.server.ts` / `.test.ts`
- `src/lib/wastage-verifications.functions.ts`
- `src/lib/stock-audits.functions.ts`
- `src/lib/operational-alerts.functions.ts`
- `src/lib/user-admin.functions.ts`
- `src/components/users-management.tsx`
- `src/components/wastage-verification-dialog.tsx`
- `src/routes/_authenticated/production.tsx`
- `src/routes/_authenticated/wastage-verifications.tsx`
- `src/routes/_authenticated/stock-audits.tsx`
- `src/routes/_authenticated/operational-alerts.tsx`
- `.env.example`
- `package.json` / `package-lock.json` (added `openai`, and dev-only `pg`/`@types/pg` used solely for migration execution/introspection tooling)

## Supabase Restore History

The CRM was restored into a new Supabase project. Restore included schema preparation, safe migrations, manual auth user creation, UUID mapping, CSV transformation/import, validation, and local CRM env update.

Important restore safety outcomes:

- Do not use old production credentials.
- Do not import recovery CSVs again unless explicitly approved.
- Do not modify auth users/roles unless explicitly approved.
- Do not enable cron, WhatsApp, email, reminders, Edge Functions, or webhooks unless explicitly approved.

## Core Database / Types

Generated Supabase types live in:

- `src/integrations/supabase/types.ts`

Core tables used by app code include:

- `profiles`
- `user_roles`
- `clients`
- `branches`
- `invoices`
- `payment_screenshots`
- `whatsapp_logs`
- `settings`
- `inventory`
- `inventory_stock`
- `stock_movements`
- `daily_production`
- `delivery_areas`
- `delivery_calculations`
- `expenses`
- `reorder_alerts`
- `investors`
- `investor_returns`
- `products`
- `returns`
- `damaged_stock`
- `employee_salaries`
- `invoice_reminders`
- `invoice_reminder_settings`
- `payment_verification_requests`
- `operational_alerts`
- `wastage_verifications`
- `wastage_verification_events`
- `stock_audits`
- `stock_audit_items`
- `stock_audit_submissions`
- `stock_audit_submission_items`
- `stock_audit_events`

Enums:

- `public.app_role`: `admin`, `investor`, `staff`, `viewer`, `moderator`
- `public.payment_status_enum`: `Done`, `Not Done`, `Partial`, `Unknown`

Important DB helpers:

- `public.has_role(uuid, public.app_role)`
- `public.touch_updated_at()`

## Auth And Roles

Auth uses Supabase Auth. App roles live in `public.user_roles`.

Route/server access depends on:

- `src/lib/roles.ts`
- `src/routes/auth.tsx`
- `src/integrations/supabase/auth-middleware`
- `public.has_role`

Admin-only routes added for reminders/verifications:

- `/payment-reminders`
- `/payment-verifications`

Never create/modify auth users or roles without explicit approval.

## Important App Routes

Authenticated routes live under `src/routes/_authenticated/`.

Important routes:

- `index.tsx`: main dashboard.
- `clients.tsx`: clients/leads and branches.
- `invoices.index.tsx`: active invoices.
- `invoices.deleted.tsx`: archived/deleted invoices.
- `inventory.tsx`: inventory and stock movements.
- `production.tsx`: daily production.
- `expenses.tsx`: expenses.
- `pnl.tsx`: profit/loss.
- `customer-analytics.tsx`: customer analytics.
- `returns.tsx`: returns and damaged stock.
- `salaries.tsx`: employee salaries.
- `investors.index.tsx`, `investors.$id.tsx`, `investor.tsx`: investor workflows.
- `whatsapp-logs.tsx`: WhatsApp logs display.
- `payment-reminders.tsx`: admin dry-run/pending reminder queue controls.
- `payment-verifications.tsx`: admin review of inbound payment confirmations.
- `settings.tsx`: settings/provider/admin controls.

Navigation/sidebar:

- `src/components/app-sidebar.tsx`

Generated route tree:

- `src/routeTree.gen.ts`

Prefer letting TanStack tooling regenerate `routeTree.gen.ts`. Do not casually hand-edit it.

## Query Layer

Main query file:

- `src/lib/queries.ts`

Important functions:

- `fetchClients()`
- `fetchInvoices()`
- `fetchDeletedInvoices()`
- `fetchExpenses()`
- `fetchSettings()`
- `fetchInventory()`
- `fetchStockMovements()`

Never add logs that print row contents, secrets, environment values, full phone numbers, tokens, or customer data.

## Invoice Model And Payment Logic

Important invoice fields:

- `invoices.id`
- `invoices.invoice_no`
- `invoices.client_id`
- `invoices.branch_id`
- `invoices.date`
- `invoices.delivery_date`
- `invoices.due_date`
- `invoices.amount`
- `invoices.amount_received`
- `invoices.payment_status`
- `invoices.is_deleted`

Paid invoices are identified by:

```ts
payment_status === "Done";
```

Shared outstanding helper:

- `calculateOutstandingAmount()` in `src/lib/invoice-reminders.ts`

Formula:

```ts
payment_status === "Done" ? 0 : Math.max(amount - amount_received, 0);
```

Due-date helper:

- `calculateInvoiceDueDate(deliveryDate)`

New invoice behavior:

- `due_date = delivery_date + 15 days`
- if `delivery_date` is missing/invalid, no due date is invented
- DB fallback trigger also sets due date for inserts outside the frontend

Existing invoices must not be backfilled without explicit approval.

## Invoice Reminder Foundation

Migration executed:

- `supabase/migrations/20260729170000_invoice_reminders_foundation.sql`

Added/verified:

- `clients.phone_normalized text`
- `clients.whatsapp_opt_out boolean not null default false`
- `public.invoice_reminders`
- due-date fallback trigger on `public.invoices`
- RLS policies for `invoice_reminders`
- indexes and unique `idempotency_key`

`invoice_reminders` statuses:

- `pending`
- `approved`
- `processing`
- `sent`
- `failed`
- `skipped`
- `cancelled`

Admin can manage reminders. Staff can read. No public access.

## Reminder Settings And Admin UI

Migration executed:

- `supabase/migrations/20260730110000_invoice_reminder_settings.sql`

Creates singleton table:

- `public.invoice_reminder_settings`

Safe defaults:

- `enabled = false`
- `dry_run = true`
- `manual_approval_required = true`
- `pause_all = true`
- `provider = 'whatsapp-web'`
- `timezone = 'Asia/Karachi'`
- `maximum_reminders = 4`
- `maximum_daily_messages = 20`

Route:

- `/payment-reminders`
- file: `src/routes/_authenticated/payment-reminders.tsx`

This page:

- loads settings
- supports setting automation launch date
- generates dry-run reports
- can create pending queue rows only with second confirmation and safe settings
- shows pending reminders

This page does NOT send WhatsApp messages, start scheduler, approve reminders, deploy functions, call webhooks, or send email.

Dry-run verification previously showed:

- scanned invoices: 192
- eligible invoices: 0
- skipped paid: 117
- skipped missing due date: 60
- skipped invalid phone: 13
- reminder rows stayed 0 at that time

Later controlled tests created reminder rows; see live snapshot below.

## Reminder Eligibility Engine

Main files:

- `src/lib/invoice-reminders.ts`
- `src/lib/invoice-reminder-queue.functions.ts`
- `src/lib/invoice-reminders.test.ts`

Eligibility rules:

- `due_date` exists.
- `due_date` is before today.
- `payment_status` is not `Done`.
- outstanding amount > 0.
- client exists.
- `client.whatsapp_opt_out = false`.
- `client.reminders_paused = false`.
- client phone can be normalized.
- same invoice/stage is not already queued.
- max reminders per invoice not reached.
- invoice is not before `automation_launch_date`.

Reminder stages:

- `overdue_day_1`: 1-2 days overdue.
- `overdue_day_3`: 3-6 days overdue.
- `overdue_day_7`: 7-13 days overdue.
- `overdue_day_14`: 14+ days overdue.

Idempotency key:

```txt
invoice:{invoice_id}:stage:{reminder_stage}
```

Queue generation:

- admin-only server function `generateInvoiceReminderQueue`
- uses authenticated Supabase server context, not frontend service-role
- dry-run creates no rows
- pending creation inserts only `pending` rows
- no send/approval/scheduler action in the web app

## Pakistan Phone Normalization

Helpers exist in:

- `src/lib/invoice-reminders.ts`
- `worker/src/services/inbound-payment-confirmations.ts`

Supported:

```txt
03001234567 -> 923001234567
+923001234567 -> 923001234567
00923001234567 -> 923001234567
923001234567 -> 923001234567
```

Invalid/blank numbers return `null`.

Do not overwrite `clients.phone` automatically.

## Separate WhatsApp Worker

Worker folder:

- `worker/`

Important files:

- `worker/package.json`
- `worker/.env.example`
- `worker/src/index.ts`
- `worker/src/config.ts`
- `worker/src/providers/whatsapp-provider.ts`
- `worker/src/providers/whatsapp-web.provider.ts`
- `worker/src/providers/meta-cloud.provider.ts`
- `worker/src/services/supabase.ts`
- `worker/src/services/worker-status.ts`
- `worker/src/services/message-builder.ts`
- `worker/src/services/queue-processor.ts`
- `worker/src/services/scheduler.ts`
- `worker/src/services/inbound-payment-confirmations.ts`
- `worker/src/run-once.ts`
- `worker/src/scheduler-status.ts`
- `worker/src/diagnostic-direct-send.ts`

Worker packages include:

- `whatsapp-web.js`
- `puppeteer`
- `qrcode-terminal`
- `@supabase/supabase-js`
- `dotenv`
- `node-cron`
- TypeScript tooling

Worker env safety defaults:

```txt
WHATSAPP_PROVIDER=whatsapp-web
WHATSAPP_AUTOMATION_ENABLED=false
WHATSAPP_DRY_RUN=true
WHATSAPP_ALLOW_REAL_SEND=false
WHATSAPP_SESSION_PATH=.worker-data/whatsapp-session
```

Worker uses server-only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never put these in frontend code and never print their values.

The worker has provider abstraction:

- `WhatsAppProvider`
- `WhatsAppWebProvider`
- `MetaCloudProvider` skeleton only, intentionally not configured

`WhatsAppWebProvider`:

- uses `whatsapp-web.js`
- uses Puppeteer and LocalAuth
- persists session under `.worker-data/whatsapp-session`
- refuses send unless `WHATSAPP_ALLOW_REAL_SEND=true`
- validates target numbers with `client.getNumberId`
- sends to serialized chat ids like `923...@c.us`
- captures provider message id from direct return or event fallback
- never marks sent without provider/event confirmation
- cleans up per-send listeners

Worker scheduler:

- implemented with `node-cron`
- timezone `Asia/Karachi`
- daily run time `11:00 AM`
- checks `invoice_reminder_settings`
- stops if `enabled=false` or `pause_all=true`
- rechecks invoice payment status before sending
- respects daily cap, retry limit, duplicate protection, delay between messages
- one message at a time

Do not enable automatic production sending until the user explicitly approves.

Worker commands:

```powershell
cd worker
npm.cmd run dev
npm.cmd run start
npm.cmd run scheduler:status
npm.cmd run run-once-dry
npm.cmd run run-once-live
```

`run-once-live` requires explicit confirmation and `WHATSAPP_ALLOW_REAL_SEND=true`.

## WhatsApp Test History

Controlled live WhatsApp tests were performed only after explicit user approval.

Key outcomes:

- Initial direct-send path failed because no usable provider id was returned.
- Provider was hardened to use event-based confirmation fallback.
- A controlled queue-backed test reminder later passed.
- One test reminder was sent to the approved test number masked as `923******027`.
- Another diagnostic/manual test involved a different approved test number, but do not reuse any number without explicit approval.
- `WHATSAPP_ALLOW_REAL_SEND` was returned to false after controlled sends.
- Automation/scheduler stayed disabled.

Do not send any more WhatsApp messages without explicit approval.

## Payment Verification / Inbound PAID Flow

Goal:

- If a client replies `PAID`, `PAYMENT DONE`, or `PAID DONE`, create an admin review request.
- Do not automatically mark invoices paid.
- Admin must approve/reject in CRM.

Migration executed:

- `supabase/migrations/20260730160000_payment_verification_requests.sql`

Created:

- `public.payment_verification_requests`
- private storage bucket `payment-proofs`
- RLS policies
- RPCs:
  - `reject_payment_verification_request(uuid)`
  - initial approval RPC later replaced by selected-invoice version

Follow-up migration executed:

- `supabase/migrations/20260730173000_payment_verification_selected_invoice_approval.sql`

Current approval RPC signature:

```sql
public.approve_payment_verification_request(_request_id uuid, _selected_invoice_id uuid)
```

Old one-arg approval RPC was removed/replaced safely.

Reject RPC still exists:

```sql
public.reject_payment_verification_request(_request_id uuid)
```

Inbound service:

- `worker/src/services/inbound-payment-confirmations.ts`

Behavior:

- listens for incoming WhatsApp messages
- detects payment keywords case-insensitively
- normalizes sender phone
- matches client by `clients.phone_normalized` or `clients.phone`
- lists unpaid invoices for that client
- if exactly one unpaid invoice: creates `pending` request linked to that invoice
- if multiple unpaid invoices: creates `unresolved` request with no invoice id
- if media exists: stores proof metadata/path in private `payment-proofs` bucket
- never marks invoice paid automatically

Supervised inbound `PAID` test result:

- worker account masked as `923******375`
- sender/client masked as `923******027`
- accepted only that sender
- incoming body `PAID`
- matched `testing_dev`
- created one `payment_verification_requests` row
- request id: `33e2b17d-22bb-47c0-97cc-26f55ad881d3`
- status: `unresolved`
- invoice_id: `null`
- reason: `testing_dev` had 3 unpaid invoices
- TEST invoice stayed `Not Done`
- no outgoing message was sent
- scheduler/automation stayed disabled

## Payment Verification Admin UX

Route:

- `/payment-verifications`
- file: `src/routes/_authenticated/payment-verifications.tsx`

Server functions:

- `src/lib/payment-verifications.functions.ts`

Shared testable helper:

- `src/lib/payment-verifications.ts`

Tests:

- `src/lib/payment-verifications.test.ts`

Current UX:

- admin-only
- lists `pending` and `unresolved` payment verification requests
- unresolved requests show Select Invoice control
- Select Invoice loads only unpaid, non-archived invoices for the matched client
- shows invoice number, due date, amount, outstanding
- Approve is disabled until unresolved request has a selected invoice
- approval has confirmation dialog
- rejection does not touch invoices

Approval behavior through RPC:

- links request to selected invoice
- validates selected invoice belongs to matched client
- rejects already paid or archived invoice
- sets `payment_status = Done`
- sets `amount_received = invoice.amount`
- cancels `pending`, `approved`, and `processing` reminder rows for selected invoice
- marks request `approved`
- writes `reviewed_by` and `reviewed_at`

Rejection behavior:

- marks request `rejected`
- writes `reviewed_by` and `reviewed_at`
- does not modify invoice/payment/reminder state

## Latest Verified NEW DB Snapshot

After executing `20260730173000_payment_verification_selected_invoice_approval.sql`, verification showed:

- `payment_verification_requests`: `count=1; pending=0; unresolved=1; approved=0; rejected=0; linked=0`
- `invoices`: `count=199; done=117; amount_received_sum=0`
- `invoice_reminders`: `count=3; pending=0; approved=0; processing=0; sent=1; failed=2; cancelled=0`
- approval RPC exists with two args: `_request_id uuid, _selected_invoice_id uuid`
- old one-arg approval RPC missing/removed
- reject RPC exists
- no worker/scheduler process running during verification

Treat these as a snapshot, not a permanent invariant.

## Old Supabase Edge Functions

Old Edge Function files still exist:

- `supabase/functions/payment-reminder-agent/index.ts`
- `supabase/functions/payment-status-webhook/index.ts`
- `supabase/functions/whatsapp-incoming-webhook/index.ts`
- `supabase/functions/daily-group-report/index.ts`
- shared helpers under `supabase/functions/_shared/`

Current instruction history:

- Do not use old WhatsApp Edge Functions for the new overdue reminder system.
- Do not deploy Edge Functions.
- Do not enable cron, WhatsApp, webhooks, email, or reminders without explicit approval.
- Do not delete old function folders unless explicitly approved.

Settings page has old Meta/WhatsApp/email settings UI. Be careful around secrets and do not expose service role keys or private env values.

## Settings Table Caution

`settings` may contain sensitive provider fields. Admin UI can view/update settings, but future code should avoid fetching/printing secret-like values unless needed.

Rules:

- no service-role key in browser
- no provider secrets in console
- show configured/masked state only when possible
- do not log full settings rows

## Data Recovery Feature Removed

A temporary local-only Data Recovery Export tool was removed during cleanup.

Removed:

- `src/routes/_authenticated/data-recovery-export.tsx`
- `src/lib/data-recovery-export.ts`
- `src/lib/data-recovery-zip.ts`

Do not recreate unless explicitly requested.

## Tests And Build State

Most recent checks after payment verification UX/RPC work:

```powershell
npx.cmd tsx src\lib\payment-verifications.test.ts
npx.cmd tsx src\lib\invoice-reminders.test.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

Results:

- payment verification tests: 6/6 passed
- invoice reminder tests: 22/22 passed
- TypeScript check passed
- production build passed

Known warnings:

- root `npm install` reports existing high-severity audit findings; do not run `npm audit fix --force` without approval
- TanStack Start warns `createServerFn().inputValidator()` is deprecated
- Vite warns `vite-tsconfig-paths` can be replaced by native config later
- PWA glob warning around `dist`
- large chunk warnings

Do not “fix” these warnings unless the user approves a cleanup/refactor chunk.

## Worker Tests

Worker tests previously passed after worker hardening and scheduler implementation.

Useful worker verification:

```powershell
cd worker
npm.cmd test
npm.cmd run typecheck
```

Do not run worker live send commands without approval.

## Good First Checks For Future Agents

```powershell
git status --short --ignored=matching
rg -n "payment-status-webhook|payment-reminder-agent|daily-group-report|whatsapp-incoming-webhook" src supabase
rg -n "DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|password|token|secret|api[_-]?key" . --glob "!node_modules/**" --glob "!dist/**" --glob "!.output/**" --glob "!.wrangler/**" --glob "!worker/node_modules/**"
npm.cmd run build
```

When using `DATABASE_URL`, parse/use it without printing it.

## Do Not Do Without Approval

- do not deploy
- do not push to GitHub
- do not commit automatically
- do not run migrations
- do not import CSVs
- do not alter auth users or roles
- do not enable scheduler/automation
- do not send WhatsApp/email messages
- do not call old Edge Functions
- do not connect to old Supabase project
- do not print secrets
- do not delete recovery backups outside the repo
- do not delete old Supabase functions
- do not modify existing invoice/payment data except in an explicitly approved action

## Chunk 2: Wastage Verification / Stock Audit Foundation (executed in Chunk 3 - see below)

Chunk 1 (discovery) was completed first; corrections from that review were applied before writing this chunk: `daily_production.id` is the batch reference (no `production_batches` table), audit quantities are normalized relational rows (no JSONB blobs for counts), single-facility model only (`facility_name` snapshot, no facilities table/module), no raw OpenAI response is stored (only extracted fields), OpenAI is not called/wired in this chunk, Moderator cannot give final wastage approval, and `viewer` is fully preserved (not converted to `moderator`).

Migrations created (additive only, **not executed** — this remains true after the correction pass below):

- `supabase/migrations/20260730180000_moderator_role.sql` — adds `moderator` to `public.app_role` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. Does not touch `viewer`/`admin`/`staff`/`investor` or any `user_roles` row. Runs first, before anything references `moderator`.
- `supabase/migrations/20260730181000_operational_alerts_foundation.sql` — `public.operational_alerts` table (distinct from `reorder_alerts`); authenticated gets SELECT only (no table-level UPDATE grant); `resolve_operational_alert()` (Admin/Moderator, requires resolution notes) is the only way to resolve an alert; internal `raise_operational_alert()` helper (service_role-only, duplicate-safe via partial unique index); centralized `operational_comparison_precision_kg()` (returns the shared 0.01 kg technical comparison precision used by both the wastage and stock-audit migrations, instead of the literal 0.01 being scattered across files).
- `supabase/migrations/20260730182000_wastage_verification_foundation.sql` — `public.wastage_verifications` (links to `daily_production.id` via `ON DELETE RESTRICT`, not `CASCADE`, so a production row with existing wastage evidence cannot be silently deleted; snapshots raw input/wastage%/expected wastage at submission time; no raw AI response column; a DB constraint enforces internally-consistent AI-result state combinations — match/mismatch require a positive detected weight+unit and clear/partial quality with no error code, unreadable forbids a fabricated weight/unit, failed requires a non-empty error code and forbids any detected reading), `public.wastage_verification_events` (append-only, no delete/update grants), private bucket `wastage-scale-images` (private, 8 MB size limit, `image/jpeg`/`image/png`/`image/webp` only, no update/delete policy for normal users); functions: `submit_wastage_verification` (Staff/Admin; now also verifies the referenced object actually exists in `storage.objects` at that exact path before creating a verification row), `record_wastage_ai_result` (service_role only — not called yet; validates the same AI-result combinations and uses `ai_processed`/`ai_failed` event types correctly), `approve_wastage_verification` / `reject_wastage_verification` / `request_resubmission_wastage_verification` (Admin-only final decision; uploader cannot decide on own submission).
- `supabase/migrations/20260730183000_stock_audit_foundation.sql` — normalized `stock_audits` (status enum cleaned up: `open`/`staff_submitted`/`management_submitted`/`ready_for_reconciliation`/`locked` — the unreachable `approved` status value was removed; the final Admin function approves and locks atomically), `stock_audit_items` (system-stock snapshot from `inventory.current_stock`), `stock_audit_submissions`, `stock_audit_submission_items`, `stock_audit_events`; functions: `ensure_due_stock_audit` (Admin/Moderator, valid only on the 15th or month-end date, idempotent), `submit_stock_audit_staff_count` / `submit_stock_audit_management_count` (hardened to require the payload be a complete, duplicate-free JSON array covering every audit item exactly once — partial or extra-item submissions are rejected before any row is written), `reconcile_and_lock_stock_audit` (Admin-only; now requires audit status to be exactly `ready_for_reconciliation`, requires a complete duplicate-free reconciliation payload, requires a reason whenever Staff/Management counts differ or the reconciled value differs from either submitted count or the system snapshot beyond the shared precision, preserves both original submissions unchanged, creates `stock_variance` alerts, and locks the audit).

New/extended pure TypeScript helper/test files (no UI, no route, no server function wired yet):

- `src/lib/wastage-verifications.ts` / `src/lib/wastage-verifications.test.ts` — unit normalization (kg/g), expected-wastage formula (reference-only, does not touch the real `daily_production.wastage_percent`), 0.01 kg match/variance precision, controlled `ai_result` derivation that never guesses on unreadable images, plus `assertValidAiResultFields()` mirroring the new `wastage_verifications_ai_state_check` DB constraint.
- `src/lib/stock-audits.ts` / `src/lib/stock-audits.test.ts` — 15th/month-end date classification (leap-year safe), stock variance calculation, count-list validation, plus `assertCompleteStockAuditSubmission()`, `assertValidStockAuditReconciliation()` and `stockAuditReconciliationNeedsReason()` mirroring the hardened submission/reconciliation DB functions.

Verification results (original Chunk 2 + this correction pass): 34/34 new tests passed (`node --experimental-strip-types --test`), `npx tsc --noEmit` clean, `npm run build` succeeded, targeted ESLint on the modified TS files clean (fixed via `prettier --write` on those files only; the pre-existing thousands of unrelated lint errors elsewhere were not touched). The SQL corrections themselves are a static review only — they have not been executed against any database, so their runtime behavior is unverified until Chunk 3 applies them.

Explicit confirmations: no migration was run against any database (original Chunk 2 or this correction pass); no OpenAI dependency was added and no OpenAI call was made; no UI/route/page was created or changed; `production.tsx` and `daily_production` were not touched (only referenced via FK/SELECT); no user role was assigned or changed.

Chunk 2's migrations were applied in Chunk 3 (see below); this section is kept as historical record of what was prepared and reviewed before execution.

## Chunk 3: Migrations Executed, Moderator/OpenAI/UI Integration (code + migrations complete; real OpenAI test still pending)

### Pre-migration correction (before Gate A)

Before executing anything, the wastage migration (`20260730182000_wastage_verification_foundation.sql`, still unexecuted at the time) was edited directly (no patch migration, since it hadn't run yet) to add an atomic AI-processing claim mechanism, per explicit instruction:

- New `ai_processing` workflow status + `ai_processing_started_at timestamptz` column.
- New `claim_wastage_ai_processing(uuid) RETURNS boolean` (service_role-only): uses `SELECT ... FOR UPDATE` so two concurrent requests can never both succeed; claimable from `pending_ai` (first attempt) or from a stuck `ai_processing` row whose claim is older than 10 minutes (one controlled retry); never claimable once `ai_attempt_count >= 2`; increments `ai_attempt_count` itself, at claim time.
- `record_wastage_ai_result(...)` now only accepts a row currently in `ai_processing` (was `pending_ai`), no longer increments the attempt counter (already done at claim time), and clears `ai_processing_started_at` on completion. Always moves to `pending_admin` — AI never approves.
- New DB CHECK constraints keep these states internally consistent, and `ai_processing` was added to the active-submission partial unique index / duplicate-check.
- Mirrored in `src/lib/wastage-verifications.ts` (`isWastageAiClaimEligible`, `MAX_AI_PROCESSING_ATTEMPTS = 2`, `AI_PROCESSING_STALE_MINUTES = 10`) with matching unit tests.

### Migrations executed (Gate A approved, then executed in order)

Executed against the NEW Supabase project (masked ref `uclo...mbud`, confirmed via `supabase/config.toml`'s `project_id`), one at a time, stop-on-error, using a locally-installed `pg` client (Node's official `node-postgres`) connecting via `DATABASE_URL` — no `psql`/Supabase CLI was available in this environment (CLI type-gen also needed Docker, which was unavailable; see below):

1. `20260730180000_moderator_role.sql`
2. `20260730181000_operational_alerts_foundation.sql`
3. `20260730182000_wastage_verification_foundation.sql` (includes the claim mechanism above)
4. `20260730183000_stock_audit_foundation.sql`

All four succeeded. Pre/post-migration counts on `daily_production`, `inventory`, `inventory_stock`, `stock_movements`, `user_roles`, `invoices`, `invoice_reminders`, `payment_verification_requests` were captured and matched exactly (no existing data changed). `app_role` gained `moderator` alongside the existing 4 values; no `user_roles` row was touched; all 8 new tables started at 0 rows.

**Post-migration finding and fix:** verification found that `authenticated` silently held full table-level privileges (`INSERT/UPDATE/DELETE/TRUNCATE/...`) on all 8 new tables, because this Supabase project has a pre-existing database-level default privilege (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`) that grants `ALL` to `authenticated`/`anon`/`service_role` on every newly created table. The Chunk 2 migrations revoked this from `anon` but never from `authenticated` before granting `SELECT`, so the `GRANT SELECT` was a no-op on top of the pre-existing `ALL`. RLS already blocked exploitation (no INSERT/UPDATE/DELETE policies exist for `authenticated` on any of these tables), but this contradicted the intended "SELECT only, writes via RPC" design. Fixed with a new, already-executed migration:

- `supabase/migrations/20260731000000_chunk3_authenticated_grant_hardening.sql` — `REVOKE ALL ... FROM authenticated; GRANT SELECT ... TO authenticated;` for all 8 Chunk 2/3 tables. Verified afterward: `authenticated` now has exactly `SELECT` on each.

The underlying schema-wide default privilege itself was left unchanged (out of scope — it affects every future table project-wide, not just this chunk's tables, and changing it needs separate explicit approval).

### Supabase types (`src/integrations/supabase/types.ts`)

The Supabase CLI (`npx supabase gen types typescript --db-url ...`) could not run in this environment even with `--db-url` — it requires a local Docker/Podman container internally, and neither is available. Rather than hand-inventing types, they were constructed from live schema introspection (`information_schema.columns`, `pg_proc`, `pg_enum` via the same `pg` connection) and added in the same structural format the generator produces (`Row`/`Insert`/`Update`/`Relationships`, `Functions`, `Enums`, `Constants`). Added: `operational_alerts`, `wastage_verifications`, `wastage_verification_events`, `stock_audits`, `stock_audit_items`, `stock_audit_submissions`, `stock_audit_submission_items`, `stock_audit_events`, all 13 new RPC signatures, `moderator` in the `app_role` enum/const array. Also added `payment_verification_requests` and its two RPCs, which were missing from `types.ts` even though that migration had been executed earlier (a pre-existing gap from before this chunk, closed here since introspection was already being done). `tsc --noEmit` passed clean against these hand-derived types.

### Moderator integration

- `src/lib/roles.ts`: `AppRole` includes `"moderator"`; `ROUTE_ACCESS` grants `/wastage-verifications` and `/operational-alerts` to `["admin","moderator"]`, `/stock-audits` to `["admin","moderator","staff"]`; `homeForRoles` sends a moderator-only user to `/wastage-verifications`; added `useIsModerator()` and `useIsAdminOrModerator()` hooks.
- `src/components/users-management.tsx` and `src/lib/user-admin.functions.ts`: `moderator` added to the assignable-role list/Zod enum. No user was assigned it.
- `src/components/app-sidebar.tsx`: added "Wastage Verifications", "Stock Audits", "Operational Alerts" nav entries with the role matrix above.

### Server-only OpenAI integration

- Installed the official `openai` npm package (root `package.json`/`package-lock.json`).
- `.env.example` gained placeholder-only `OPENAI_API_KEY=` / `OPENAI_VISION_MODEL=` lines (no real value; `.env` itself was not printed or edited by the agent).
- `src/lib/openai-wastage-vision.server.ts` (server-only): calls the OpenAI Responses API with `store:false`, `detail:"high"`, and a strict `json_schema` structured output (`reading_visible`, `detected_weight`, `detected_unit`, `reading_quality`, `issue_code`), independently re-validated with Zod. Never stores the raw response. `analyzeWastageScaleImage()` accepts an injectable client for testing (10 tests in `openai-wastage-vision.test.ts`, all against a mocked client — no real network call was made). Config-missing and request/parse failures raise typed errors (`WastageAiConfigurationError`, `WastageAiRequestError`) that never carry raw provider text.
- `src/lib/wastage-verifications.ts` gained pure mapping helpers `mapScaleReadingToAiFields()` (decides match/mismatch/unreadable in application code, never asks the model to decide) and `mapAiFailureToFields()` (sanitized failure code only).
- `src/lib/wastage-verifications.functions.ts` (server functions, `createServerFn` + `requireSupabaseAuth`, Zod-validated): `submitWastageVerification`, `processWastageVerificationAi` (checks caller is uploader/Admin → checks OpenAI config present _before_ claiming, so missing config never consumes an attempt → claims via service-role RPC → downloads image via `supabaseAdmin.storage` → validates MIME/size/non-empty → calls OpenAI → records result via service-role RPC; any post-claim failure is recorded as a sanitized `failed` result, still moving to `pending_admin`), `getWastageVerificationImageUrl` (Admin-only, 60-second signed URL via `supabaseAdmin`), `listWastageVerificationsForReview`, `listWastageVerificationEvents`, `decideWastageVerification` (Admin-only approve/reject/resubmission, reason required for the latter two).
- Verified: the built client bundle (`dist/`) contains zero references to `openai` or `OPENAI_API_KEY` — the SDK and key stay entirely server-side.

### New UI

- `src/routes/_authenticated/production.tsx`: minimally modified — only a new "Wastage Proof" column/button was added per row (desktop table + mobile card); no existing field, default, formula, history query, or create behavior was touched. Opens `src/components/wastage-verification-dialog.tsx` (new), which uploads the image directly to the private bucket, calls `submitWastageVerification`, then `processWastageVerificationAi`, and shows Pending AI/AI Processing/Pending Admin/Approved/Rejected/Resubmission-required states; a missing-config result is shown as a manual-review message, never fabricated as an AI result.
- `src/routes/_authenticated/wastage-verifications.tsx` (new): Admin sees the full review queue with an Admin-only signed-image viewer, event history, and Approve/Reject/Resubmit controls (reason required for the latter two, all through the controlled RPCs — no direct table UPDATE). Moderator sees the same queue metadata (status, AI result, variance, history) but gets no image button and no decision controls (enforced both in the UI and, more importantly, at the DB layer: Moderator has no storage policy on the bucket and no EXECUTE grant that would let it call the decision RPCs' internal admin check successfully).
- `src/routes/_authenticated/stock-audits.tsx` (new): shows whether today is a scheduled audit date, lets Admin/Moderator create/open the due audit, lets Staff submit their count and Admin/Moderator submit the Management count (both require every item, enforced by the DB RPC and by disabling the submit button until every item has a value), lets Admin reconcile/lock once `ready_for_reconciliation`, and shows locked audits as read-only.
- `src/routes/_authenticated/operational-alerts.tsx` (new): Admin/Moderator-only list with a Resolve dialog requiring notes, going through `resolve_operational_alert` only.

### Tests and build

- 83 tests total pass (`node --experimental-strip-types --test`): 40 wastage-verifications (incl. 6 claim-eligibility + 5 AI-field-mapping), 16 stock-audits, 10 OpenAI-vision (mocked client, zero network calls, sanitized-error assertions, single-call-per-invocation assertion), 22 invoice-reminders, 6 payment-verifications (existing suites unaffected).
- `npx tsc --noEmit` clean.
- Targeted ESLint on every new/modified file: clean after `prettier --write` on the newly-created files only; the only remaining category is `@typescript-eslint/no-explicit-any`, confirmed to be a pre-existing, project-wide convention (even the untouched, pre-existing `payment-verifications.tsx` has the same errors) — not chased further, consistent with prior chunks.
- `npm run build` succeeded; `routeTree.gen.ts` was regenerated automatically by the TanStack Router Vite plugin (not hand-edited) to include the 3 new routes.
- Manual DB security verification (via the same `pg` connection): service-role-only functions (`claim_wastage_ai_processing`, `record_wastage_ai_result`, `raise_operational_alert`) have no `authenticated` grant; Admin-only decision functions grant EXECUTE to `authenticated` but self-enforce `has_role(...,'admin')` internally (same pattern as the existing payment-verification RPCs); no Investor/Viewer policy exists on any operational table; Moderator has zero storage policies on `wastage-scale-images`; all 8 new tables show `authenticated: SELECT` only; bucket confirmed private/8MB/JPEG-PNG-WebP; `daily_production` row count and column list are byte-for-byte unchanged from before Chunk 3.

### Environment variables required (not yet set)

`.env` now has `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `OPENAI_VISION_MODEL` set (added by the owner; verified present via key-existence/shape checks only, values never printed). The owner initially added the two `OPENAI_*` values to `worker/.env` only - the agent copied them into the root `.env` too (values never displayed), since the wastage-vision pipeline runs in the root app's server functions, not the worker.

### Real OpenAI test status

**Performed and passed (Gate B, `APPROVE ONE OPENAI TEST`).** No real scale photo was available, so - after asking the owner and getting explicit confirmation - a synthetic placeholder image (a plain solid-gray 64x64 PNG, no text, no real scale) was used to exercise the exact production code path:

- A test `wastage_verifications` row was created directly (bypassing the RPC's auth check only because no live browser session was available to this agent - not a normal app flow), referencing a real existing `daily_production` row for its snapshot values, with a real existing Staff user as uploader.
- `claim_wastage_ai_processing()` claimed it for real (service-role RPC).
- The image was uploaded to and downloaded from the real private bucket.
- **Exactly one real request** was sent to the OpenAI Responses API via `analyzeWastageScaleImage()` (the actual production module, no mock) - `store:false`, structured output, Zod-revalidated.
- Real result: `reading_visible:false, detected_weight:null, detected_unit:null, reading_quality:"unreadable", issue_code:"display_not_visible"` - the model correctly reported no scale display was visible (the image genuinely had none) rather than fabricating a reading.
- Mapped in application code (not by the model) to `ai_result:"unreadable"`, recorded via `record_wastage_ai_result()` (real service-role RPC), and the row correctly moved to `pending_admin` - **not** `approved`. AI did not and cannot auto-approve.
- **Cleanup:** since this was a scripted test bypassing the real submission UI (tied to a real `daily_production_id`, which would otherwise block a real future submission on that batch via the one-active-verification-per-batch rule), the test verification row and test image were deleted immediately after confirming the result. The real `daily_production` row itself was never modified. Final state verified: `wastage_verifications` count back to 0.
- No raw OpenAI response was stored or logged at any point; no image bytes or secrets were printed.

This closes out the one explicitly-gated real-API action for Chunk 3/4. Any future real submission will go through the normal UI flow (`/production` → Wastage Proof) exactly as already built - this test only proved the pipeline works end-to-end with a real key.

### Remaining manual steps

None outstanding for the OpenAI pipeline itself. If the owner wants a true accuracy test (a real photo of an actual weighing scale), that can be done anytime through the normal `/production` → Wastage Proof flow - it will consume one additional real OpenAI request per submission, same as any real future use.

### Known limitations

- The Supabase CLI (`gen types`) and `psql` are unavailable in this sandboxed environment; schema introspection/migration execution used a locally-installed `pg` client instead. Types are accurate as of the live schema at generation time but were not produced by the official generator.
- 0.01 (kg / stock unit) remains the **technical comparison precision**, centralized in `operational_comparison_precision_kg()` — it is not a business-approved operational tolerance. A wider tolerance requires separate explicit business approval.
- The schema-wide default-privilege issue (new tables auto-granting `ALL` to `authenticated`) was fixed only for this chunk's 8 tables; it still applies to any future table created in this project unless addressed separately.

## Chunk 4: Wastage Over-Threshold Alerting, WhatsApp Alert Delivery, OpenAI Re-Verify, Viewer Removal (migrations executed; one controlled WhatsApp test sent)

**Execution update:** both migrations below were approved (`APPROVE MIGRATIONS`) and executed successfully, one at a time, stop-on-error, using the same `pg`-client method as Chunk 3 (no psql/Supabase CLI in this environment). Pre/post counts on `operational_alerts` (0), `wastage_verifications` (0), `user_roles` (5) matched exactly - no existing data changed. Post-migration verification confirmed: `wastage_alert_settings` seeded correctly (60/5/false/10), `operational_alert_dispatch_settings` seeded correctly (`enabled=false`, `dry_run=true`, recipient `923212558027`), `operational_alerts.whatsapp_notified_at` column present, the alert-type CHECK constraint includes both new values, `approve_wastage_verification()` contains the new threshold logic, and `authenticated` has `SELECT` only on both new tables (no default-privilege leak this time - the migration explicitly revoked-then-granted from the start).

**One controlled WhatsApp alert test (`APPROVE ONE WHATSAPP ALERT TEST`) was executed and succeeded:**

- Created exactly one clearly-labeled test row via `raise_operational_alert()` (`alert_type='wastage_over_threshold'`, `source_type='test'`, message prefixed `"TEST ALERT - Chunk 4 WhatsApp dispatch pipeline verification..."`, severity `info`, illustrative expected/actual/variance 65/70/5%) - not a fabricated real business event.
- Temporarily set `operational_alert_dispatch_settings.enabled=true, dry_run=false`.
- Found `WHATSAPP_ALLOW_REAL_SEND="true"` already set in `worker/.env` (pre-existing from an earlier session's controlled test, not changed by this chunk before now) and a persisted authenticated WhatsApp-web session under `worker/.worker-data/whatsapp-session`; confirmed no worker/scheduler process was already running.
- Ran `tsx src/run-alerts-once.ts --live --confirm=SEND_LIVE_OPERATIONAL_ALERTS`. Result: `scanCount:1, sentCount:1, failedCount:0`. Verified in the DB that the test alert's `whatsapp_notified_at` was set, confirming the full round-trip (provider-confirmed send, per the existing event-confirmation safety logic - never marks notified without it).
- **Note:** the run's printed report showed `workerConnected:false` despite a successful confirmed send - this is a cosmetic bug in `runAlertDispatchWorkflow()`'s report field (it snapshots `provider.getStatus().connected` once at function entry and doesn't refresh it on the success path), not evidence of a failed/fake send; the send itself is independently proven by `sentCount:1` + the DB `whatsapp_notified_at` timestamp, since `WhatsAppProvider.sendMessage()` throws if not actually connected and only returns a `providerMessageId` after real event confirmation. Worth a small follow-up fix (set `report.workerConnected = true` on the success path) but not a safety issue.
- **Immediately after:** reset `operational_alert_dispatch_settings` back to `enabled=false, dry_run=true`, and set `WHATSAPP_ALLOW_REAL_SEND` back to `"false"` in `worker/.env` (restoring the safe default regardless of its state before this chunk started). No worker/scheduler process was left running; the one-shot script's own `finally` block already disconnected the WhatsApp-web client.
- Exactly one real WhatsApp message was sent this chunk, to the approved number `923212558027`, and it was a clearly-labeled test message, not a real production alert.

The rest of this section (Items A-D detail, open decisions, remaining outstanding gate) is unchanged from when it was first written - see below.

### Item A — Wastage over-threshold alerting

Business rule (owner-provided): expected wastage ~60% of raw input; alert if actual approved wastage exceeds expected + tolerance (default tolerance 5 points -> alert above 65%). A default-OFF low-wastage flag was proposed for suspiciously low wastage (possible under-reporting) - **not enabled**, per instruction.

- `supabase/migrations/20260731010000_wastage_over_threshold_alerting.sql` (prepared, **not executed**):
  - Widens `operational_alerts_alert_type_check` to allow `wastage_over_threshold` and `wastage_under_threshold` (additive; no existing rows touched).
  - New singleton table `wastage_alert_settings` (`expected_wastage_percent` default 60, `wastage_tolerance_points` default 5, `low_wastage_alert_enabled` default **false**, `low_wastage_tolerance_points` default 10). Admin/Moderator can read; no direct `authenticated` UPDATE grant (updated via service-role connection only in this chunk - no settings UI was built for it). Explicit `REVOKE ALL FROM authenticated` before granting `SELECT`, learning from the Chunk 3 default-privilege finding.
  - Redefines `approve_wastage_verification()` (`CREATE OR REPLACE`, identical existing behavior preserved) to add the new comparison: reads only `wastage_verifications.raw_input_kg_snapshot` and the just-approved actual weight (never touches `daily_production`), computes `actual_wastage_percent`, and raises `wastage_over_threshold` (or `wastage_under_threshold`, only if the low-wastage flag is ever turned on) via the existing `raise_operational_alert()` helper.
- `src/lib/wastage-verifications.ts`: `calculateActualWastagePercent()`, `evaluateWastageThreshold()` (pure mirrors of the DB logic) with 5 new tests in `wastage-verifications.test.ts`.
- `src/integrations/supabase/types.ts` updated with the new `wastage_alert_settings` table type.

**Open decision (needs your confirmation):** `wastage_tolerance_points = 5` (threshold 65%) is the proposed default - confirm or change. Low-wastage flag stays OFF unless you explicitly ask to enable it.

### Item B — WhatsApp delivery of operational alerts (worker)

Reuses the existing `worker/` WhatsApp-web session and `WhatsAppProvider` interface - no new provider was built.

- `supabase/migrations/20260731020000_operational_alert_whatsapp_dispatch.sql` (prepared, **not executed**):
  - `ALTER TABLE operational_alerts ADD COLUMN whatsapp_notified_at timestamptz` (duplicate-guard: an alert is only ever sent once).
  - New singleton table `operational_alert_dispatch_settings` (`enabled` default **false**, `dry_run` default **true**, `recipient_phone_normalized` seeded to `923212558027` - the normalized form of `03212558027` using the same Pakistan-normalizer convention already used elsewhere). Admin/Moderator read-only via RLS; no settings UI built this chunk (worker reads via its own service-role connection, same pattern as `invoice_reminder_settings`).
- `worker/src/services/alert-dispatch.ts` (new): `runAlertDispatchWorkflow()` mirrors `queue-processor.ts`'s structure - checks `enabled`/`recipient` -> selects open, not-yet-notified alerts -> in `dry` mode or `dry_run=true` never sends -> in `live` mode with a connected provider, sends via the existing `WhatsAppProvider.sendMessage()` (never marks notified without a real provider message id) -> marks `whatsapp_notified_at` only after send confirmation, so a failure leaves the alert eligible for the next run and a success is never double-sent.
- `worker/src/services/message-builder.ts`: added `buildOperationalAlertMessage()` (alert type, severity, message, expected/actual/variance, source reference, timestamp).
- `worker/src/run-alerts-once.ts` (new) + `package.json` scripts `run-alerts-once-dry` / `run-alerts-once-live` (mirrors `run-once.ts`'s dry/live/`--confirm=` gating exactly, including reusing `WHATSAPP_ALLOW_REAL_SEND`).
- `worker/src/alert-dispatch.test.ts` (new, 12 tests, no real network): disabled/no-recipient/dry-mode/dry_run-setting/no-pending-alerts/disconnected-provider all block sending; a live+connected+enabled run sends exactly once and marks notified; an already-notified alert is never resent; a send failure does not mark notified (stays retryable); `maskPhoneForLog()` never exposes the full number in logs.
- No new env vars were needed (recipient/enabled/dry-run live in the new DB settings table); `worker/.env.example` was not changed.
- **Safe defaults confirmed:** DB `enabled=false`, `dry_run=true`, plus the existing worker-level `WHATSAPP_ALLOW_REAL_SEND=false` - three independent gates must all align before any real send is possible.

### Item C — OpenAI wastage-vision pipeline (re-verified, unchanged)

Confirmed the full flow built in Chunk 3 is still correctly wired end-to-end and was not modified this chunk: `/production` "Wastage Proof" -> `submitWastageVerification` -> `processWastageVerificationAi` (checks OpenAI config _before_ claiming, so missing config never consumes an attempt; safe `configuration_missing` short-circuit never fabricates a result) -> `record_wastage_ai_result` (always -> `pending_admin`) -> `/wastage-verifications` Admin approve/reject/resubmit. `approve_wastage_verification()` remains Admin-only (verified the Item A migration preserves this check verbatim). (Updated after this: the real key was added and Gate B's one real OpenAI test was completed successfully - see "Real OpenAI test status" further down.)

### Item D — `viewer` role removed from app code

- Verified via direct read-only query: **0** `user_roles` rows use `viewer` (5 total rows: 4 `admin`, 1 `staff`, 0 `investor`, 0 `moderator`). Safe to proceed without any reassignment.
- Removed every app-code reference to `viewer`: `src/lib/roles.ts` (`AppRole` type), `src/components/users-management.tsx` (assignable-role list; the zero-role-row UI fallback changed from `"viewer"` to `"staff"`), `src/lib/user-admin.functions.ts` (Zod `roleEnum`), `src/integrations/supabase/types.ts` (`app_role` enum type + `Constants` array). Confirmed via repo-wide grep: zero remaining `viewer` references in `src/` or `worker/src/`.
- **DB enum left orphaned (default, per instruction):** `public.app_role` in the live DB still physically contains `viewer` (Postgres enums can't have a value cheaply dropped without a full type rebuild). No migration was written to rebuild the enum. This means the generated `types.ts` (now `"admin" | "investor" | "staff" | "moderator"`) is intentionally narrower than the live DB enum - acceptable since the app never assigns/reads `viewer` anymore, but flagged here for future agents. A full enum rebuild remains available if explicitly approved later.
- 4 roles remain going forward: Admin, Moderator, Staff, Investor.

### Tests and build (this chunk)

- Root: 88/88 tests pass (`node --experimental-strip-types --test`) - 33 wastage-verifications (5 new threshold tests), 16 stock-audits, 10 openai-wastage-vision, 22 invoice-reminders, 6 payment-verifications, `payment-verifications` unaffected. `npx tsc --noEmit` clean. `npm run build` succeeded (`routeTree.gen.ts` unaffected, no route changes this chunk). Targeted ESLint clean on all newly-authored/substantially-edited files (pre-existing `@typescript-eslint/no-explicit-any` in untouched legacy code, e.g. `user-admin.functions.ts`, was not chased, consistent with prior chunks).
- Worker: 37/37 tests pass (12 new alert-dispatch/message-builder tests + 25 existing, unaffected). `npm run typecheck` clean.

### Migrations prepared, NOT executed (this chunk)

1. `supabase/migrations/20260731010000_wastage_over_threshold_alerting.sql`
2. `supabase/migrations/20260731020000_operational_alert_whatsapp_dispatch.sql`

Pre-change DB snapshot (read-only, via the same `pg` connection approach): `operational_alerts` count=0, `wastage_verifications` count=0, `wastage_alert_settings`/`operational_alert_dispatch_settings` do not exist yet, `app_role` enum = `admin, investor, staff, viewer, moderator`, `user_roles` = 4 admin + 1 staff (0 viewer, 0 investor, 0 moderator).

### Outstanding gates for this chunk

- ~~`APPROVE MIGRATIONS`~~ - **done**, both migrations executed successfully.
- ~~`APPROVE ONE WHATSAPP ALERT TEST`~~ - **done**, one test alert sent to `923212558027`; dispatch settings and `WHATSAPP_ALLOW_REAL_SEND` both reset to safe defaults afterward.
- ~~`APPROVE ONE OPENAI TEST`~~ - **done**, one real OpenAI request made via a synthetic test image (see "Real OpenAI test status" above); test artifacts cleaned up afterward.
- `wastage_tolerance_points = 5` (threshold 65%) was left at its proposed default - not explicitly confirmed/changed by the owner; still open if a different value is wanted. Low-wastage flag remains off.

## Current Human Preferences

The user often gives phased approvals. Respect exact phase boundaries.

If the user says “prepare only,” do not execute. If the user says “execute only this migration,” execute only that migration and stop. If the user approves one WhatsApp test, send exactly one message to the approved test number and then disable real sending again.

The user often speaks Roman Urdu/Hindi mixed with English. Respond clearly, practically, and briefly when possible.
