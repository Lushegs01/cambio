/** Quote every field and prevent spreadsheet evaluation after leading whitespace or controls. */
export function csvCell(value: string): string {
  const safe = /^(?:[\t\r\n]|[\s\uFEFF]*[=+\-@])/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
