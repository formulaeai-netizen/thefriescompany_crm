// Safe, no-network simulation of one inbound strict "PAID <amount> <invoice>"
// command against an in-memory fixture repository. Never connects to a real
// WhatsApp session, never touches the real database, never sends anything.
// Useful for manually sanity-checking the parser/classification/reply logic.

import {
  createInboundContext,
  handleIncomingPaymentMessage,
  type InboundClient,
  type InboundInvoice,
  type InboundPaymentRepository,
} from "./services/inbound-payment-confirmations.js";

const FIXTURE_CLIENT: InboundClient = { id: "fixture-client-1", legal_name: "Fixture Client" };
const FIXTURE_INVOICE: InboundInvoice = {
  id: "fixture-invoice-1",
  client_id: FIXTURE_CLIENT.id,
  invoice_no: "INV-1023",
  amount: 25000,
  amount_received: 0,
  payment_status: "Not Done",
  is_deleted: false,
};

class FixtureRepository implements InboundPaymentRepository {
  createdRequests: unknown[] = [];

  async findClientByPhone(normalizedPhone: string) {
    return normalizedPhone === "923212558027" ? FIXTURE_CLIENT : null;
  }
  async findOpenInvoicesForClient() {
    return [FIXTURE_INVOICE];
  }
  async findInvoiceByReferenceForClient(_clientId: string, invoiceReference: string) {
    return invoiceReference.toUpperCase() === FIXTURE_INVOICE.invoice_no ? FIXTURE_INVOICE : null;
  }
  async createVerificationRequest(row: unknown) {
    this.createdRequests.push(row);
    return { status: "inserted" as const, id: `fixture-request-${this.createdRequests.length}` };
  }
  async storePaymentProof() {
    return { storagePath: null, mimetype: null, filename: null, sizeBytes: null };
  }
}

function readArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main() {
  const body = readArg("message", "PAID 25000 INV-1023");
  const from = readArg("from", "923212558027@c.us");

  const repository = new FixtureRepository();
  const context = createInboundContext();
  const message = { fromMe: false, from, body, hasMedia: false };

  const result = await handleIncomingPaymentMessage(repository, message, context);

  console.info("Simulated strict PAID command result (no DB/WhatsApp touched):", {
    input: { from, body },
    result,
    createdRequestCount: repository.createdRequests.length,
  });
}

main().catch((error: unknown) => {
  console.error("Simulation failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
