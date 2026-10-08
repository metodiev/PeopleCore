import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { ACCOUNTING_EXPORT_PORT, CsvAccountingExportAdapter } from './accounting-export.port.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  imports: [EmployeesModule],
  controllers: [ExpensesController],
  providers: [
    ExpensesService,
    // Swap this binding for a real accounting integration (see the port docs).
    { provide: ACCOUNTING_EXPORT_PORT, useClass: CsvAccountingExportAdapter },
  ],
  exports: [ExpensesService],
})
export class ExpensesModule {}
