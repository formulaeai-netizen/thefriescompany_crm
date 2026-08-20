import assert from "node:assert/strict";
import test from "node:test";

import { validateExpenseCreateInput } from "./expenses.ts";

const baseExpense = {
  item: "Cooking oil",
  price: 1200,
  date: "2026-08-20",
};

test("manual expense cannot be created without a paid-from account", () => {
  assert.throws(() => validateExpenseCreateInput(baseExpense));
});

test("manual expense rejects an invalid paid-from account", () => {
  assert.throws(() =>
    validateExpenseCreateInput({ ...baseExpense, paid_from_account_id: "cash-in-hand" }),
  );
});

test("manual cash and bank expenses pass a valid account to the protected RPC", () => {
  const cash = validateExpenseCreateInput({
    ...baseExpense,
    paid_from_account_id: "00000000-0000-4000-8000-000000000001",
  });
  const bank = validateExpenseCreateInput({
    ...baseExpense,
    paid_from_account_id: "00000000-0000-4000-8000-000000000002",
  });

  assert.equal(cash.paid_from_account_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(bank.paid_from_account_id, "00000000-0000-4000-8000-000000000002");
});
