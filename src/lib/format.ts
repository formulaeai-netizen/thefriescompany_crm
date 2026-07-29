/** PKR currency formatter. Always "Rs. X,XXX". Never USD. */
export function pkr(n: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  const v = Number(n ?? 0);
  const formatted = v.toLocaleString("en-PK", {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  });
  return `Rs. ${formatted}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const ad = typeof a === "string" ? new Date(a) : a;
  const bd = typeof b === "string" ? new Date(b) : b;
  return Math.floor((bd.getTime() - ad.getTime()) / (1000 * 60 * 60 * 24));
}