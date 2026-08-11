/** Minimal RFC4180-ish CSV helpers - no external dependency needed for this project's export/import needs. */

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

/** Parses CSV text (including quoted fields with embedded commas/quotes/newlines) into rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnything = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAnything = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnything = true;
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnything = false;
      i++;
      continue;
    }
    field += c;
    sawAnything = true;
    i++;
  }
  if (sawAnything || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank trailing/interior lines (common in exported files).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** Triggers a browser download of the given CSV text. UTF-8 BOM included for Excel compatibility (Rs./PKR symbols). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parses a CSV file's rows into objects keyed by normalized header (lowercased, trimmed, parenthetical suffix stripped). */
export function parseCsvToRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim(),
  );
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      record[h] = (row[idx] ?? "").trim();
    });
    return record;
  });
}
