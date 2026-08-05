-- Corrective hardening for the four Chunk 3 migrations.
--
-- This Supabase project has a pre-existing database-level default
-- privilege (ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public)
-- that automatically grants ALL privileges on every newly created table to
-- authenticated (and anon/service_role). The Chunk 3 migrations correctly
-- revoked this from anon before granting SELECT to authenticated, but
-- never revoked the pre-existing ALL grant from authenticated itself
-- before granting SELECT - so authenticated silently retained table-level
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all eight new
-- tables, even though no RLS policy grants those commands for
-- authenticated on any of them (so this was not actually exploitable, but
-- it contradicts the "SELECT only, all writes via controlled RPC" design
-- promised for these tables).
--
-- This migration explicitly revokes ALL from authenticated and re-grants
-- only SELECT, for every Chunk 3 table. It changes no data and no RLS
-- policy; it only tightens the table-level grant to match the RLS design
-- that was already in place.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'operational_alerts',
    'wastage_verifications',
    'wastage_verification_events',
    'stock_audits',
    'stock_audit_items',
    'stock_audit_submissions',
    'stock_audit_submission_items',
    'stock_audit_events'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
  END LOOP;
END $$;
