/** RFC 4180 quoting plus spreadsheet formula neutralization for untrusted text. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString()
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Keep actual numbers numeric (including negative money); names, emails,
  // phone numbers and other text must never execute when opened in a sheet.
  if (typeof value === "string" && (/^\s*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}
