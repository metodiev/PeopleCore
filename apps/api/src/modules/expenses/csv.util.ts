/**
 * Minimal RFC 4180-style CSV writer: quotes cells that contain the delimiter,
 * quotes or newlines and escapes embedded quotes by doubling them.
 */
export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ','): string {
  return rows
    .map((row) => row.map((cell) => escapeCell(cell, delimiter)).join(delimiter))
    .join('\n');
}

function escapeCell(value: string | number | null | undefined, delimiter: string): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(delimiter) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
