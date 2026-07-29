
CREATE TABLE public.employee_salaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  month TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  designation TEXT,
  department TEXT,
  total_working_days INTEGER NOT NULL DEFAULT 0,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  gross_salary NUMERIC NOT NULL DEFAULT 0,
  income_tax NUMERIC NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  advance_taken NUMERIC NOT NULL DEFAULT 0,
  advance_balance NUMERIC NOT NULL DEFAULT 0,
  non_paid_holidays INTEGER NOT NULL DEFAULT 0,
  advance_repaid NUMERIC,
  repayment_collected_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX employee_salaries_month_idx ON public.employee_salaries(month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_salaries TO authenticated;
GRANT ALL ON public.employee_salaries TO service_role;

ALTER TABLE public.employee_salaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view salaries"
  ON public.employee_salaries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert salaries"
  ON public.employee_salaries FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update salaries"
  ON public.employee_salaries FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete salaries"
  ON public.employee_salaries FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER employee_salaries_touch_updated_at
  BEFORE UPDATE ON public.employee_salaries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
