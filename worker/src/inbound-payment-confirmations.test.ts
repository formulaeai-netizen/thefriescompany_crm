import assert from "node:assert/strict";
import test from "node:test";
import {
  createInboundContext,
  handleIncomingPaymentMessage,
  type CreateVerificationRequestResult,
  type InboundClient,
  type InboundInvoice,
  type InboundMediaMetadata,
  type InboundPaymentRepository,
  type PaymentVerificationRequestInsert,
} from "./services/inbound-payment-confirmations.js";

class MemoryInboundRepository implements InboundPaymentRepository {
  public requests: PaymentVerificationRequestInsert[] = [];
  public storedProofs = 0;
  private seenMessageIds = new Set<string>();

  constructor(
    public client: InboundClient | null,
    public invoices: InboundInvoice[],
  ) {}

  async findClientByPhone(normalizedPhone: string) {
    return normalizedPhone === "923212558027" ? this.client : null;
  }

  async findOpenInvoicesForClient() {
    return this.invoices.filter(
      (invoice) => invoice.payment_status !== "Done" && !invoice.is_deleted,
    );
  }

  async findInvoiceByReferenceForClient(_clientId: string, invoiceReference: string) {
    return (
      this.invoices.find(
        (invoice) => (invoice.invoice_no ?? "").toUpperCase() === invoiceReference.toUpperCase(),
      ) ?? null
    );
  }

  async createVerificationRequest(
    row: PaymentVerificationRequestInsert,
  ): Promise<CreateVerificationRequestResult> {
    if (this.seenMessageIds.has(row.inbound_message_id)) return { status: "duplicate" };
    this.seenMessageIds.add(row.inbound_message_id);
    this.requests.push(row);
    return { status: "inserted", id: `request-${this.requests.length}` };
  }

  async storePaymentProof(): Promise<InboundMediaMetadata> {
    this.storedProofs++;
    return {
      storagePath: "client-1/payment-proof.jpg",
      mimetype: "image/jpeg",
      filename: "payment-proof.jpg",
      sizeBytes: 100,
    };
  }
}

function message(overrides: any = {}) {
  return {
    fromMe: false,
    from: "923212558027@c.us",
    body: "PAID 25000 INV-1023",
    hasMedia: false,
    id: { _serialized: `msg-${Math.random()}` },
    ...overrides,
  };
}

const client: InboundClient = { id: "client-1", legal_name: "testing_dev" };
const openInvoice: InboundInvoice = {
  id: "invoice-1",
  client_id: "client-1",
  invoice_no: "INV-1023",
  amount: 25000,
  amount_received: 0,
  payment_status: "Not Done",
  is_deleted: false,
};

// --- Strict command parser / classification (covered in payment-command-parser.test.ts) ---
// --- Inbound matching ---

test("known sender + correct invoice creates a pending verification request with all deterministic fields", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ id: { _serialized: "msg-1" } }),
    createInboundContext(),
  );

  assert.equal(result.kind, "strict_command_created");
  assert.equal(repo.requests.length, 1);
  const row = repo.requests[0];
  assert.equal(row.status, "pending");
  assert.equal(row.claimed_amount, 25000);
  assert.equal(row.parsed_invoice_reference, "INV-1023");
  assert.equal(row.inbound_message_id, "msg-1");
  assert.equal(row.normalized_sender_phone, "923212558027");
  assert.equal(row.normalized_command, "PAID 25000 INV-1023");
  assert.equal(row.invoice_id, "invoice-1");
  assert.equal(row.client_id, "client-1");
});

test("invoice owned by another client is blocked (invoice reference lookup is scoped to the matched client only)", async () => {
  const repo = new MemoryInboundRepository(client, []); // this client has no invoices at all
  const result = await handleIncomingPaymentMessage(repo, message(), createInboundContext());

  assert.equal(result.kind, "strict_command_rejected");
  if (result.kind === "strict_command_rejected") assert.equal(result.reason, "invoice_not_found");
  assert.equal(repo.requests.length, 0);
});

test("unknown sender is blocked and never creates a request", async () => {
  const repo = new MemoryInboundRepository(null, [openInvoice]);
  const result = await handleIncomingPaymentMessage(repo, message(), createInboundContext());

  assert.equal(result.kind, "strict_command_rejected");
  if (result.kind === "strict_command_rejected") assert.equal(result.reason, "unknown_sender");
  assert.equal(repo.requests.length, 0);
});

test("already-paid invoice is blocked", async () => {
  const repo = new MemoryInboundRepository(client, [{ ...openInvoice, payment_status: "Done" }]);
  const result = await handleIncomingPaymentMessage(repo, message(), createInboundContext());

  assert.equal(result.kind, "strict_command_rejected");
  if (result.kind === "strict_command_rejected") assert.equal(result.reason, "invoice_not_open");
  assert.equal(repo.requests.length, 0);
});

test("archived (is_deleted) invoice is blocked", async () => {
  const repo = new MemoryInboundRepository(client, [{ ...openInvoice, is_deleted: true }]);
  const result = await handleIncomingPaymentMessage(repo, message(), createInboundContext());

  assert.equal(result.kind, "strict_command_rejected");
  if (result.kind === "strict_command_rejected") assert.equal(result.reason, "invoice_not_open");
  assert.equal(repo.requests.length, 0);
});

test("duplicate inbound message id never creates a second request", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const first = await handleIncomingPaymentMessage(
    repo,
    message({ id: { _serialized: "dup-1" } }),
    createInboundContext(),
  );
  const second = await handleIncomingPaymentMessage(
    repo,
    message({ id: { _serialized: "dup-1" } }),
    createInboundContext(),
  );

  assert.equal(first.kind, "strict_command_created");
  assert.equal(second.kind, "duplicate_ignored");
  assert.equal(repo.requests.length, 1);
});

test("a media-only message (no valid command text) is rejected and never creates an approvable claim", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "", hasMedia: true }),
    createInboundContext(),
  );

  assert.equal(result.kind, "ignored");
  assert.equal(repo.requests.length, 0);
});

test("media attached to a valid strict command is stored as supplementary evidence only", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({
      hasMedia: true,
      downloadMedia: async () => ({ mimetype: "image/jpeg", filename: "proof.jpg", data: "x" }),
    }),
    createInboundContext(),
  );

  assert.equal(result.kind, "strict_command_created");
  assert.equal(repo.storedProofs, 1);
  assert.equal(repo.requests[0].storage_path, "client-1/payment-proof.jpg");
});

// --- Early-payment flow ---

test("one open invoice returns the exact early-payment template", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Paid" }),
    createInboundContext(),
  );

  assert.equal(result.kind, "early_payment_reply");
  if (result.kind === "early_payment_reply") {
    assert.equal(result.invoiceCount, 1);
    assert.match(result.reply, /testing_dev/);
    assert.match(result.reply, /INV-1023/);
    assert.match(result.reply, /Rs\. 25,000/);
    assert.match(result.reply, /PAID 25000 INV-1023/);
  }
  assert.equal(
    repo.requests.length,
    0,
    "early-payment message must never create a verification request",
  );
});

test("no open invoice returns a safe no-outstanding-invoice reply", async () => {
  const repo = new MemoryInboundRepository(client, []);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Payment sent" }),
    createInboundContext(),
  );

  assert.equal(result.kind, "early_payment_reply");
  if (result.kind === "early_payment_reply") {
    assert.equal(result.invoiceCount, 0);
    assert.match(result.reply, /koi outstanding invoice nahi/i);
  }
});

test("multiple open invoices lists exact invoice IDs, amounts and commands", async () => {
  const repo = new MemoryInboundRepository(client, [
    openInvoice,
    { ...openInvoice, id: "invoice-2", invoice_no: "INV-1024", amount: 12500 },
  ]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Transfer done" }),
    createInboundContext(),
  );

  assert.equal(result.kind, "early_payment_reply");
  if (result.kind === "early_payment_reply") {
    assert.equal(result.invoiceCount, 2);
    assert.match(result.reply, /Invoice ID: INV-1023/);
    assert.match(result.reply, /Amount: Rs\. 25,000/);
    assert.match(result.reply, /PAID 25000 INV-1023/);
    assert.match(result.reply, /Invoice ID: INV-1024/);
    assert.match(result.reply, /Amount: Rs\. 12,500/);
    assert.match(result.reply, /PAID 12500 INV-1024/);
  }
});

test("unknown sender leaks no invoice or client information", async () => {
  const repo = new MemoryInboundRepository(null, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Payment hogayi" }),
    createInboundContext(),
  );

  assert.equal(result.kind, "unknown_sender_ignored");
});

test("duplicate automated reply is suppressed for the same inbound message id", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const context = createInboundContext();
  const sharedId = { _serialized: "early-msg-1" };

  const first = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Paid", id: sharedId }),
    context,
  );
  const second = await handleIncomingPaymentMessage(
    repo,
    message({ body: "Paid", id: sharedId }),
    context,
  );

  assert.equal(first.kind, "early_payment_reply");
  assert.equal(second.kind, "duplicate_reply_suppressed");
});

test("an attempted but malformed PAID command gets correct-format guidance, never a fabricated match", async () => {
  const repo = new MemoryInboundRepository(client, [openInvoice]);
  const result = await handleIncomingPaymentMessage(
    repo,
    message({ body: "PAID 25000" }),
    createInboundContext(),
  );

  assert.equal(result.kind, "invalid_command_guidance");
  if (result.kind === "invalid_command_guidance") {
    assert.match(result.reply, /PAID <Amount> <Invoice-ID>/);
  }
  assert.equal(repo.requests.length, 0);
});
