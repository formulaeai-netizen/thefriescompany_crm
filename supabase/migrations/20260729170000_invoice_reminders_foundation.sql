ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone_normalized text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_invoice_due_date_from_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS NULL AND NEW.delivery_date IS NOT NULL THEN
    NEW.due_date := NEW.delivery_date + 15;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_invoice_due_date ON public.invoices;
CREATE TRIGGER set_invoice_due_date
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_due_date_from_delivery();

CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  due_date_snapshot date,
  outstanding_amount_snapshot numeric NOT NULL DEFAULT 0,
  recipient_phone text,
  normalized_recipient_phone text,
  provider text NOT NULL DEFAULT 'whatsapp-web',
  channel text NOT NULL DEFAULT 'whatsapp',
  reminder_stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  provider_message_id text,
  error_code text,
  error_message text,
  scheduled_for timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_reminders_status_check CHECK (
    status IN ('pending', 'approved', 'processing', 'sent', 'failed', 'skipped', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice_id ON public.invoice_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_client_id ON public.invoice_reminders(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_status ON public.invoice_reminders(status);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_scheduled_for ON public.invoice_reminders(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_normalized_recipient_phone
  ON public.invoice_reminders(normalized_recipient_phone);

DROP TRIGGER IF EXISTS invoice_reminders_touch_updated_at ON public.invoice_reminders;
CREATE TRIGGER invoice_reminders_touch_updated_at
  BEFORE UPDATE ON public.invoice_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read invoice_reminders" ON public.invoice_reminders;
DROP POLICY IF EXISTS "Staff can read invoice_reminders" ON public.invoice_reminders;
DROP POLICY IF EXISTS "Admins can insert invoice_reminders" ON public.invoice_reminders;
DROP POLICY IF EXISTS "Admins can update invoice_reminders" ON public.invoice_reminders;
DROP POLICY IF EXISTS "Admins can delete invoice_reminders" ON public.invoice_reminders;

CREATE POLICY "Admins can read invoice_reminders"
  ON public.invoice_reminders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Staff can read invoice_reminders"
  ON public.invoice_reminders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::public.app_role));

CREATE POLICY "Admins can insert invoice_reminders"
  ON public.invoice_reminders
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update invoice_reminders"
  ON public.invoice_reminders
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete invoice_reminders"
  ON public.invoice_reminders
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.invoice_reminders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_reminders TO authenticated;
GRANT ALL ON public.invoice_reminders TO service_role;
