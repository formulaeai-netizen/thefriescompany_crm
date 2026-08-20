import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerOrder } from "./services/customer-order-parser.js";

test("parses the supported customer order grammar", () => {
  assert.deepEqual(parseCustomerOrder("ORDER\nFries | 50\nNuggets | 20\nDELIVERY | 2026-08-25"), {
    items: [
      { productName: "Fries", quantity: 50 },
      { productName: "Nuggets", quantity: 20 },
    ],
    requestedDeliveryDate: "2026-08-25",
  });
});

test("rejects malformed order lines atomically", () => {
  assert.equal(
    parseCustomerOrder("ORDER\nFries | 50\nNuggets | zero\nDELIVERY | 2026-08-25"),
    null,
  );
  assert.equal(parseCustomerOrder("ORDER\nFries | 0\nDELIVERY | 2026-08-25"), null);
});
