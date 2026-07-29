# Deploying the autonomous WhatsApp agents

Two edge functions live in `supabase/functions/`:

- `payment-reminder-agent` — day-15 + weekly follow-up reminders
- `daily-group-report` — 8 PM PKT daily group summary

## 1. Set Function Secrets (NEVER in the DB)

```bash
supabase login
supabase link --project-ref xecnxpprbogiokkeojgw

supabase secrets set \
  TWILIO_ACCOUNT_SID=AC_xxx \
  TWILIO_AUTH_TOKEN=xxx \
  TWILIO_WHATSAPP_NUMBER='whatsapp:+14155238886' \
  RESEND_API_KEY=re_xxx \
  RESEND_FROM='The Fries Company <onboarding@resend.dev>'
```

## 2. Deploy

```bash
supabase functions deploy payment-reminder-agent
supabase functions deploy daily-group-report
```

Verify in Supabase Dashboard → Edge Functions: both should be listed and "Active".

## 3. Schedule via pg_cron

In Supabase SQL editor, first store the service-role JWT as a database GUC
(one time):

```sql
alter database postgres set app.service_role_key = 'eyJ...service_role_jwt...';
```

Then run `docs/migrations/pg-cron-agents.sql`.

Verify:

```sql
select jobname, schedule, active from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

## 4. Manual test

Use the "Send Test Reminder Now" / "Send Test Daily Report Now" buttons in
the in-app Settings page. They invoke each function with `{ manual: true }`,
which bypasses the `auto_reminders_enabled` / `daily_report_enabled` toggle.

## Why secrets are not in the `settings` table

Twilio Account SID + Auth Token and the Resend API key are credentials. If
they live in a DB row, anyone with read access to `settings` can exfiltrate
them and send WhatsApp / email on your behalf at your cost. Supabase Function
Secrets are encrypted at rest and only exposed to function runtimes via
`Deno.env`.