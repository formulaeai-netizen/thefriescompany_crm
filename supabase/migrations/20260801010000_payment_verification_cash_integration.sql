-- Prompt 2, item A: payment verification foundation for deterministic
-- WhatsApp payment claims ("PAID 25000 INV-1023") and Cash in Hand
-- integration. Additive only - all existing payment_verification_requests
-- rows/columns are preserved. Worker-side message parsing/matching is not
-- wired in this migration (backend/database foundation only).

ALTER TABLE public.payment_verification_requests
  ADD COLUMN IF NOT EXISTS claimed_amount numeric,
  ADD COLUMN IF NOT EXISTS parsed_invoice_reference text,
  ADD COLUMN IF NOT EXISTS inbound_message_id text,
  ADD COLUMN IF NOT EXISTS normalized_sender_phone text,
  ADD COLUMN IF NOT EXISTS normalized_command text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_cash_entry_id uuid REFERENCES public.cash_ledger_entries(id) ON DELETE SET NULL;

ALTER TABLE public.payment_verification_requests
  DROP CONSTRAINT IF EXISTS payment_verification_requests_claimed_amount_check;
ALTER TABLE public.payment_verification_requests
  ADD CONSTRAINT payment_verification_requests_claimed_amount_check
  CHECK (claimed_amount IS NULL OR claimed_amount > 0);

-- Duplicate inbound message IDs must never create duplicate requests.
-- Partial unique index (NULL stays unconstrained for any pre-existing or
-- manually-created rows that predate this column).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_verification_requests_inbound_message_id
  ON public.payment_verification_requests (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_verification_requests_approved_cash_entry_id
  ON public.payment_verification_requests (approved_cash_entry_id);

-- ---------------------------------------------------------------------
-- Approval RPC: same signature as before (request_id, selected_invoice_id)
-- so existing callers are unaffected in shape, but the body is hardened
-- per the new business rules - exact-amount match only, no partial
-- payments, one credit per approval, atomic invoice+ledger+request update.
-- ---------------------------------------------------------------------

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
  outstanding_amount numeric;
  ledger_id uuid;
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

  IF req.approved_cash_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This request is already linked to a cash entry';
  END IF;

  -- Unknown senders (no matched client) must never create approved
  -- payments, regardless of whether an invoice id happens to be present.
  IF req.client_id IS NULL THEN
    RAISE EXCEPTION 'Payment verification request has no matched client';
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

  IF invoice_row.client_id IS DISTINCT FROM req.client_id THEN
    RAISE EXCEPTION 'Selected invoice does not belong to the matched client';
  END IF;

  IF invoice_row.payment_status = 'Done'::public.payment_status_enum THEN
    RAISE EXCEPTION 'Selected invoice is already paid';
  END IF;

  IF req.claimed_amount IS NULL THEN
    RAISE EXCEPTION 'Claimed amount is not set on this request';
  END IF;

  IF req.claimed_amount <= 0 THEN
    RAISE EXCEPTION 'Claimed amount must be positive';
  END IF;

  outstanding_amount := GREATEST(COALESCE(invoice_row.amount, 0) - COALESCE(invoice_row.amount_received, 0), 0);

  -- Exact-amount match only for this first implementation: no partial
  -- payments, no overpayments, no silent conversion of a mismatch into a
  -- full payment.
  IF req.claimed_amount <> outstanding_amount THEN
    RAISE EXCEPTION 'Claimed amount % does not match invoice outstanding amount %', req.claimed_amount, outstanding_amount;
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

  -- Exactly one Cash in Hand credit per approved request. source_key is
  -- unique at the database level, so even a retried/concurrent call can
  -- never create a second credit for the same request.
  INSERT INTO public.cash_ledger_entries (
    entry_type, amount, payment_verification_request_id, invoice_id, client_id, created_by, source_key
  ) VALUES (
    'client_payment_credit', req.claimed_amount, _request_id, target_invoice_id, req.client_id, auth.uid(),
    'payment_verification_request:' || _request_id::text
  )
  ON CONFLICT (source_key) DO NOTHING
  RETURNING id INTO ledger_id;

  IF ledger_id IS NULL THEN
    RAISE EXCEPTION 'A cash credit already exists for this payment verification request';
  END IF;

  UPDATE public.payment_verification_requests
  SET invoice_id = target_invoice_id,
      status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      approved_cash_entry_id = ledger_id
  WHERE id = _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payment_verification_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment_verification_request(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- Rejection now requires a reason and, as before, never touches invoices
-- or Cash in Hand. Signature changes from (uuid) to (uuid, text) - the
-- old 1-arg overload is dropped so it cannot be called without a reason.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reject_payment_verification_request(uuid);

CREATE OR REPLACE FUNCTION public.reject_payment_verification_request(
  _request_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  UPDATE public.payment_verification_requests
  SET status = 'rejected',
      rejection_reason = _reason,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id
    AND status IN ('pending', 'unresolved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment verification request not found or already reviewed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_payment_verification_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_payment_verification_request(uuid, text) TO authenticated;
