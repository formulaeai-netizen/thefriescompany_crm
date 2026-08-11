import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseCsvToRecords, toCsv } from "./csv.ts";

test("toCsv produces a header row plus one row per data row, comma-joined", () => {
  const csv = toCsv(
    ["A", "B"],
    [
      [1, "x"],
      [2, "y"],
    ],
  );
  assert.equal(csv, "A,B\r\n1,x\r\n2,y");
});

test("toCsv quotes fields containing commas, quotes, or newlines and escapes embedded quotes", () => {
  const csv = toCsv(["Name"], [["Smith, John"], ['He said "hi"'], ["line1\nline2"]]);
  assert.equal(csv, 'Name\r\n"Smith, John"\r\n"He said ""hi"""\r\n"line1\nline2"');
});

test("toCsv treats null/undefined as an empty field", () => {
  const csv = toCsv(["A", "B"], [[null, undefined]]);
  assert.equal(csv, "A,B\r\n,");
});

test("parseCsv round-trips a simple table", () => {
  const rows = parseCsv("A,B\r\n1,x\r\n2,y");
  assert.deepEqual(rows, [
    ["A", "B"],
    ["1", "x"],
    ["2", "y"],
  ]);
});

test("parseCsv handles quoted fields with embedded commas, quotes, and newlines", () => {
  const rows = parseCsv('Name\r\n"Smith, John"\r\n"He said ""hi"""\r\n"line1\nline2"');
  assert.deepEqual(rows, [["Name"], ["Smith, John"], ['He said "hi"'], ["line1\nline2"]]);
});

test("parseCsv is the exact inverse of toCsv for a round trip", () => {
  const original = [
    ["Invoice No", "Client", "Amount"],
    ["TFC-0126-001", "Acme, Inc.", "1500"],
    ["TFC-0126-002", 'The "Big" Client', "2000"],
  ];
  const csv = toCsv(original[0], original.slice(1));
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed, original);
});

test("parseCsv ignores trailing blank lines", () => {
  const rows = parseCsv("A,B\r\n1,2\r\n\r\n");
  assert.deepEqual(rows, [
    ["A", "B"],
    ["1", "2"],
  ]);
});

test("parseCsvToRecords keys rows by normalized header (lowercased, trimmed, parenthetical stripped)", () => {
  const records = parseCsvToRecords("Client,Weight (kg),Unit Price\r\nAcme,11,1250\r\nBeta,5,1000");
  assert.deepEqual(records, [
    { client: "Acme", weight: "11", "unit price": "1250" },
    { client: "Beta", weight: "5", "unit price": "1000" },
  ]);
});

test("parseCsvToRecords returns an empty array for a header-only or empty file", () => {
  assert.deepEqual(parseCsvToRecords("A,B\r\n"), []);
  assert.deepEqual(parseCsvToRecords(""), []);
});
