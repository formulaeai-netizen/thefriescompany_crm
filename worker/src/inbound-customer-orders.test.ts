import assert from "node:assert/strict";
import test from "node:test";
import { handleIncomingCustomerOrder } from "./services/inbound-customer-orders.js";
const message = {
  from: "923001234567@c.us",
  body: "ORDER\nFries | 5\nDELIVERY | 2026-08-25",
  id: { _serialized: "m1" },
};
test("trusted mapped WhatsApp order reaches canonical repository once", async () => {
  let calls = 0;
  const r = await handleIncomingCustomerOrder(
    {
      resolveProducts: async () => [{ id: "p", name: "Fries" }],
      create: async () => {
        calls++;
        return { status: "created", id: "ORD-1" };
      },
    },
    message,
  );
  assert.equal(r.kind, "created");
  assert.equal(calls, 1);
});
test("unknown sender and ambiguous branch do not disclose data", async () => {
  const unknown = await handleIncomingCustomerOrder(
    {
      resolveProducts: async () => [{ id: "p", name: "Fries" }],
      create: async () => ({ status: "unknown_sender" }),
    },
    message,
  );
  assert.equal(unknown.kind, "ignored");
  const ambiguous = await handleIncomingCustomerOrder(
    {
      resolveProducts: async () => [{ id: "p", name: "Fries" }],
      create: async () => ({ status: "ambiguous_branch" }),
    },
    message,
  );
  assert.equal(ambiguous.kind, "ambiguous");
});
