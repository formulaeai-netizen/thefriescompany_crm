ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ALTER COLUMN added_by DROP DEFAULT;
CREATE INDEX IF NOT EXISTS expenses_created_by_idx ON public.expenses(created_by);