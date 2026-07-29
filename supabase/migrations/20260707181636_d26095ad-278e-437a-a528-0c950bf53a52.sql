CREATE OR REPLACE FUNCTION public.generate_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prefix_month text;
  next_num int := 1;
  candidate text;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;

  -- Use invoice date (falls back to now) so back-dated invoices get the correct MMYY prefix
  prefix_month := TO_CHAR(COALESCE(NEW.date, CURRENT_DATE), 'MMYY');

  -- Serialize concurrent inserts for the same month to avoid race conditions
  PERFORM pg_advisory_xact_lock(hashtext('invoice_no_' || prefix_month));

  -- Find the next available number, scanning ALL invoices (including soft-deleted)
  -- because the unique constraint applies regardless of is_deleted.
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_no FROM 10) AS int)), 0) + 1
    INTO next_num
  FROM public.invoices
  WHERE invoice_no ~ ('^TFC-' || prefix_month || '-[0-9]+$');

  candidate := 'TFC-' || prefix_month || '-' || LPAD(next_num::text, 3, '0');

  -- Safety loop in case of any drift
  WHILE EXISTS (SELECT 1 FROM public.invoices WHERE invoice_no = candidate) LOOP
    next_num := next_num + 1;
    candidate := 'TFC-' || prefix_month || '-' || LPAD(next_num::text, 3, '0');
  END LOOP;

  NEW.invoice_no := candidate;
  RETURN NEW;
END;
$function$;

-- Ensure the trigger exists (it should already, but be defensive)
DROP TRIGGER IF EXISTS set_invoice_no ON public.invoices;
CREATE TRIGGER set_invoice_no
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_invoice_no();