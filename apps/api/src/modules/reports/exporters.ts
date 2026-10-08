import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReportColumn, ReportRow } from './report.types.js';

/** Renders one cell value as plain text (CSV, XLSX and PDF share this). */
export function formatCell(value: unknown, type: ReportColumn['type']): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return type === 'currency' ? value.toFixed(2) : String(Math.round(value * 100) / 100);
  }
  return String(value);
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC-4180-ish CSV. Header uses the human-readable labels. */
export function toCsv(columns: ReportColumn[], rows: ReportRow[]): Buffer {
  const lines = [columns.map((column) => escapeCsv(column.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(formatCell(row[column.key], column.type))).join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

function excelValue(value: unknown, type: ReportColumn['type']): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return type === 'date' ? value : value.toISOString();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (type === 'date') {
    const parsed = new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return String(value);
}

/** ExcelJS workbook with a styled header row and typed cells. */
export async function toXlsx(columns: ReportColumn[], rows: ReportRow[], title = 'Report'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PeopleCore';
  workbook.created = new Date();

  const sheetName = title.slice(0, 31).replace(/[\\/*?:[\]]/g, '') || 'Report';
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(12, Math.min(40, column.label.length + 6)),
    style: column.type === 'date' ? { numFmt: 'yyyy-mm-dd' } : undefined,
  }));

  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
  header.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };

  for (const row of rows) {
    worksheet.addRow(columns.map((column) => excelValue(row[column.key], column.type)));
  }

  if (columns.some((column) => column.type === 'currency')) {
    worksheet.eachRow((row, index) => {
      if (index === 1) return;
      columns.forEach((column, position) => {
        if (column.type === 'currency') row.getCell(position + 1).numFmt = '#,##0.00';
      });
    });
  }

  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, columns.length) } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Landscape A4 table with a header row and page breaks. */
export async function toPdf(
  columns: ReportColumn[],
  rows: ReportRow[],
  title: string,
  subtitle?: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 32,
    bufferPages: true,
    info: { Title: title },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usableWidth = right - left;
  const rowHeight = 18;
  const bottom = doc.page.height - doc.page.margins.bottom - rowHeight;

  // Numeric columns get less room than free-text columns.
  const weights = columns.map((column) => (column.type === 'string' ? 1.6 : 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const widths = weights.map((weight) => (usableWidth * weight) / weightTotal);

  const drawRow = (values: string[], y: number, options: { header?: boolean; zebra?: boolean }) => {
    if (options.zebra) {
      doc.rect(left, y - 3, usableWidth, rowHeight).fill('#f1f5f9');
    }
    doc.font(options.header ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options.header ? 9 : 8)
      .fillColor(options.header ? '#0f172a' : '#334155');

    let x = left;
    values.forEach((value, index) => {
      const width = widths[index] ?? 60;
      const text = truncate(doc, value, width - 8);
      doc.text(text, x + 4, y, { width: width - 8, height: rowHeight, ellipsis: true, lineBreak: false });
      x += width;
    });
  };

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a').text(title, left, doc.page.margins.top, {
    width: usableWidth,
  });
  doc.moveDown(0.2);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#64748b')
    .text(`${subtitle ? `${subtitle} · ` : ''}${rows.length} row(s) · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, {
      width: usableWidth,
    });
  doc.moveDown(0.8);

  let y = doc.y;
  drawRow(columns.map((column) => column.label), y, { header: true });
  y += rowHeight;
  doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#cbd5e1').stroke();

  rows.forEach((row, index) => {
    if (y > bottom) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
      y = doc.page.margins.top;
      drawRow(columns.map((column) => column.label), y, { header: true });
      y += rowHeight;
    }
    drawRow(
      columns.map((column) => formatCell(row[column.key], column.type)),
      y,
      { zebra: index % 2 === 1 },
    );
    y += rowHeight;
  });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#94a3b8')
      .text(`PeopleCore · page ${index + 1} of ${range.count}`, left, doc.page.height - doc.page.margins.bottom + 8, {
        width: usableWidth,
        align: 'center',
      });
  }

  doc.end();
  return finished;
}

function truncate(doc: PDFDocument, value: string, width: number): string {
  if (!value || doc.widthOfString(value) <= width) return value;
  let text = value;
  while (text.length > 1 && doc.widthOfString(`${text}…`) > width) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}
