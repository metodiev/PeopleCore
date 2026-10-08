import type { PaginationMeta } from '@peoplecore/shared';

/** Value types a report column can carry — drives CSV/XLSX/PDF rendering. */
export type ReportColumnType = 'string' | 'number' | 'date' | 'currency';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportRow = Record<string, unknown>;

/** Common payload returned by every report, in every format. */
export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: Record<string, number | string>;
  meta?: PaginationMeta;
}

export interface ReportCatalogEntry {
  type: string;
  name: string;
  description: string;
  /** Permissions required in addition to `reports.view`. */
  permissions: string[];
  /** True when the report contains compensation data. */
  salary: boolean;
}

export type ReportFileFormat = 'json' | 'csv' | 'xlsx' | 'pdf';

export const REPORT_FILE_FORMATS: readonly ReportFileFormat[] = ['json', 'csv', 'xlsx', 'pdf'];

export const FILE_FORMAT_MIME: Readonly<Record<'csv' | 'xlsx' | 'pdf', string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
