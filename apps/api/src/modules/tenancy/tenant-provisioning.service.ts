import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { runWithTenantContext } from '../../prisma/request-context.js';

/** Standard leave types created for every new company. */
const DEFAULT_LEAVE_TYPES = [
  { key: 'VACATION', name: { en: 'Paid leave', bg: 'Платен отпуск' }, isPaid: true, accrual: 'ANNUAL_FIXED', days: 20, color: '#6366f1' },
  { key: 'UNPAID', name: { en: 'Unpaid leave', bg: 'Неплатен отпуск' }, isPaid: false, accrual: 'NONE', days: null, color: '#94a3b8' },
  { key: 'SICK', name: { en: 'Sick leave', bg: 'Болничен' }, isPaid: true, accrual: 'NONE', days: null, color: '#f97316', requiresAttachment: true },
  { key: 'MATERNITY', name: { en: 'Maternity leave', bg: 'Майчинство' }, isPaid: true, accrual: 'NONE', days: null, color: '#ec4899', requiresAttachment: true },
  { key: 'PATERNITY', name: { en: 'Paternity leave', bg: 'Бащинство' }, isPaid: true, accrual: 'NONE', days: 15, color: '#8b5cf6' },
  { key: 'REMOTE_WORK', name: { en: 'Remote work', bg: 'Работа от разстояние' }, isPaid: true, accrual: 'NONE', days: null, color: '#0ea5e9' },
  { key: 'BUSINESS_TRIP', name: { en: 'Business trip', bg: 'Командировка' }, isPaid: true, accrual: 'NONE', days: null, color: '#14b8a6' },
] as const;

const DEFAULT_DOCUMENT_CATEGORIES = [
  { key: 'CONTRACT', name: { en: 'Employment contract', bg: 'Трудов договор' }, requiresExpiry: false },
  { key: 'AMENDMENT', name: { en: 'Contract amendment', bg: 'Допълнително споразумение' }, requiresExpiry: false },
  { key: 'IDENTITY', name: { en: 'Identity document', bg: 'Документ за самоличност' }, requiresExpiry: true },
  { key: 'CERTIFICATE', name: { en: 'Certificate', bg: 'Сертификат' }, requiresExpiry: true },
  { key: 'MEDICAL', name: { en: 'Medical document', bg: 'Медицински документ' }, requiresExpiry: true },
  { key: 'TAX', name: { en: 'Tax document', bg: 'Данъчен документ' }, requiresExpiry: false },
  { key: 'POLICY', name: { en: 'Company policy', bg: 'Вътрешна политика' }, requiresExpiry: false, requiresAcknowledgement: true },
  { key: 'TRAINING', name: { en: 'Training certificate', bg: 'Сертификат за обучение' }, requiresExpiry: true },
] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  { key: 'TRAVEL', name: { en: 'Travel', bg: 'Пътуване' } },
  { key: 'MEALS', name: { en: 'Meals', bg: 'Храна' } },
  { key: 'EQUIPMENT', name: { en: 'Equipment', bg: 'Оборудване' } },
  { key: 'SOFTWARE', name: { en: 'Software', bg: 'Софтуер' } },
  { key: 'TRAINING', name: { en: 'Training', bg: 'Обучение' } },
  { key: 'OTHER', name: { en: 'Other', bg: 'Друго' } },
] as const;

/**
 * Creates the baseline configuration every company needs — leave types,
 * document/expense categories, a default work schedule, the company calendar
 * and system roles. Runs when a tenant is created.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async provision(tenantId: string, locale = 'bg'): Promise<void> {
    const pick = (value: { en: string; bg: string }) => (locale === 'bg' ? value.bg : value.en);
    const year = new Date().getUTCFullYear();

    await this.prisma.forTenant(tenantId, async (db) => {
      await db.tenantPrivacySettings.upsert({
        where: { tenantId },
        create: { tenantId },
        update: {},
      });

      for (const leaveType of DEFAULT_LEAVE_TYPES) {
        await db.leaveType.upsert({
          where: { tenantId_key: { tenantId, key: leaveType.key } },
          create: {
            tenantId,
            key: leaveType.key,
            name: pick(leaveType.name),
            isPaid: leaveType.isPaid,
            accrualType: leaveType.accrual,
            defaultDaysPerYear: leaveType.days ?? undefined,
            requiresAttachment: 'requiresAttachment' in leaveType ? leaveType.requiresAttachment : false,
            color: leaveType.color,
            isSystem: true,
          },
          update: {},
        });
      }

      for (const category of DEFAULT_DOCUMENT_CATEGORIES) {
        await db.documentCategory.upsert({
          where: { tenantId_key: { tenantId, key: category.key } },
          create: {
            tenantId,
            key: category.key,
            name: pick(category.name),
            requiresExpiry: category.requiresExpiry,
            requiresAcknowledgement: 'requiresAcknowledgement' in category ? category.requiresAcknowledgement : false,
            isSystem: true,
          },
          update: {},
        });
      }

      for (const category of DEFAULT_EXPENSE_CATEGORIES) {
        await db.expenseCategory.upsert({
          where: { tenantId_key: { tenantId, key: category.key } },
          create: { tenantId, key: category.key, name: pick(category.name) },
          update: {},
        });
      }

      const existingSchedule = await db.workSchedule.findFirst({ where: { tenantId, isDefault: true } });
      if (!existingSchedule) {
        await db.workSchedule.create({
          data: {
            tenantId,
            name: locale === 'bg' ? 'Стандартен (пн–пт, 9–18)' : 'Standard (Mon–Fri, 9–18)',
            type: 'FIXED',
            workDays: [1, 2, 3, 4, 5],
            startTime: '09:00',
            endTime: '18:00',
            breakMinutes: 60,
            isDefault: true,
          },
        });
      }

      const existingCalendar = await db.calendar.findFirst({ where: { tenantId, type: 'COMPANY' } });
      if (!existingCalendar) {
        await db.calendar.create({
          data: { tenantId, name: locale === 'bg' ? 'Фирмен календар' : 'Company calendar', type: 'COMPANY', isDefault: true },
        });
      }

      const existingPolicy = await db.leavePolicy.findFirst({ where: { tenantId, isDefault: true } });
      if (!existingPolicy) {
        await db.leavePolicy.create({
          data: {
            tenantId,
            name: locale === 'bg' ? 'Стандартна политика' : 'Standard policy',
            approvalChain: [{ type: 'MANAGER' }, { type: 'HR' }],
            minNoticeDays: 0,
            isDefault: true,
          },
        });
      }

      await db.leaveBalance.count({ where: { tenantId, year } }); // warm-up for tenant scoping
    });

    await runWithTenantContext(tenantId, () => this.rbac.ensureTenantRoles(tenantId));
    this.logger.log(`Provisioned tenant ${tenantId}`);
  }
}
