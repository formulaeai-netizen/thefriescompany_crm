CREATE OR REPLACE FUNCTION public.generate_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_no FROM 5) AS INT)), 0) + 1
    INTO next_num
    FROM invoices
   WHERE invoice_no ~ '^TFC-[0-9]+$';
  NEW.invoice_no := 'TFC-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_no() FROM PUBLIC, anon, authenticated;