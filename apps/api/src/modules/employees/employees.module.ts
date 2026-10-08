import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { Employee360Service } from './employee-360.service.js';
import { EmployeeProfileService } from './employee-profile.service.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { ScopeService } from './scope.service.js';

@Module({
  imports: [UsersModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeProfileService, Employee360Service, ScopeService],
  exports: [EmployeesService, ScopeService],
})
export class EmployeesModule {}
