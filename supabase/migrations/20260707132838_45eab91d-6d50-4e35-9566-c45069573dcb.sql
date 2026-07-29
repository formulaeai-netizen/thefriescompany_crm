CREATE OR REPLACE FUNCTION public.generate_invoice_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_month text;
  next_num INT := 1;
  existing_nums INT[];
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;

  current_month := TO_CHAR(NOW(), 'MMYY');

  SELECT ARRAY_AGG(
    CAST(SUBSTRING(invoice_no FROM 10) AS INT)
  ) INTO existing_nums
  FROM public.invoices
  WHERE invoice_no ~ ('^TFC-' || current_month || '-[0-9]+$')
    AND (is_deleted = false OR is_deleted IS NULL);

  IF existing_nums IS NOT NULL THEN
    WHILE next_num = ANY(existing_nums) LOOP
      next_num := next_num + 1;
    END LOOP;
  END IF;

  NEW.invoice_no := 'TFC-' || current_month || '-' || LPAD(next_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_invoice_no ON public.invoices;
CREATE TRIGGER set_invoice_no
BEFORE INSERT ON public.invoices
FOR EACH ROW
WHEN (NEW.invoice_no IS NULL OR NEW.invoice_no = '')
EXECUTE FUNCTION public.generate_invoice_no();