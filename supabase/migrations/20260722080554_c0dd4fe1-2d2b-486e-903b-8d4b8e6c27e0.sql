
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_report_number text;
ALTER TABLE public.payment_screenshots ADD COLUMN IF NOT EXISTS match_notes text;
ALTER TABLE public.payment_screenshots ADD COLUMN IF NOT EXISTS uploaded_by text;
