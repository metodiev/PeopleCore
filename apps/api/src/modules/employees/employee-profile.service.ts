import { Injectable } from '@nestjs/common';
import type { Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from './scope.service.js';
import { EmployeesService } from './employees.service.js';
import type { BankAccountDto, EducationDto, EmergencyContactDto, LanguageDto, NoteDto, SkillDto } from './dto/employee.dto.js';

export const PROFILE_RESOURCES = [
  'emergency-contacts',
  'bank-accounts',
  'education',
  'skills',
  'languages',
  'notes',
] as const;

export type ProfileResource = (typeof PROFILE_RESOURCES)[number];

const RESOURCE_LABEL: Record<ProfileResource, string> = {
  'emergency-contacts': 'Emergency contact',
  'bank-accounts': 'Bank account',
  education: 'Education record',
  skills: 'Skill',
  languages: 'Language',
  notes: 'Note',
};

/** Sensitive sub-resources need an extra permission on top of profile access. */
const SENSITIVE_RESOURCES: ProfileResource[] = ['bank-accounts', 'notes'];

/**
 * Employee sub-resources: emergency contacts, bank accounts, education,
 * skills, languages and HR notes. Bank account data is encrypted at rest.
 */
@Injectable()
export class EmployeeProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  async list(principal: Principal, employeeId: string, resource: ProfileResource) {
    await this.authorize(principal, employeeId, resource, 'read');
    const db = this.prisma.client;

    switch (resource) {
      case 'emergency-contacts':
        return db.emergencyContact.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
      case 'bank-accounts': {
        const accounts = await db.bankAccount.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } });
        return accounts.map((account) => ({
          ...account,
          iban: this.employees.decryptSafe(account.ibanEnc),
          ibanEnc: undefined,
          ibanMasked: maskIban(this.employees.decryptSafe(account.ibanEnc)),
        }));
      }
      case 'education':
        return db.employeeEducation.findMany({ where: { employeeId }, orderBy: { endYear: 'desc' } });
      case 'skills':
        return db.employeeSkill.findMany({ where: { employeeId }, include: { skill: true } });
      case 'languages':
        return db.employeeLanguage.findMany({ where: { employeeId } });
      case 'notes': {
        const canSeeHrNotes = principal.permissions.includes('employees.edit') || principal.isSuperAdmin;
        return db.employeeNote.findMany({
          where: {
            employeeId,
            ...(canSeeHrNotes
              ? {}
              : {
                  OR: [
                    { visibility: 'MANAGER' as const },
                    { authorId: principal.userId, visibility: 'PRIVATE' as const },
                  ],
                }),
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    }
  }

  async create(principal: Principal, employeeId: string, resource: ProfileResource, payload: unknown) {
    await this.authorize(principal, employeeId, resource, 'write');
    const db = this.prisma.client;

    let created: unknown;
    switch (resource) {
      case 'emergency-contacts': {
        const dto = payload as EmergencyContactDto;
        created = await db.emergencyContact.create({
          data: tenantScoped({
            employeeId,
            name: dto.name,
            relationship: dto.relationship,
            phone: dto.phone,
            email: dto.email,
            isPrimary: dto.isPrimary ?? false,
          }),
        });
        break;
      }
      case 'bank-accounts': {
        const dto = payload as BankAccountDto;
        const encrypted = this.employees.encrypt(dto.iban);
        if (!encrypted) throw new ValidationError('IBAN is required');
        created = await db.bankAccount.create({
          data: tenantScoped({
            employeeId,
            accountHolder: dto.accountHolder,
            ibanEnc: encrypted,
            bic: dto.bic,
            bankName: dto.bankName,
            currency: dto.currency ?? 'EUR',
            isPrimary: dto.isPrimary ?? true,
          }),
        });
        created = { ...(created as object), iban: dto.iban, ibanEnc: undefined };
        break;
      }
      case 'education': {
        const dto = payload as EducationDto;
        created = await db.employeeEducation.create({ data: tenantScoped({ employeeId, ...dto }) });
        break;
      }
      case 'skills': {
        const dto = payload as SkillDto;
        const skill = await db.skill.upsert({
          where: { tenantId_name: { tenantId: this.prisma.currentTenantIdOrThrow(), name: dto.name } },
          create: tenantScoped({ name: dto.name, category: dto.category }),
          update: {},
        });
        created = await db.employeeSkill.upsert({
          where: { employeeId_skillId: { employeeId, skillId: skill.id } },
          create: tenantScoped({ employeeId, skillId: skill.id, level: dto.level, yearsOfExp: dto.yearsOfExp }),
          update: { level: dto.level, yearsOfExp: dto.yearsOfExp },
          include: { skill: true },
        });
        break;
      }
      case 'languages': {
        const dto = payload as LanguageDto;
        created = await db.employeeLanguage.upsert({
          where: { employeeId_language: { employeeId, language: dto.language } },
          create: tenantScoped({ employeeId, language: dto.language, level: dto.level, isNative: dto.isNative ?? false }),
          update: { level: dto.level, isNative: dto.isNative ?? false },
        });
        break;
      }
      case 'notes': {
        const dto = payload as NoteDto;
        created = await db.employeeNote.create({
          data: tenantScoped({
            employeeId,
            authorId: principal.userId,
            body: dto.body,
            visibility: dto.visibility ?? 'HR_ONLY',
          }),
        });
        break;
      }
    }

    await this.audit.record({
      action: `${resource}.create`,
      entityType: RESOURCE_LABEL[resource].replace(/\s/g, ''),
      entityId: extractId(created),
      actorUserId: principal.userId,
      after: redactResource(resource, created),
    });
    return created;
  }

  async update(
    principal: Principal,
    employeeId: string,
    resource: ProfileResource,
    itemId: string,
    payload: unknown,
  ) {
    await this.authorize(principal, employeeId, resource, 'write');
    await this.assertItem(employeeId, resource, itemId);
    const db = this.prisma.client;

    let updated: unknown;
    switch (resource) {
      case 'emergency-contacts': {
        const dto = payload as Partial<EmergencyContactDto>;
        updated = await db.emergencyContact.update({ where: { id: itemId }, data: { ...dto } });
        break;
      }
      case 'bank-accounts': {
        const dto = payload as Partial<BankAccountDto>;
        const { iban, ...rest } = dto;
        updated = await db.bankAccount.update({
          where: { id: itemId },
          data: {
            accountHolder: rest.accountHolder,
            bic: rest.bic,
            bankName: rest.bankName,
            currency: rest.currency,
            isPrimary: rest.isPrimary,
            ...(iban ? { ibanEnc: this.employees.encrypt(iban) ?? undefined } : {}),
          },
        });
        break;
      }
      case 'education':
        updated = await db.employeeEducation.update({ where: { id: itemId }, data: { ...(payload as Partial<EducationDto>) } });
        break;
      case 'skills': {
        const dto = payload as Partial<SkillDto>;
        updated = await db.employeeSkill.update({
          where: { id: itemId },
          data: { level: dto.level, yearsOfExp: dto.yearsOfExp },
          include: { skill: true },
        });
        break;
      }
      case 'languages':
        updated = await db.employeeLanguage.update({
          where: { id: itemId },
          data: { ...(payload as Partial<LanguageDto>) },
        });
        break;
      case 'notes': {
        const dto = payload as Partial<NoteDto>;
        const note = await db.employeeNote.findFirst({ where: { id: itemId } });
        if (!note) throw new NotFoundError('Note', 'NOTE_NOT_FOUND');
        const canEditOthers = principal.permissions.includes('employees.edit') || principal.isSuperAdmin;
        if (note.authorId !== principal.userId && !canEditOthers) {
          throw new ForbiddenError('You can only edit your own notes', 'NOTE_NOT_OWNED');
        }
        updated = await db.employeeNote.update({ where: { id: itemId }, data: { body: dto.body } });
        break;
      }
    }

    await this.audit.record({
      action: `${resource}.update`,
      entityType: RESOURCE_LABEL[resource].replace(/\s/g, ''),
      entityId: itemId,
      actorUserId: principal.userId,
      after: redactResource(resource, updated),
    });
    return updated;
  }

  async remove(principal: Principal, employeeId: string, resource: ProfileResource, itemId: string) {
    await this.authorize(principal, employeeId, resource, 'write');
    await this.assertItem(employeeId, resource, itemId);
    const db = this.prisma.client;

    switch (resource) {
      case 'emergency-contacts':
        await db.emergencyContact.delete({ where: { id: itemId } });
        break;
      case 'bank-accounts':
        await db.bankAccount.delete({ where: { id: itemId } });
        break;
      case 'education':
        await db.employeeEducation.delete({ where: { id: itemId } });
        break;
      case 'skills':
        await db.employeeSkill.delete({ where: { id: itemId } });
        break;
      case 'languages':
        await db.employeeLanguage.delete({ where: { id: itemId } });
        break;
      case 'notes':
        await db.employeeNote.delete({ where: { id: itemId } });
        break;
    }

    await this.audit.record({
      action: `${resource}.delete`,
      entityType: RESOURCE_LABEL[resource].replace(/\s/g, ''),
      entityId: itemId,
      actorUserId: principal.userId,
    });
    return { deleted: true };
  }

  private async authorize(
    principal: Principal,
    employeeId: string,
    resource: ProfileResource,
    mode: 'read' | 'write',
  ): Promise<void> {
    const isSelf = principal.employeeId === employeeId;
    await this.scope.assertEmployeeAccess(principal, employeeId);

    if (isSelf && mode === 'read') return;

    if (mode === 'write' && !principal.permissions.includes('employees.edit') && !principal.isSuperAdmin) {
      throw new ForbiddenError('Editing employee records requires the employees.edit permission', 'PERMISSION_DENIED');
    }

    if (SENSITIVE_RESOURCES.includes(resource)) {
      const allowed =
        principal.isSuperAdmin ||
        principal.permissions.includes('employees.sensitive.view') ||
        principal.permissions.includes('employees.edit');
      if (!allowed) {
        throw new ForbiddenError('This information requires additional permissions', 'SENSITIVE_DATA_FORBIDDEN');
      }
    }
  }

  private async assertItem(employeeId: string, resource: ProfileResource, itemId: string): Promise<void> {
    const db = this.prisma.client;
    const found = await (() => {
      switch (resource) {
        case 'emergency-contacts':
          return db.emergencyContact.findFirst({ where: { id: itemId, employeeId } });
        case 'bank-accounts':
          return db.bankAccount.findFirst({ where: { id: itemId, employeeId } });
        case 'education':
          return db.employeeEducation.findFirst({ where: { id: itemId, employeeId } });
        case 'skills':
          return db.employeeSkill.findFirst({ where: { id: itemId, employeeId } });
        case 'languages':
          return db.employeeLanguage.findFirst({ where: { id: itemId, employeeId } });
        case 'notes':
          return db.employeeNote.findFirst({ where: { id: itemId, employeeId } });
      }
    })();
    if (!found) throw new NotFoundError(RESOURCE_LABEL[resource], 'PROFILE_ITEM_NOT_FOUND');
  }
}

function extractId(value: unknown): string | null {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function redactResource(resource: ProfileResource, value: unknown): unknown {
  if (resource === 'bank-accounts' && value && typeof value === 'object') {
    return { ...(value as object), ibanEnc: '[encrypted]' };
  }
  return value;
}

function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  return `${iban.slice(0, 4)}••••${iban.slice(-4)}`;
}
