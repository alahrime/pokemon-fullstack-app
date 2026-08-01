/**
 * Downloading simulation results, for analysis outside the app.
 *
 * TWO FORMATS, DELIBERATELY
 *
 * CSV is the default because every one of these views is already a rectangle —
 * one row per species or per team, fixed columns — and a rectangle is what
 * pandas, R, Excel and a spreadsheet all take without a parsing step. Handing a
 * researcher nested JSON for a table means their first act is to flatten it,
 * and they will flatten it slightly differently every time.
 *
 * JSON is offered alongside for the whole artefact, where the shape is genuinely
 * nested — every tier x category x pass at once — and flattening would either
 * explode the row count or lose the structure that makes the strata comparable.
 *
 * Two formats deliberately NOT used, in case they come up later:
 *   - NDJSON would be right if these were streamed or appended to. They are
 *     built once and read whole, so it buys nothing over JSON here.
 *   - Parquet is the correct answer if this ever outgrows memory — it is
 *     columnar, typed and compresses these repeated string keys extremely well
 *     — but writing it in-browser needs a WASM library, and the largest export
 *     below is a few MB. Not worth the dependency yet.
 *
 * Everything is generated client-side from data already loaded. Nothing is
 * uploaded anywhere.
 */

/** RFC 4180: quote anything containing a delimiter, quote or newline. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows to CSV, with the header taken from the first row's keys.
 *
 * A BOM leads the file because Excel on Windows otherwise reads UTF-8 as the
 * local codepage, which turns every Pokémon accent into mojibake. Costs three
 * bytes and every other tool ignores it.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Hand a generated file to the browser's download machinery.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari
 * cancels a download whose blob URL is revoked in the same tick.
 */
export function download(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export const downloadCsv = (name: string, rows: Record<string, unknown>[]) =>
  download(`${name}.csv`, toCsv(rows), 'text/csv');

export const downloadJson = (name: string, data: unknown) =>
  download(`${name}.json`, JSON.stringify(data, null, 2), 'application/json');

/** A timestamp for filenames, so successive exports do not overwrite. */
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
