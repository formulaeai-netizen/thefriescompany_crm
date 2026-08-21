-- Admin-only customer portal identity and branch-access management.
-- Auth user creation remains in the server runtime; this RPC makes the
-- database mapping atomic and keeps customer access enforcement authoritative.

CREATE OR REPLACE FUNCTION public.set_customer_portal_access(
  _user_id uuid,
  _client_id uuid,
  _branch_ids uuid[],
  _is_active boolean DEFAULT true
)
RETURNS public.customer_portal_identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_branch_ids uuid[];
  existing_identity public.customer_portal_identities;
  result public.customer_portal_identities;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(_user_id, 'customer'::public.app_role) THEN
    RAISE EXCEPTION 'Target user must have the customer role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id) THEN
    RAISE EXCEPTION 'Selected customer / client does not exist';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT branch_id ORDER BY branch_id), ARRAY[]::uuid[])
  INTO normalized_branch_ids
  FROM unnest(COALESCE(_branch_ids, ARRAY[]::uuid[])) AS branch_id;

  IF COALESCE(_is_active, true) AND cardinality(normalized_branch_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one allowed branch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(normalized_branch_ids) AS selected(branch_id)
    LEFT JOIN public.branches b
      ON b.id = selected.branch_id
      AND b.client_id = _client_id
    WHERE b.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every allowed branch must belong to the selected customer';
  END IF;

  SELECT * INTO existing_identity
  FROM public.customer_portal_identities
  WHERE user_id = _user_id
  FOR UPDATE;

  IF FOUND AND existing_identity.client_id <> _client_id THEN
    RAISE EXCEPTION 'An existing portal identity cannot be moved to another customer';
  END IF;

  INSERT INTO public.customer_portal_identities (
    user_id,
    client_id,
    is_active,
    created_by
  ) VALUES (
    _user_id,
    _client_id,
    COALESCE(_is_active, true),
    auth.uid()
  )
  ON CONFLICT (user_id) DO UPDATE SET is_active = EXCLUDED.is_active
  RETURNING * INTO result;

  -- A disabled identity is retained. Existing branch access is also retained
  -- when no replacement list is supplied, so re-enabling never loses history.
  IF cardinality(normalized_branch_ids) > 0 THEN
    DELETE FROM public.customer_portal_branch_access WHERE user_id = _user_id;
    INSERT INTO public.customer_portal_branch_access (user_id, branch_id)
    SELECT _user_id, branch_id FROM unnest(normalized_branch_ids) AS branch_id;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_portal_access(uuid, uuid, uuid[], boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_customer_portal_access(uuid, uuid, uuid[], boolean)
  TO authenticated;
