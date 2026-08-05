CREATE TABLE IF NOT EXISTS public.invoice_reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  dry_run boolean NOT NULL DEFAULT true,
  manual_approval_required boolean NOT NULL DEFAULT true,
  pause_all boolean NOT NULL DEFAULT true,
  provider text NOT NULL DEFAULT 'whatsapp-web',
  automation_launch_date date,
  timezone text NOT NULL DEFAULT 'Asia/Karachi',
  first_reminder_after_days integer NOT NULL DEFAULT 1,
  repeat_interval_days integer NOT NULL DEFAULT 3,
  maximum_reminders integer NOT NULL DEFAULT 4,
  maximum_daily_messages integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_reminder_settings_provider_check CHECK (provider IN ('whatsapp-web')),
  CONSTRAINT invoice_reminder_settings_first_after_check CHECK (first_reminder_after_days >= 1),
  CONSTRAINT invoice_reminder_settings_repeat_interval_check CHECK (repeat_interval_days >= 1),
  CONSTRAINT invoice_reminder_settings_maximum_reminders_check CHECK (maximum_reminders >= 0),
  CONSTRAINT invoice_reminder_settings_maximum_daily_messages_check CHECK (maximum_daily_messages >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_reminder_settings_singleton
  ON public.invoice_reminder_settings ((true));

INSERT INTO public.invoice_reminder_settings (
  id,
  enabled,
  dry_run,
  manual_approval_required,
  pause_all,
  provider,
  timezone,
  first_reminder_after_days,
  repeat_interval_days,
  maximum_reminders,
  maximum_daily_messages
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  false,
  true,
  true,
  true,
  'whatsapp-web',
  'Asia/Karachi',
  1,
  3,
  4,
  20
)
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS invoice_reminder_settings_touch_updated_at ON public.invoice_reminder_settings;
CREATE TRIGGER invoice_reminder_settings_touch_updated_at
  BEFORE UPDATE ON public.invoice_reminder_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.invoice_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read invoice_reminder_settings" ON public.invoice_reminder_settings;
DROP POLICY IF EXISTS "Staff can read invoice_reminder_settings" ON public.invoice_reminder_settings;
DROP POLICY IF EXISTS "Admins can update invoice_reminder_settings" ON public.invoice_reminder_settings;

CREATE POLICY "Admins can read invoice_reminder_settings"
  ON public.invoice_reminder_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Staff can read invoice_reminder_settings"
  ON public.invoice_reminder_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::public.app_role));

CREATE POLICY "Admins can update invoice_reminder_settings"
  ON public.invoice_reminder_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.invoice_reminder_settings FROM anon;
GRANT SELECT, UPDATE ON public.invoice_reminder_settings TO authenticated;
GRANT ALL ON public.invoice_reminder_settings TO service_role;
