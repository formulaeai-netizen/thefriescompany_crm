CREATE TABLE IF NOT EXISTS public.payment_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  sender_phone text NOT NULL,
  incoming_message text,
  proof_url text,
  storage_path text,
  media_mimetype text,
  media_filename text,
  media_size_bytes integer,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_verification_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'unresolved'))
);

CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_client_id
  ON public.payment_verification_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_invoice_id
  ON public.payment_verification_requests(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_status
  ON public.payment_verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_created_at
  ON public.payment_verification_requests(created_at);

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read payment_verification_requests" ON public.payment_verification_requests;
DROP POLICY IF EXISTS "Staff can read payment_verification_requests" ON public.payment_verification_requests;
DROP POLICY IF EXISTS "Admins can insert payment_verification_requests" ON public.payment_verification_requests;
DROP POLICY IF EXISTS "Admins can update payment_verification_requests" ON public.payment_verification_requests;

CREATE POLICY "Admins can read payment_verification_requests"
  ON public.payment_verification_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Staff can read payment_verification_requests"
  ON public.payment_verification_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::public.app_role));

CREATE POLICY "Admins can insert payment_verification_requests"
  ON public.payment_verification_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update payment_verification_requests"
  ON public.payment_verification_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE ON public.payment_verification_requests TO authenticated;
GRANT ALL ON public.payment_verification_requests TO service_role;

CREATE OR REPLACE FUNCTION public.approve_payment_verification_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.payment_verification_requests%ROWTYPE;
  invoice_amount numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO req
  FROM public.payment_verification_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment verification request not found';
  END IF;

  IF req.invoice_id IS NULL THEN
    RAISE EXCEPTION 'Payment verification request has no invoice selected';
  END IF;

  SELECT amount INTO invoice_amount
  FROM public.invoices
  WHERE id = req.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked invoice not found';
  END IF;

  UPDATE public.invoices
  SET payment_status = 'Done'::public.payment_status_enum,
      amount_received = COALESCE(invoice_amount, 0),
      reminder_sent = false,
      total_reminders_sent = 0
  WHERE id = req.invoice_id;

  UPDATE public.invoice_reminders
  SET status = 'cancelled',
      error_code = 'payment_verified',
      error_message = 'Payment verified by admin; future reminders cancelled'
  WHERE invoice_id = req.invoice_id
    AND status IN ('pending', 'approved', 'processing');

  UPDATE public.payment_verification_requests
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_verification_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.payment_verification_requests
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id
    AND status IN ('pending', 'unresolved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment verification request not found or already reviewed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_verification_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_payment_verification_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_verification_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_verification_request(uuid) TO authenticated;
