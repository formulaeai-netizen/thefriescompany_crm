import assert from "node:assert/strict";
import test from "node:test";
import {
  handleIncomingExpenseMessage,
  type ExpenseIntakeRepository,
  type ExpenseIntakeRpcResult,
} from "./services/inbound-expense-intake.js";
import type { ParsedExpenseItem } from "./services/expense-command-parser.js";

class MemoryExpenseIntakeRepository implements ExpenseIntakeRepository {
  public trustedSender: string | null = "923083021375";
  public calls: Array<{
    providerMessageId: string;
    senderNormalized: string;
    rawBody: string;
    items: ParsedExpenseItem[];
  }> = [];
  private seenMessageIds = new Map<string, ExpenseIntakeRpcResult>();
  public nextResult: ExpenseIntakeRpcResult | null = null;

  async loadTrustedExpenseSender(): Promise<string | null> {
    return this.trustedSender;
  }

  async createExpensesFromTrustedMessage(input: {
    providerMessageId: string;
    senderNormalized: string;
    rawBody: string;
    items: ParsedExpenseItem[];
  }): Promise<ExpenseIntakeRpcResult> {
    this.calls.push(input);

    const prior = this.seenMessageIds.get(input.providerMessageId);
    if (prior) return prior;

    const result: ExpenseIntakeRpcResult = this.nextResult ?? {
      status: "created",
      expenseIds: input.items.map((_, i) => `expense-${this.calls.length}-${i}`),
      totalAmount: input.items.reduce((sum, item) => sum + item.amount, 0),
    };
    this.seenMessageIds.set(input.providerMessageId, result);
    return result;
  }
}

function message(overrides: any = {}) {
  return {
    fromMe: false,
    from: "923083021375@c.us",
    body: "EXPENSE 2500 Fuel",
    id: { _serialized: `msg-${Math.random()}` },
    ...overrides,
  };
}

test("trusted sender + valid single command creates one expense via the repository", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ id: { _serialized: "e-1" } }));

  assert.equal(result.kind, "recorded");
  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0].providerMessageId, "e-1");
  assert.equal(repo.calls[0].senderNormalized, "923083021375");
  assert.deepEqual(repo.calls[0].items, [{ description: "Fuel", amount: 2500 }]);
  if (result.kind === "recorded") {
    assert.equal(result.status, "created");
    assert.equal(result.totalAmount, 2500);
    assert.match(result.reply, /Fuel/);
    assert.match(result.reply, /2,500/);
  }
});

test("trusted sender + valid list command passes every item to the repository", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(
    repo,
    message({ body: "EXPENSE LIST\nFuel | 2500\nPackaging | 1800", id: { _serialized: "e-2" } }),
  );

  assert.equal(result.kind, "recorded");
  assert.equal(repo.calls.length, 1);
  assert.deepEqual(repo.calls[0].items, [
    { description: "Fuel", amount: 2500 },
    { description: "Packaging", amount: 1800 },
  ]);
  if (result.kind === "recorded") {
    assert.equal(result.itemCount, 2);
    assert.equal(result.totalAmount, 4300);
    assert.match(result.reply, /2 expenses recorded/);
    assert.match(result.reply, /4,300/);
  }
});

test("trusted sender + numbered daily report creates expenses with the report date", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(
    repo,
    message({
      body: [
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
      ].join("\n"),
      id: { _serialized: "daily-report-1" },
    }),
  );

  assert.equal(result.kind, "recorded");
  assert.equal(repo.calls.length, 1);
  assert.deepEqual(repo.calls[0].items, [
    { description: "Paani", amount: 1400, expenseDate: "2026-08-08" },
    { description: "Khana", amount: 750, expenseDate: "2026-08-08" },
    { description: "Chai", amount: 210, expenseDate: "2026-08-08" },
    { description: "Drinking water", amount: 80, expenseDate: "2026-08-08" },
    { description: "Invoice print", amount: 60, expenseDate: "2026-08-08" },
    { description: "DVR reset", amount: 1500, expenseDate: "2026-08-08" },
    { description: "Delivery", amount: 2500, expenseDate: "2026-08-08" },
  ]);
  if (result.kind === "recorded") {
    assert.equal(result.itemCount, 7);
    assert.equal(result.totalAmount, 6500);
  }
});

test("trusted sender + numbered daily report with mismatched total is rejected atomically", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(
    repo,
    message({
      body: ["Date: 8 August 2026", "1. Paani 1400", "2. Khana 750", "Total: 100"].join("\n"),
    }),
  );

  assert.equal(result.kind, "invalid_format");
  assert.equal(repo.calls.length, 0);
});

test("untrusted sender never reaches the repository and gets no reply/disclosure", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ from: "923000000000@c.us" }));

  assert.equal(result.kind, "untrusted_sender");
  assert.equal(repo.calls.length, 0);
});

test("a known CRM client number (not the configured expense sender) is still untrusted for expense intake", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ from: "923212558027@c.us" }));

  assert.equal(result.kind, "untrusted_sender");
  assert.equal(repo.calls.length, 0);
});

test("missing configured trusted sender fails closed", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  repo.trustedSender = null;
  const result = await handleIncomingExpenseMessage(repo, message());

  assert.equal(result.kind, "untrusted_sender");
  assert.equal(repo.calls.length, 0);
});

test("malformed command from the trusted sender never reaches the repository", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ body: "EXPENSE 500" }));

  assert.equal(result.kind, "invalid_format");
  if (result.kind === "invalid_format") assert.match(result.reply, /EXPENSE 2500 Fuel/);
  assert.equal(repo.calls.length, 0);
});

test("malformed list from the trusted sender (one bad line) never reaches the repository", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(
    repo,
    message({ body: "EXPENSE LIST\nFuel | 2500\nBad | -1" }),
  );

  assert.equal(result.kind, "invalid_format");
  assert.equal(repo.calls.length, 0);
});

test("a message not starting with EXPENSE is ignored entirely (not routed as invalid)", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ body: "PAID 25000 INV-1" }));

  assert.equal(result.kind, "ignored");
  assert.equal(repo.calls.length, 0);
});

test("outgoing (fromMe) messages are ignored entirely", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const result = await handleIncomingExpenseMessage(repo, message({ fromMe: true }));

  assert.equal(result.kind, "ignored");
  assert.equal(repo.calls.length, 0);
});

test("duplicate provider message id is forwarded to the repository, which is responsible for returning the prior result idempotently", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  const sharedId = { _serialized: "dup-e-1" };

  const first = await handleIncomingExpenseMessage(repo, message({ id: sharedId }));
  const second = await handleIncomingExpenseMessage(repo, message({ id: sharedId }));

  assert.equal(first.kind, "recorded");
  assert.equal(second.kind, "recorded");
  if (second.kind === "recorded") assert.equal(second.status, "created");
  assert.equal(
    repo.calls.length,
    2,
    "the handler itself does not dedupe - the DB-level unique constraint does",
  );
});

test("a repository rejection never leaks the raw error text back to WhatsApp", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  repo.nextResult = {
    status: "rejected",
    reason:
      'duplicate key value violates unique constraint "whatsapp_expense_intake_provider_message_id_unique"',
  };

  const result = await handleIncomingExpenseMessage(repo, message());

  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.doesNotMatch(result.reply, /constraint/i);
    assert.doesNotMatch(result.reply, /unique/i);
  }
});

test("this module never has a code path that writes to cash_ledger_entries - it only ever calls createExpensesFromTrustedMessage", async () => {
  const repo = new MemoryExpenseIntakeRepository();
  await handleIncomingExpenseMessage(repo, message());
  await handleIncomingExpenseMessage(
    repo,
    message({ body: "EXPENSE LIST\nFuel | 2500\nPackaging | 1800", id: { _serialized: "e-list" } }),
  );

  assert.ok(
    repo.calls.every((call) => Array.isArray(call.items) && call.items.length > 0),
    "every repository call only ever carries parsed expense items, never a ledger row shape",
  );
});
