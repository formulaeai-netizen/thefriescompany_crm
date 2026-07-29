export const EXPENSE_GROUPS = {
  "Fixed Overhead": ["Rent", "Electricity", "Gas", "Internet", "Salaries"],
  "Variable Costs": ["Raw Materials", "Packaging", "Delivery / Transport", "Petrol / Fuel"],
  "One-Time / Other": ["Equipment", "Repairs", "Miscellaneous"],
} as const;

export type ExpenseGroup = keyof typeof EXPENSE_GROUPS;
export const GROUP_NAMES = Object.keys(EXPENSE_GROUPS) as ExpenseGroup[];

export const GROUP_COLORS: Record<ExpenseGroup, string> = {
  "Fixed Overhead": "var(--primary)",
  "Variable Costs": "var(--chart-2)",
  "One-Time / Other": "var(--muted-foreground)",
};