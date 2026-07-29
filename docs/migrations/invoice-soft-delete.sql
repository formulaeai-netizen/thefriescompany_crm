ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS deleted_at timestamp;
CREATE INDEX IF NOT EXISTS invoices_is_deleted_idx ON public.invoices (is_deleted);
