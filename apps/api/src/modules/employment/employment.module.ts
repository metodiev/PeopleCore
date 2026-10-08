import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { EmploymentController } from './employment.controller.js';
import { EmploymentService } from './employment.service.js';

@Module({
  imports: [EmployeesModule],
  controllers: [EmploymentController],
  providers: [EmploymentService],
  exports: [EmploymentService],
})
export class EmploymentModule {}
