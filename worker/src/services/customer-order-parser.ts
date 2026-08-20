export type ParsedCustomerOrder = {
  items: Array<{ productName: string; quantity: number }>;
  requestedDeliveryDate: string;
};

/** Strict, atomic grammar: ORDER, one or more Product | Quantity lines, DELIVERY | YYYY-MM-DD. */
export function parseCustomerOrder(body: string): ParsedCustomerOrder | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3 || !/^ORDER$/i.test(lines[0])) return null;

  const delivery = lines.at(-1)?.match(/^DELIVERY\s*\|\s*(\d{4}-\d{2}-\d{2})$/i);
  if (!delivery || Number.isNaN(new Date(`${delivery[1]}T00:00:00Z`).getTime())) return null;

  const items = lines.slice(1, -1).map((line) => {
    const match = line.match(/^([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)$/);
    if (!match || Number(match[2]) <= 0) return null;
    return { productName: match[1].trim(), quantity: Number(match[2]) };
  });
  if (!items.length || items.some((item) => !item || !item.productName)) return null;
  return { items: items as ParsedCustomerOrder["items"], requestedDeliveryDate: delivery[1] };
}
