-- Phase 4A.1: Customer Ledger (Branch Wise)
-- Read-only, invoice-derived customer exposure view. No business rows are
-- inserted, updated, or deleted here.

CREATE OR REPLACE FUNCTION public.customer_ledger_quantity_label(
  _weight_kg numeric,
  _no_of_packs numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(_weight_kg, 0) > 0 AND COALESCE(_no_of_packs, 0) > 0
      THEN trim(to_char(_weight_kg, 'FM9999999990.##')) || ' kg / ' || trim(to_char(_no_of_packs, 'FM9999999990.##')) || ' packs'
    WHEN COALESCE(_weight_kg, 0) > 0
      THEN trim(to_char(_weight_kg, 'FM9999999990.##')) || ' kg'
    WHEN COALESCE(_no_of_packs, 0) > 0
      THEN trim(to_char(_no_of_packs, 'FM9999999990.##')) || ' packs'
    ELSE 'Not recorded'
  END;
$$;

REVOKE ALL ON FUNCTION public.customer_ledger_quantity_label(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_ledger_quantity_label(numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_ledger_rows(
  _search text DEFAULT NULL,
  _branch_id uuid DEFAULT NULL,
  _balance_status text DEFAULT 'all',
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _due_status text DEFAULT 'all',
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  invoice_id uuid,
  invoice_no text,
  client_id uuid,
  customer_name text,
  branch_id uuid,
  branch_name text,
  branch_key text,
  contact_number text,
  stock_date date,
  stock_quantity text,
  item text,
  amount numeric,
  verified_collections numeric,
  due_date date,
  balance numeric,
  days_since_stock_sent integer,
  payment_status text,
  last_payment_date timestamptz,
  due_status text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200000);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF COALESCE(_balance_status, 'all') NOT IN ('all', 'outstanding', 'paid') THEN
    RAISE EXCEPTION 'Invalid balance status';
  END IF;
  IF COALESCE(_due_status, 'all') NOT IN ('all', 'due_soon', 'overdue') THEN
    RAISE EXCEPTION 'Invalid due status';
  END IF;

  RETURN QUERY
  WITH approved_payments AS (
    SELECT
      l.invoice_id,
      MAX(l.created_at) AS last_payment_date
    FROM public.cash_ledger_entries l
    WHERE l.entry_type = 'client_payment_credit'
      AND l.invoice_id IS NOT NULL
    GROUP BY l.invoice_id
  ),
  base AS (
    SELECT
      i.id AS invoice_id,
      i.invoice_no,
      i.client_id,
      COALESCE(NULLIF(c.legal_name, ''), NULLIF(c.dba, ''), 'Unknown Customer') AS customer_name,
      i.branch_id,
      COALESCE(NULLIF(b.branch_name, ''), 'Unassigned Branch') AS branch_name,
      COALESCE(i.branch_id::text, 'unassigned:' || i.client_id::text) AS branch_key,
      c.phone AS contact_number,
      COALESCE(i.delivery_date, i.date, i.created_at::date) AS stock_date,
      public.customer_ledger_quantity_label(i.weight_kg, i.no_of_packs) AS stock_quantity,
      NULLIF(i.item, '') AS item,
      COALESCE(i.amount, 0) AS amount,
      CASE
        WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
        ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
      END AS verified_collections,
      i.due_date,
      GREATEST(
        COALESCE(i.amount, 0) -
        CASE
          WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
          ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
        END,
        0
      ) AS balance,
      GREATEST((CURRENT_DATE - COALESCE(i.delivery_date, i.date, i.created_at::date))::int, 0) AS days_since_stock_sent,
      i.payment_status::text AS payment_status,
      ap.last_payment_date,
      CASE
        WHEN GREATEST(
          COALESCE(i.amount, 0) -
          CASE
            WHEN i.payment_status = 'Done' THEN COALESCE(i.amount, 0)
            ELSE LEAST(COALESCE(i.amount_received, 0), COALESCE(i.amount, 0))
          END,
          0
        ) <= 0 THEN 'paid'
        WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'overdue'
        WHEN i.due_date IS NOT NULL AND i.due_date <= CURRENT_DATE + 7 THEN 'due_soon'
        ELSE 'not_due'
      END AS due_status
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id
    LEFT JOIN public.branches b ON b.id = i.branch_id
    LEFT JOIN approved_payments ap ON ap.invoice_id = i.id
    WHERE COALESCE(i.is_deleted, false) = false
  ),
  filtered AS (
    SELECT x.*
    FROM base x
    WHERE (_search IS NULL OR trim(_search) = ''
        OR x.customer_name ILIKE '%' || trim(_search) || '%'
        OR x.branch_name ILIKE '%' || trim(_search) || '%'
        OR x.invoice_no ILIKE '%' || trim(_search) || '%')
      AND (_branch_id IS NULL OR x.branch_id = _branch_id)
      AND (_date_from IS NULL OR x.stock_date >= _date_from)
      AND (_date_to IS NULL OR x.stock_date <= _date_to)
      AND (COALESCE(_balance_status, 'all') = 'all'
        OR (COALESCE(_balance_status, 'all') = 'outstanding' AND x.balance > 0)
        OR (COALESCE(_balance_status, 'all') = 'paid' AND x.balance = 0))
      AND (COALESCE(_due_status, 'all') = 'all'
        OR x.due_status = COALESCE(_due_status, 'all'))
  )
  SELECT
    f.invoice_id,
    f.invoice_no,
    f.client_id,
    f.customer_name,
    f.branch_id,
    f.branch_name,
    f.branch_key,
    f.contact_number,
    f.stock_date,
    f.stock_quantity,
    f.item,
    f.amount,
    f.verified_collections,
    f.due_date,
    f.balance,
    f.days_since_stock_sent,
    f.payment_status,
    f.last_payment_date,
    f.due_status,
    COUNT(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.stock_date DESC, f.invoice_no DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_ledger_rows(text, uuid, text, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_rows(text, uuid, text, date, date, text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_ledger_summary(
  _search text DEFAULT NULL,
  _branch_id uuid DEFAULT NULL,
  _balance_status text DEFAULT 'all',
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _due_status text DEFAULT 'all'
)
RETURNS TABLE (
  unique_customer_branches bigint,
  outstanding_customer_branches bigint,
  total_invoice_value numeric,
  total_outstanding_balance numeric,
  overdue_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT *
    FROM public.get_customer_ledger_rows(
      _search,
      _branch_id,
      _balance_status,
      _date_from,
      _date_to,
      _due_status,
      200000,
      0
    )
  )
  SELECT
    COUNT(DISTINCT client_id::text || ':' || branch_key) AS unique_customer_branches,
    COUNT(DISTINCT client_id::text || ':' || branch_key) FILTER (WHERE balance > 0) AS outstanding_customer_branches,
    COALESCE(SUM(amount), 0) AS total_invoice_value,
    COALESCE(SUM(balance), 0) AS total_outstanding_balance,
    COALESCE(SUM(balance) FILTER (WHERE due_status = 'overdue'), 0) AS overdue_balance
  FROM rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_ledger_summary(text, uuid, text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_summary(text, uuid, text, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_branch_ledger_detail(
  _client_id uuid,
  _branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'Client is required';
  END IF;

  WITH rows AS (
    SELECT *
    FROM public.get_customer_ledger_rows(NULL, _branch_id, 'all', NULL, NULL, 'all', 200000, 0)
    WHERE client_id = _client_id
      AND (branch_id IS NOT DISTINCT FROM _branch_id)
  ),
  summary AS (
    SELECT
      MIN(customer_name) AS customer_name,
      MIN(branch_name) AS branch_name,
      MIN(contact_number) AS contact_number,
      COALESCE(SUM(amount), 0) AS total_stock_sales_value,
      COALESCE(SUM(verified_collections), 0) AS total_verified_collections,
      COALESCE(SUM(balance), 0) AS current_outstanding,
      MIN(stock_date) FILTER (WHERE balance > 0) AS oldest_outstanding_stock_date,
      MAX(days_since_stock_sent) FILTER (WHERE balance > 0) AS current_oldest_days_since_stock_sent
    FROM rows
  )
  SELECT jsonb_build_object(
    'summary', to_jsonb(summary),
    'history', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(r) ORDER BY r.stock_date DESC, r.invoice_no DESC)
        FROM rows r
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM summary;

  RETURN COALESCE(v_result, jsonb_build_object('summary', NULL, 'history', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_branch_ledger_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_branch_ledger_detail(uuid, uuid) TO authenticated;
