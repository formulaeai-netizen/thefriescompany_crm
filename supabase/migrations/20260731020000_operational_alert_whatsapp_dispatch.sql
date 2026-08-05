-- Chunk 4, item B: WhatsApp delivery of operational alerts via the
-- existing worker (worker/, whatsapp-web.js). No new provider is added
-- here - this migration only adds the DB-side pieces the worker needs:
-- a duplicate-guard column on operational_alerts, and a small settings
-- singleton (enabled/dry_run/recipient number), separate from the
-- wastage business-rule settings added in the previous migration and
-- separate from invoice_reminder_settings (per instruction, this must
-- not be mixed into the invoice-reminder queue/table).

ALTER TABLE public.operational_alerts
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_operational_alerts_whatsapp_undelivered
  ON public.operational_alerts (created_at)
  WHERE status = 'open' AND whatsapp_notified_at IS NULL;

-- ---------------------------------------------------------------------
-- Dispatch settings (singleton). Safe defaults: disabled, dry-run.
-- recipient_phone_normalized is seeded to the owner's number
-- (03212558027 -> 923212558027 via the existing Pakistan normalizer
-- convention already used elsewhere in this repo/worker) but remains
-- editable without a code change.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.operational_alert_dispatch_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  dry_run boolean NOT NULL DEFAULT true,
  recipient_phone_normalized text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_alert_dispatch_settings_phone_check CHECK (
    recipient_phone_normalized IS NULL OR recipient_phone_normalized ~ '^923\d{9}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS operational_alert_dispatch_settings_singleton
  ON public.operational_alert_dispatch_settings ((true));

INSERT INTO public.operational_alert_dispatch_settings (id, enabled, dry_run, recipient_phone_normalized)
VALUES ('00000000-0000-4000-8000-000000000003', false, true, '923212558027')
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS operational_alert_dispatch_settings_touch_updated_at ON public.operational_alert_dispatch_settings;
CREATE TRIGGER operational_alert_dispatch_settings_touch_updated_at
  BEFORE UPDATE ON public.operational_alert_dispatch_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.operational_alert_dispatch_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.operational_alert_dispatch_settings FROM anon, authenticated;
GRANT SELECT ON public.operational_alert_dispatch_settings TO authenticated;
GRANT ALL ON public.operational_alert_dispatch_settings TO service_role;

DROP POLICY IF EXISTS "Admin and moderator read operational_alert_dispatch_settings" ON public.operational_alert_dispatch_settings;
CREATE POLICY "Admin and moderator read operational_alert_dispatch_settings"
  ON public.operational_alert_dispatch_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- No direct UPDATE policy/grant to authenticated in this chunk (no
-- settings UI was requested for this table); the worker's service-role
-- connection reads/updates it directly, same as invoice_reminder_settings
-- is read by SupabaseReminderRepository.
