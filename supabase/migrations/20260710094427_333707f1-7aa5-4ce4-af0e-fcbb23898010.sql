-- Move the privileged role-check helper out of the public API schema
CREATE SCHEMA IF NOT EXISTS authz;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA authz;

REVOKE ALL ON SCHEMA authz FROM PUBLIC;
GRANT USAGE ON SCHEMA authz TO authenticated, service_role;

REVOKE ALL ON FUNCTION authz.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION authz.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Recreate a public compatibility wrapper that is not SECURITY DEFINER and only checks the caller's own role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, authz
AS $$
  SELECT CASE
    WHEN _user_id = auth.uid() THEN authz.has_role(_user_id, _role)
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;