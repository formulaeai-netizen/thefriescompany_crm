-- Add the moderator business role as an additive enum value.
-- Existing roles (admin, staff, investor, viewer) are preserved unchanged.
-- viewer is intentionally kept: it is a pre-existing enum value used by the
-- users-management UI and must not be renamed, replaced or removed.
-- No existing public.user_roles row is modified by this migration.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'moderator';
