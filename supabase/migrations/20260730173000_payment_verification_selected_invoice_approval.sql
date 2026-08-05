DROP FUNCTION IF EXISTS public.approve_payment_verification_request(uuid);

CREATE OR REPLACE FUNCTION public.approve_payment_verification_request(
  _request_id uuid,
  _selected_invoice_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.payment_verification_requests%ROWTYPE;
  target_invoice_id uuid;
  invoice_row public.invoices%ROWTYPE;
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

  IF req.status NOT IN ('pending', 'unresolved') THEN
    RAISE EXCEPTION 'Payment verification request has already been reviewed';
  END IF;

  target_invoice_id := COALESCE(_selected_invoice_id, req.invoice_id);

  IF target_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Payment verification request has no invoice selected';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = target_invoice_id
    AND COALESCE(is_deleted, false) = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected invoice not found';
  END IF;

  IF req.client_id IS NOT NULL AND invoice_row.client_id IS DISTINCT FROM req.client_id THEN
    RAISE EXCEPTION 'Selected invoice does not belong to the matched client';
  END IF;

  IF invoice_row.payment_status = 'Done'::public.payment_status_enum THEN
    RAISE EXCEPTION 'Selected invoice is already paid';
  END IF;

  UPDATE public.invoices
  SET payment_status = 'Done'::public.payment_status_enum,
      amount_received = COALESCE(invoice_row.amount, 0),
      reminder_sent = false,
      total_reminders_sent = 0
  WHERE id = target_invoice_id;

  UPDATE public.invoice_reminders
  SET status = 'cancelled',
      error_code = 'payment_verified',
      error_message = 'Payment verified by admin; future reminders cancelled'
  WHERE invoice_id = target_invoice_id
    AND status IN ('pending', 'approved', 'processing');

  UPDATE public.payment_verification_requests
  SET invoice_id = target_invoice_id,
      status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_verification_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_verification_request(uuid, uuid) TO authenticated;
