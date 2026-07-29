
CREATE TABLE IF NOT EXISTS public.payment_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  whatsapp_from text,
  image_url text,
  extracted_amount numeric,
  extracted_date date,
  extracted_transaction_id text,
  match_status text DEFAULT 'Pending',
  match_confidence text DEFAULT 'Low',
  matched_invoice_no text,
  verified boolean DEFAULT false,
  verified_by text,
  raw_vision_response text,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_screenshots TO authenticated;
GRANT ALL ON public.payment_screenshots TO service_role;

ALTER TABLE public.payment_screenshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read payment_screenshots"
  ON public.payment_screenshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert payment_screenshots"
  ON public.payment_screenshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update payment_screenshots"
  ON public.payment_screenshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete payment_screenshots"
  ON public.payment_screenshots FOR DELETE TO authenticated USING (true);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS screenshot_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS transaction_id text;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS meta_phone_number_id text,
  ADD COLUMN IF NOT EXISTS meta_access_token text,
  ADD COLUMN IF NOT EXISTS meta_verify_token text,
  ADD COLUMN IF NOT EXISTS auto_verify_high_confidence boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_client_confirmation boolean DEFAULT true;
