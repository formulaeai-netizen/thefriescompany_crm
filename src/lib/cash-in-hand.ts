export type SalaryNetInput = {
  gross_salary: number;
  income_tax: number;
  total_working_days: number;
  absent_days: number;
  advance_taken: number;
  paid?: boolean;
};

/**
 * Mirrors public.calculate_salary_net_amount() and the existing client-side
 * formula in salaries.tsx (calcDeductions + calcNet) exactly, so the DB and
 * the app never disagree on what a salary row's net amount is. There is no
 * "overtime" field anywhere in employee_salaries, so nothing is or can be
 * double-counted here.
 */
export function calculateSalaryNetAmount(input: SalaryNetInput): number {
  const gross = Number(input.gross_salary) || 0;
  const tax = Number(input.income_tax) || 0;
  const workingDays = Number(input.total_working_days) || 0;
  const absent = Number(input.absent_days) || 0;
  const advance = Number(input.advance_taken) || 0;

  const deductions = workingDays === 0 ? 0 : Math.round((gross / workingDays) * absent);
  return gross - tax - deductions - advance;
}

/**
 * Only rows explicitly marked paid subtract from Cash in Hand - salary
 * creation/edit alone must never subtract money.
 */
export function sumPaidSalariesNet(salaries: SalaryNetInput[]): number {
  return salaries
    .filter((s) => s.paid === true)
    .reduce((sum, s) => sum + calculateSalaryNetAmount(s), 0);
}

export type CashInHandInputs = {
  openingBalance: number;
  clientPaymentCredits: number;
  expensesTotal: number;
  paidSalariesTotal: number;
};

/**
 * Final Cash in Hand formula (owner-provided):
 *   opening_balance + approved client-payment credits - expenses - paid salaries
 */
export function calculateCashInHand(inputs: CashInHandInputs): number {
  return (
    (Number(inputs.openingBalance) || 0) +
    (Number(inputs.clientPaymentCredits) || 0) -
    (Number(inputs.expensesTotal) || 0) -
    (Number(inputs.paidSalariesTotal) || 0)
  );
}

export type CashInHandSummary = {
  opening_balance: number;
  client_payment_credits: number;
  expenses_total: number;
  paid_salaries_total: number;
  cash_in_hand: number;
};

export type CashInHandDisplayRow = {
  key:
    | "opening_balance"
    | "client_payment_credits"
    | "expenses_total"
    | "paid_salaries_total"
    | "cash_in_hand";
  label: string;
  value: number;
  emphasize?: boolean;
};

/**
 * Single shared row order/labels for the Cash in Hand breakdown, used by
 * both the dashboard and the P&L page so they can never render the
 * formula differently from one another.
 */
export function buildCashInHandDisplayRows(summary: CashInHandSummary): CashInHandDisplayRow[] {
  return [
    { key: "opening_balance", label: "Opening Balance", value: summary.opening_balance },
    {
      key: "client_payment_credits",
      label: "Client Payments (Admin-approved)",
      value: summary.client_payment_credits,
    },
    { key: "expenses_total", label: "Expenses", value: -summary.expenses_total },
    { key: "paid_salaries_total", label: "Paid Salaries", value: -summary.paid_salaries_total },
    {
      key: "cash_in_hand",
      label: "Current Cash in Hand",
      value: summary.cash_in_hand,
      emphasize: true,
    },
  ];
}
