// Safe, no-network simulation of one inbound early-payment message (e.g.
// "Paid", "Payment sent") against an in-memory fixture repository. Never
// connects to a real WhatsApp session, never touches the real database,
// never sends anything - only prints the prepared reply text.

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
  async findClientByPhone(normalizedPhone: string) {
    return normalizedPhone === "923212558027" ? FIXTURE_CLIENT : null;
  }
  async findOpenInvoicesForClient() {
    return [FIXTURE_INVOICE];
  }
  async findInvoiceByReferenceForClient() {
    return null;
  }
  async createVerificationRequest(): Promise<never> {
    throw new Error("Early-payment simulation must never create a verification request");
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
  const body = readArg("message", "Paid");
  const from = readArg("from", "923212558027@c.us");

  const repository = new FixtureRepository();
  const context = createInboundContext();
  const message = { fromMe: false, from, body, hasMedia: false };

  const result = await handleIncomingPaymentMessage(repository, message, context);

  console.info("Simulated early-payment message result (no DB/WhatsApp touched):", {
    input: { from, body },
    result,
  });
}

main().catch((error: unknown) => {
  console.error("Simulation failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
