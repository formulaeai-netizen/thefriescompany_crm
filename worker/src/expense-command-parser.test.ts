import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeNumberedExpenseReport,
  parseExpenseCommand,
  parseExpenseListCommand,
  parseExpenseReportDate,
  parseNumberedExpenseReport,
  parseSingleExpenseCommand,
  totalOf,
} from "./services/expense-command-parser.js";

test("valid single expense parses description and amount", () => {
  assert.deepEqual(parseSingleExpenseCommand("EXPENSE 2500 Fuel"), {
    description: "Fuel",
    amount: 2500,
  });
});

test("lowercase command parses the same way", () => {
  assert.deepEqual(parseSingleExpenseCommand("expense 2500 fuel"), {
    description: "fuel",
    amount: 2500,
  });
});

test("commas in the amount are accepted", () => {
  assert.deepEqual(parseSingleExpenseCommand("EXPENSE 12,500 Packaging materials"), {
    description: "Packaging materials",
    amount: 12500,
  });
});

test("multi-word descriptions with extra whitespace are preserved and trimmed", () => {
  assert.deepEqual(parseSingleExpenseCommand("EXPENSE   500   Delivery  rider  fuel"), {
    description: "Delivery rider fuel",
    amount: 500,
  });
});

test("invalid amount is rejected", () => {
  assert.equal(parseSingleExpenseCommand("EXPENSE -500 Fuel"), null);
  assert.equal(parseSingleExpenseCommand("EXPENSE 0 Fuel"), null);
  assert.equal(parseSingleExpenseCommand("EXPENSE abc Fuel"), null);
});

test("missing description is rejected", () => {
  assert.equal(parseSingleExpenseCommand("EXPENSE 500"), null);
  assert.equal(parseSingleExpenseCommand("EXPENSE 500 "), null);
});

test("a description that is itself purely numeric is rejected as ambiguous", () => {
  assert.equal(parseSingleExpenseCommand("EXPENSE 2500 700"), null);
});

test("non-EXPENSE text never parses", () => {
  assert.equal(parseSingleExpenseCommand("PAID 2500 INV-1"), null);
  assert.equal(parseSingleExpenseCommand(""), null);
  assert.equal(parseSingleExpenseCommand(null), null);
  assert.equal(parseSingleExpenseCommand(undefined), null);
});

test("valid expense list parses every line", () => {
  const result = parseExpenseListCommand(
    "EXPENSE LIST\nFuel | 2500\nPackaging | 1800\nDelivery | 700",
  );
  assert.deepEqual(result, [
    { description: "Fuel", amount: 2500 },
    { description: "Packaging", amount: 1800 },
    { description: "Delivery", amount: 700 },
  ]);
});

test("list mode is case-insensitive on the header and tolerates blank lines", () => {
  const result = parseExpenseListCommand("expense list\n\nFuel | 2500\n\nPackaging | 1800\n");
  assert.deepEqual(result, [
    { description: "Fuel", amount: 2500 },
    { description: "Packaging", amount: 1800 },
  ]);
});

test("malformed list is rejected atomically - one bad line invalidates the entire list", () => {
  assert.equal(
    parseExpenseListCommand("EXPENSE LIST\nFuel | 2500\nBad line without pipe\nDelivery | 700"),
    null,
  );
  assert.equal(
    parseExpenseListCommand("EXPENSE LIST\nFuel | 2500\nBad | -1\nDelivery | 700"),
    null,
  );
  assert.equal(parseExpenseListCommand("EXPENSE LIST\nFuel | 2500\n | 700"), null);
  assert.equal(parseExpenseListCommand("EXPENSE LIST\nFuel | 2500 | extra"), null);
});

test("a list with only a header and no items is rejected", () => {
  assert.equal(parseExpenseListCommand("EXPENSE LIST"), null);
});

test("a message without the list header never parses as a list", () => {
  assert.equal(parseExpenseListCommand("Fuel | 2500"), null);
});

test("parseExpenseCommand routes single vs list deterministically, never both", () => {
  assert.deepEqual(parseExpenseCommand("EXPENSE 2500 Fuel"), {
    kind: "single",
    item: { description: "Fuel", amount: 2500 },
  });
  assert.deepEqual(parseExpenseCommand("EXPENSE LIST\nFuel | 2500\nPackaging | 1800"), {
    kind: "list",
    items: [
      { description: "Fuel", amount: 2500 },
      { description: "Packaging", amount: 1800 },
    ],
  });
  assert.equal(parseExpenseCommand("EXPENSE LIST\nFuel | -1"), null);
  assert.equal(parseExpenseCommand("hello there"), null);
  assert.equal(parseExpenseCommand(""), null);
});

const dailyExpenseReport = [
  "Previous balance: 120",
  "Date: 8 August 2026",
  "Received at Day Start: 7000",
  "",
  "1. Paani 1400",
  "2. Khana 750",
  "3. Chai 210",
  "4. Drinking water 80",
  "5. Invoice print 60",
  "6. DVR reset 1500",
  "7. Delivery 2500",
  "",
  "Total: 6500",
  "Amount in hand:",
].join("\n");

test("numbered daily expense report parses only numbered expense lines and carries the report date", () => {
  const result = parseNumberedExpenseReport(dailyExpenseReport);

  assert.equal(result?.kind, "list");
  assert.equal(result?.expenseDate, "2026-08-08");
  assert.deepEqual(result?.items, [
    { description: "Paani", amount: 1400, expenseDate: "2026-08-08" },
    { description: "Khana", amount: 750, expenseDate: "2026-08-08" },
    { description: "Chai", amount: 210, expenseDate: "2026-08-08" },
    { description: "Drinking water", amount: 80, expenseDate: "2026-08-08" },
    { description: "Invoice print", amount: 60, expenseDate: "2026-08-08" },
    { description: "DVR reset", amount: 1500, expenseDate: "2026-08-08" },
    { description: "Delivery", amount: 2500, expenseDate: "2026-08-08" },
  ]);
});

test("numbered daily expense report rejects a mismatched total", () => {
  assert.equal(
    parseNumberedExpenseReport(dailyExpenseReport.replace("Total: 6500", "Total: 6400")),
    null,
  );
});

test("date parser supports named and numeric report dates", () => {
  assert.equal(parseExpenseReportDate("Date: 8 August 2026"), "2026-08-08");
  assert.equal(parseExpenseReportDate("Date: 08/08/2026"), "2026-08-08");
  assert.equal(parseExpenseReportDate("Date: 31 February 2026"), null);
});

test("parseExpenseCommand accepts the numbered daily report format without an EXPENSE header", () => {
  const result = parseExpenseCommand(dailyExpenseReport);
  assert.equal(result?.kind, "list");
  if (result?.kind === "list") assert.equal(totalOf(result.items), 6500);
  assert.equal(looksLikeNumberedExpenseReport(dailyExpenseReport), true);
});

test("totalOf sums item amounts exactly", () => {
  assert.equal(
    totalOf([
      { description: "Fuel", amount: 2500 },
      { description: "Packaging", amount: 1800 },
      { description: "Delivery", amount: 700 },
    ]),
    5000,
  );
  assert.equal(totalOf([]), 0);
});
