// Phase 2: deterministic parser for trusted WhatsApp expense intake.
// No OpenAI, no OCR, no fuzzy/natural-language parsing anywhere in this
// file - every accepted shape matches an exact, documented grammar, and
// anything else is rejected outright rather than guessed at.

export type ParsedExpenseItem = {
  description: string;
  amount: number;
  expenseDate?: string | null;
};

export type ParsedExpenseCommand =
  | { kind: "single"; item: ParsedExpenseItem }
  | { kind: "list"; items: ParsedExpenseItem[]; expenseDate?: string | null };

/** Strips thousands-separator commas and validates the result is a plain positive decimal. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/** A description that is itself purely numeric is rejected - "EXPENSE 2500 700" is ambiguous, never guessed. */
function isValidDescription(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (/^[\d,]+(\.\d+)?$/.test(trimmed)) return false;
  return true;
}

/**
 * Format 1 - single expense: "EXPENSE <amount> <description>".
 * Case-insensitive, tolerant of extra whitespace and comma thousands
 * separators. The description is everything after the amount; it must be
 * non-empty and not itself look like a second amount.
 */
export function parseSingleExpenseCommand(
  rawText: string | null | undefined,
): ParsedExpenseItem | null {
  if (!rawText) return null;
  const normalized = rawText.trim().replace(/\s+/g, " ");
  const match = /^EXPENSE\s+([\d,]+(?:\.\d+)?)\s+(.+)$/i.exec(normalized);
  if (!match) return null;

  const amount = parseAmount(match[1]);
  if (amount === null) return null;

  const description = match[2].trim();
  if (!isValidDescription(description)) return null;

  return { description, amount };
}

const LIST_HEADER_RE = /^EXPENSE\s+LIST$/i;
const NUMBERED_EXPENSE_RE = /^\s*\d+\.\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s*$/;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/**
 * Format 2 - expense list: a first line that deterministically declares
 * list mode ("EXPENSE LIST"), followed by one or more
 * "<description> | <amount>" lines. Every non-empty line after the header
 * must parse cleanly - if even one is malformed, the whole message is
 * rejected (null) so that zero expenses are ever created from a partially
 * valid list.
 */
export function parseExpenseListCommand(
  rawText: string | null | undefined,
): ParsedExpenseItem[] | null {
  if (!rawText) return null;
  const lines = rawText.split(/\r?\n/).map((l) => l.trim());
  if (lines.length === 0) return null;
  if (!LIST_HEADER_RE.test(lines[0])) return null;

  const items: ParsedExpenseItem[] = [];
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue; // blank lines between/after entries are tolerated

    const parts = line.split("|");
    if (parts.length !== 2) return null;

    const description = parts[0].trim();
    const amount = parseAmount(parts[1]);
    if (!isValidDescription(description) || amount === null) return null;

    items.push({ description, amount });
  }

  if (items.length === 0) return null;
  return items;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function parseExpenseReportDate(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const dateLine = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^date\s*:/i.test(line));
  if (!dateLine) return null;

  const rawDate = dateLine.replace(/^date\s*:/i, "").trim();
  const named = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(rawDate);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    const year = Number(named[3]);
    return month ? toIsoDate(year, month, day) : null;
  }

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(rawDate);
  if (numeric) {
    return toIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }

  return null;
}

function parseReportedTotal(rawText: string): number | null {
  const line = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^total\s*:/i.test(l));
  if (!line) return null;
  const match = /^total\s*:\s*([\d,]+(?:\.\d+)?)\s*$/i.exec(line);
  return match ? parseAmount(match[1]) : null;
}

export function looksLikeNumberedExpenseReport(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  return rawText.split(/\r?\n/).some((line) => NUMBERED_EXPENSE_RE.test(line));
}

export function parseNumberedExpenseReport(
  rawText: string | null | undefined,
): ParsedExpenseCommand | null {
  if (!rawText) return null;
  const expenseDate = parseExpenseReportDate(rawText);
  const items: ParsedExpenseItem[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    const match = NUMBERED_EXPENSE_RE.exec(line);
    if (!match) continue;

    const description = match[1].trim();
    const amount = parseAmount(match[2]);
    if (!isValidDescription(description) || amount === null) return null;

    items.push({ description, amount, expenseDate });
  }

  if (items.length === 0) return null;

  const reportedTotal = parseReportedTotal(rawText);
  if (reportedTotal !== null && Math.abs(totalOf(items) - reportedTotal) > 0.001) return null;

  return { kind: "list", items, expenseDate };
}

/** Single entry point: tries list mode first (its header is unambiguous), then single-expense mode. Never both, never a fuzzy fallback. */
export function parseExpenseCommand(
  rawText: string | null | undefined,
): ParsedExpenseCommand | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";

  if (LIST_HEADER_RE.test(firstLine)) {
    const items = parseExpenseListCommand(trimmed);
    return items ? { kind: "list", items } : null;
  }

  const numberedReport = parseNumberedExpenseReport(trimmed);
  if (numberedReport) return numberedReport;

  const single = parseSingleExpenseCommand(trimmed);
  return single ? { kind: "single", item: single } : null;
}

export function totalOf(items: ParsedExpenseItem[]): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}
