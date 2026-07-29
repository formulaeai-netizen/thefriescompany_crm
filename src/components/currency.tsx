import { cn } from "@/lib/utils";

type Props = {
  value: number | string | null | undefined;
  currency?: string;
  decimals?: number;
  className?: string;
  showSymbol?: boolean;
};

/**
 * Renders a monetary amount in JetBrains Mono with tabular-nums,
 * so all Rs. amounts stay visually consistent across the CRM.
 */
export function Currency({
  value,
  currency = "Rs.",
  decimals = 0,
  className,
  showSymbol = true,
}: Props) {
  const num = typeof value === "string" ? Number(value) : value ?? 0;
  const safe = Number.isFinite(num as number) ? (num as number) : 0;
  const formatted = safe.toLocaleString("en-PK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <span className={cn("currency", className)}>
      {showSymbol ? `${currency} ${formatted}` : formatted}
    </span>
  );
}

export default Currency;