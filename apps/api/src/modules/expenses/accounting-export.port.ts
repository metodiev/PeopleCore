import { Injectable } from '@nestjs/common';
import { toCsv } from './csv.util.js';

/** One expense line as handed to an accounting system. */
export interface AccountingExportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  categoryKey: string;
  categoryName: string;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  expenseDate: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reimbursedAt: string | null;
  reviewNote: string | null;
}

export interface AccountingExportInput {
  tenantId: string;
  /** Expenses to export, already scoped to the caller's visibility. */
  rows: AccountingExportRow[];
  from?: string;
  to?: string;
}

export interface AccountingExportResult {
  filename: string;
  contentType: string;
  /** Serialized document body; `null` when the target system ingests rows itself. */
  body: string;
  rowCount: number;
}

export const ACCOUNTING_EXPORT_PORT = Symbol('ACCOUNTING_EXPORT_PORT');

/**
 * Port for pushing reimbursed expenses into an accounting system.
 *
 * The API ships with a CSV implementation (universally importable); a real
 * integration (DATEV, SAP, QuickBooks, Xero, …) is added by implementing this
 * interface and binding it to {@link ACCOUNTING_EXPORT_PORT} in the module —
 * the expense service only depends on this contract.
 */
export interface AccountingExportPort {
  export(input: AccountingExportInput): Promise<AccountingExportResult>;
}

export const ACCOUNTING_EXPORT_COLUMNS = [
  'expense_id',
  'employee_id',
  'employee_name',
  'category_key',
  'category_name',
  'title',
  'description',
  'amount',
  'currency',
  'expense_date',
  'status',
  'submitted_at',
  'reviewed_at',
  'reimbursed_at',
  'review_note',
] as const;

/** Default `AccountingExportPort`: a UTF-8 CSV export of the given expenses. */
@Injectable()
export class CsvAccountingExportAdapter implements AccountingExportPort {
  async export(input: AccountingExportInput): Promise<AccountingExportResult> {
    const rows = input.rows.map((row) => [
      row.id,
      row.employeeId,
      row.employeeName,
      row.categoryKey,
      row.categoryName,
      row.title,
      row.description,
      row.amount.toFixed(2),
      row.currency,
      row.expenseDate,
      row.status,
      row.submittedAt,
      row.reviewedAt,
      row.reimbursedAt,
      row.reviewNote,
    ]);
    const period = [input.from, input.to].filter(Boolean).join('_');
    return {
      filename: `expenses${period ? `-${period}` : ''}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv([[...ACCOUNTING_EXPORT_COLUMNS], ...rows]),
      rowCount: rows.length,
    };
  }
}
