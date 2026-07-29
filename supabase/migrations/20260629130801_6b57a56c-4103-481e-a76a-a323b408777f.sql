
-- Lock down SECURITY DEFINER functions: revoke broad EXECUTE, grant only where needed.

-- Trigger functions: triggers fire as table owner; no client EXECUTE needed.
REVOKE EXECUTE ON FUNCTION public.generate_invoice_no() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- has_role is used inside RLS policies; signed-in users must be able to call it,
-- but anonymous users should not.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
