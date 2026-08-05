-- Prompt 2, item C + E: configurable WhatsApp routing numbers and
-- inventory-audit alert routing metadata. This migration adds DB
-- structure/metadata only - it does not dispatch or send anything, and
-- does not modify worker/src (that is worker-side wiring, deferred).

-- ---------------------------------------------------------------------
-- Flow-keyed WhatsApp recipient routing. Invoice reminders are excluded
-- on purpose - they remain per-client (client.phone_normalized), not a
-- fixed recipient. The legacy public.settings.whatsapp_report_number
-- (old Meta Cloud API field) is untouched and unrelated to this table.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_routing_numbers (
  flow_key text PRIMARY KEY,
  recipient_phone_normalized text NOT NULL,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_routing_numbers_flow_key_check CHECK (
    flow_key IN ('wastage_alerts', 'stock_audit_alerts', 'credit_purchase_reminders')
  ),
  CONSTRAINT whatsapp_routing_numbers_phone_check CHECK (recipient_phone_normalized ~ '^923\d{9}$')
);

DROP TRIGGER IF EXISTS whatsapp_routing_numbers_touch_updated_at ON public.whatsapp_routing_numbers;
CREATE TRIGGER whatsapp_routing_numbers_touch_updated_at
  BEFORE UPDATE ON public.whatsapp_routing_numbers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed all three flows to the existing operational-alert recipient
-- (923212558027, from operational_alert_dispatch_settings) so behaviour
-- is unchanged until an Admin explicitly edits a flow's number.
INSERT INTO public.whatsapp_routing_numbers (flow_key, recipient_phone_normalized)
SELECT flow_key, COALESCE(
  (SELECT recipient_phone_normalized FROM public.operational_alert_dispatch_settings LIMIT 1),
  '923212558027'
)
FROM (VALUES ('wastage_alerts'), ('stock_audit_alerts'), ('credit_purchase_reminders')) AS flows(flow_key)
ON CONFLICT (flow_key) DO NOTHING;

ALTER TABLE public.whatsapp_routing_numbers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_routing_numbers FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_routing_numbers TO authenticated;
GRANT ALL ON public.whatsapp_routing_numbers TO service_role;

DROP POLICY IF EXISTS "Admin and moderator read whatsapp_routing_numbers" ON public.whatsapp_routing_numbers;
CREATE POLICY "Admin and moderator read whatsapp_routing_numbers"
  ON public.whatsapp_routing_numbers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- Mirrors src/lib/invoice-reminders.ts normalizePakistanWhatsappPhone()
-- exactly: strips non-digits (keeping a leading +), handles +, 00, and a
-- leading 0 (Pakistan trunk prefix) -> 92, then requires ^923\d{9}$.
CREATE OR REPLACE FUNCTION public.normalize_pk_whatsapp_phone(_raw_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF _raw_phone IS NULL OR length(trim(_raw_phone)) = 0 THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(trim(_raw_phone), '[^0-9+]', '', 'g');
  IF length(digits) = 0 THEN
    RETURN NULL;
  END IF;

  IF left(digits, 1) = '+' THEN
    digits := substring(digits from 2);
  END IF;
  IF left(digits, 2) = '00' THEN
    digits := substring(digits from 3);
  END IF;
  IF left(digits, 1) = '0' THEN
    digits := '92' || substring(digits from 2);
  END IF;

  IF digits ~ '^923\d{9}$' THEN
    RETURN digits;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_pk_whatsapp_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_pk_whatsapp_phone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_whatsapp_routing_number(_flow_key text, _recipient_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _flow_key NOT IN ('wastage_alerts', 'stock_audit_alerts', 'credit_purchase_reminders') THEN
    RAISE EXCEPTION 'Unknown WhatsApp routing flow: %', _flow_key;
  END IF;

  normalized := public.normalize_pk_whatsapp_phone(_recipient_phone);
  IF normalized IS NULL THEN
    RAISE EXCEPTION 'Recipient phone number could not be normalized to a valid Pakistan WhatsApp number';
  END IF;

  INSERT INTO public.whatsapp_routing_numbers (flow_key, recipient_phone_normalized, updated_by)
  VALUES (_flow_key, normalized, auth.uid())
  ON CONFLICT (flow_key) DO UPDATE
  SET recipient_phone_normalized = EXCLUDED.recipient_phone_normalized,
      updated_by = auth.uid(),
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_whatsapp_routing_number(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_routing_number(text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- Inventory audit alert routing metadata (item E). Pure mapping helper
-- so future worker dispatch code can join operational_alerts.alert_type
-- to the correct whatsapp_routing_numbers.flow_key. Does not change
-- operational_alert_dispatch_settings, does not dispatch anything, and
-- does not affect the existing whatsapp_notified_at duplicate guard.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operational_alert_routing_flow_key(_alert_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _alert_type IN ('stock_variance', 'audit_missed', 'audit_incomplete') THEN 'stock_audit_alerts'
    ELSE 'wastage_alerts'
  END
$$;

REVOKE ALL ON FUNCTION public.operational_alert_routing_flow_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operational_alert_routing_flow_key(text) TO authenticated, service_role;
