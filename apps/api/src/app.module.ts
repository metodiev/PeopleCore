import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { AuditInterceptor } from './modules/audit/audit.interceptor.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor.js';
import { MailModule } from './modules/mail/mail.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { EmploymentModule } from './modules/employment/employment.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { LeaveModule } from './modules/leave/leave.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StorageModule } from './storage/storage.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { GdprModule } from './modules/gdpr/gdpr.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PerformanceModule } from './modules/performance/performance.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { RequestsModule } from './modules/requests/requests.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { TrainingModule } from './modules/training/training.module.js';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    MailModule,
    StorageModule,
    AuditModule,
    RbacModule,
    AuthModule,
    TenancyModule,
    UsersModule,
    RolesModule,
    OrgModule,
    EmployeesModule,
    EmploymentModule,
    LeaveModule,
    DocumentsModule,
    JobsModule,
    AttendanceModule,
    CalendarModule,
    NotificationsModule,
    IntegrationsModule,
    PerformanceModule,
    TrainingModule,
    ExpensesModule,
    AssetsModule,
    RequestsModule,
    ReportsModule,
    SearchModule,
    DashboardModule,
    GdprModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
