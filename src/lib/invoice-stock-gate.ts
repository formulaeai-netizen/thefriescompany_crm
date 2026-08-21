import type { AppRole } from "./roles";

export type InvoiceStockLine = {
  product_id: string;
  product: string;
  requested_qty: number;
};

export type FinishedStockAvailability = {
  product_id: string;
  product_name: string;
  available_packets: number;
};

export type InvoiceStockShortage = {
  product_id: string;
  product: string;
  requested_qty: number;
  available_qty: number;
  shortfall_qty: number;
};

const quantity = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

export function calculateInvoiceStockShortages(
  lines: InvoiceStockLine[],
  availability: FinishedStockAvailability[],
): InvoiceStockShortage[] {
  const availableByProduct = new Map(
    availability.map((row) => [row.product_id, quantity(row.available_packets)]),
  );
  const grouped = new Map<string, InvoiceStockLine>();
  for (const line of lines) {
    const current = grouped.get(line.product_id);
    grouped.set(line.product_id, {
      product_id: line.product_id,
      product: line.product,
      requested_qty: quantity(current?.requested_qty) + quantity(line.requested_qty),
    });
  }
  return [...grouped.values()].flatMap((line) => {
    const available = availableByProduct.get(line.product_id) ?? 0;
    if (line.requested_qty <= available) return [];
    return [
      {
        product_id: line.product_id,
        product: line.product,
        requested_qty: line.requested_qty,
        available_qty: available,
        shortfall_qty: line.requested_qty - available,
      },
    ];
  });
}

export function canForceInvoiceStockOverride(role: AppRole) {
  return role === "admin";
}

export function assertInvoiceStockOverride(input: {
  role: AppRole;
  reason: string;
  shortages: InvoiceStockShortage[];
}) {
  if (!canForceInvoiceStockOverride(input.role)) {
    throw new Error("Only an Admin can force-create an invoice with insufficient stock");
  }
  if (!input.reason.trim()) throw new Error("Stock override reason is required");
  if (input.shortages.length === 0) throw new Error("Stock override is not required");
  return true;
}

export function adjustPacketsToAvailable(shortage: InvoiceStockShortage) {
  return quantity(shortage.available_qty);
}

export function invoiceStockOverrideMutatesInventory() {
  return false;
}
