/**
 * ============================================================================
 * CSV EXPORT HELPERS
 * ============================================================================
 *
 * Extracted because four manager pages had each grown their own copy of the same
 * `csvCell` - Commissions, Operations, Subscriptions and DriversList. Four copies
 * of a security-relevant escape is how the fifth one ends up missing the guard.
 *
 * FORMULA INJECTION
 *
 * A cell beginning with = + - or @ is executed as a formula when the file is
 * opened in Excel, Google Sheets or LibreOffice. A driver whose display name is
 * `=HYPERLINK("http://evil","click")` would otherwise become a live link in an
 * operator's spreadsheet. Prefixing with an apostrophe forces the value to be
 * read as text; the apostrophe is not displayed by the spreadsheet.
 * ============================================================================
 */

/** Quote and escape one cell, neutralising any leading formula character. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Build a CSV document from a header row and body rows. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // CRLF: Excel is the dominant consumer and is least surprising with it.
  return lines.join('\r\n');
}
