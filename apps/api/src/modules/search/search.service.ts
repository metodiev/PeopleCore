import { Injectable } from '@nestjs/common';
import type { Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ScopeService } from '../employees/scope.service.js';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from './dto/search.dto.js';

export interface SearchHit {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

export interface SearchGroup {
  type: SearchEntityType;
  count: number;
  items: SearchHit[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  total: number;
}

const DEFAULT_LIMIT = 5;
/**
 * Hard ceiling on rows considered per entity group. Interactive search must
 * stay in the low-millisecond range, so each group is an indexed
 * `contains`/`mode: insensitive` scan capped at this many rows.
 */
const MAX_ROWS_PER_GROUP = 50;

/** Entity group → permission required to see it at all. */
const TYPE_PERMISSIONS: Readonly<Record<SearchEntityType, string>> = {
  employees: 'employees.view',
  departments: 'departments.view',
  documents: 'documents.view',
  requests: 'requests.view',
  assets: 'assets.view',
  leaveRequests: 'leave.view',
  positions: 'positions.view',
};

/**
 * Global search across people, org structure and records.
 *
 * Results are grouped per entity type; groups the caller has no permission for
 * are skipped silently, and people-related groups additionally respect
 * {@link ScopeService} (a manager searches their team, an employee only
 * themselves).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async search(principal: Principal, query: { q: string; types?: SearchEntityType[]; limit?: number }): Promise<SearchResponse> {
    const term = query.q.trim();
    const limit = Math.min(MAX_ROWS_PER_GROUP, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const requested = query.types && query.types.length > 0 ? query.types : [...SEARCH_ENTITY_TYPES];
    const allowed = requested.filter((type) => this.canSearch(principal, type));

    const groups = await Promise.all(allowed.map((type) => this.searchType(principal, type, term, limit)));
    const visible = groups.filter((group) => group.items.length > 0);

    return {
      query: term,
      groups: visible,
      total: visible.reduce((sum, group) => sum + group.items.length, 0),
    };
  }

  private canSearch(principal: Principal, type: SearchEntityType): boolean {
    return principal.isSuperAdmin || principal.permissions.includes(TYPE_PERMISSIONS[type]);
  }

  private async searchType(
    principal: Principal,
    type: SearchEntityType,
    term: string,
    limit: number,
  ): Promise<SearchGroup> {
    switch (type) {
      case 'employees':
        return this.employees(principal, term, limit);
      case 'departments':
        return this.departments(term, limit);
      case 'documents':
        return this.documents(principal, term, limit);
      case 'requests':
        return this.hrRequests(principal, term, limit);
      case 'assets':
        return this.assets(term, limit);
      case 'leaveRequests':
        return this.leaveRequests(principal, term, limit);
      case 'positions':
        return this.positions(term, limit);
      default:
        return { type, count: 0, items: [] };
    }
  }

  private async employees(principal: Principal, term: string, limit: number): Promise<SearchGroup> {
    const where = await this.scope.employeeWhere(principal, {
      OR: [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { preferredName: { contains: term, mode: 'insensitive' } },
        { workEmail: { contains: term, mode: 'insensitive' } },
        { employeeNumber: { contains: term, mode: 'insensitive' } },
      ],
    });

    const rows = await this.prisma.client.employee.findMany({
      where,
      take: limit,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        workEmail: true,
        status: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
      },
    });

    return {
      type: 'employees',
      count: rows.length,
      items: rows.map((employee) => ({
        type: 'employees' as const,
        id: employee.id,
        title: `${employee.firstName} ${employee.lastName}`,
        subtitle: [employee.position?.title, employee.department?.name, employee.employeeNumber]
          .filter(Boolean)
          .join(' · '),
        url: `/employees/${employee.id}`,
      })),
    };
  }

  private async departments(term: string, limit: number): Promise<SearchGroup> {
    const rows = await this.prisma.client.department.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { code: { contains: term, mode: 'insensitive' } },
          { costCenter: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, _count: { select: { employees: true } } },
    });

    return {
      type: 'departments',
      count: rows.length,
      items: rows.map((department) => ({
        type: 'departments' as const,
        id: department.id,
        title: department.name,
        subtitle: `${department._count.employees} employee(s)${department.code ? ` · ${department.code}` : ''}`,
        url: `/departments/${department.id}`,
      })),
    };
  }

  private async documents(principal: Principal, term: string, limit: number): Promise<SearchGroup> {
    const scopeWhere = await this.scope.employeeWhere(principal);
    const scoped = this.scope.visibilityOf(principal) !== 'all';

    const rows = await this.prisma.client.document.findMany({
      where: {
        AND: [
          scoped ? { OR: [{ employeeId: null }, { employee: scopeWhere }] } : {},
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        expiresAt: true,
        category: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      type: 'documents',
      count: rows.length,
      items: rows.map((document) => ({
        type: 'documents' as const,
        id: document.id,
        title: document.name,
        subtitle: [
          document.category?.name,
          document.employee ? `${document.employee.firstName} ${document.employee.lastName}` : 'Company',
          document.status,
        ]
          .filter(Boolean)
          .join(' · '),
        url: `/documents/${document.id}`,
      })),
    };
  }

  private async hrRequests(principal: Principal, term: string, limit: number): Promise<SearchGroup> {
    const scopeWhere = await this.scope.employeeWhere(principal);
    const scoped = this.scope.visibilityOf(principal) !== 'all';

    const rows = await this.prisma.client.hRRequest.findMany({
      where: {
        AND: [
          scoped ? { employee: scopeWhere } : {},
          {
            OR: [
              { subject: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        type: true,
        status: true,
        priority: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      type: 'requests',
      count: rows.length,
      items: rows.map((request) => ({
        type: 'requests' as const,
        id: request.id,
        title: request.subject,
        subtitle: [
          request.type,
          request.status,
          `${request.employee.firstName} ${request.employee.lastName}`,
        ].join(' · '),
        url: `/requests/${request.id}`,
      })),
    };
  }

  private async assets(term: string, limit: number): Promise<SearchGroup> {
    const rows = await this.prisma.client.asset.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { serialNumber: { contains: term, mode: 'insensitive' } },
          { vendor: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
        serialNumber: true,
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      type: 'assets',
      count: rows.length,
      items: rows.map((asset) => ({
        type: 'assets' as const,
        id: asset.id,
        title: asset.name,
        subtitle: [
          asset.category,
          asset.status,
          asset.serialNumber,
          asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        url: `/assets/${asset.id}`,
      })),
    };
  }

  private async leaveRequests(principal: Principal, term: string, limit: number): Promise<SearchGroup> {
    const scopeWhere = await this.scope.employeeWhere(principal);
    const rows = await this.prisma.client.leaveRequest.findMany({
      where: {
        AND: [
          { employee: scopeWhere },
          {
            OR: [
              { reason: { contains: term, mode: 'insensitive' } },
              { leaveType: { name: { contains: term, mode: 'insensitive' } } },
              { employee: { firstName: { contains: term, mode: 'insensitive' } } },
              { employee: { lastName: { contains: term, mode: 'insensitive' } } },
            ],
          },
        ],
      },
      take: limit,
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        daysRequested: true,
        leaveType: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      type: 'leaveRequests',
      count: rows.length,
      items: rows.map((request) => ({
        type: 'leaveRequests' as const,
        id: request.id,
        title: `${request.leaveType.name} · ${request.employee.firstName} ${request.employee.lastName}`,
        subtitle: [
          `${formatDate(request.startDate)} → ${formatDate(request.endDate)}`,
          `${Number(request.daysRequested)} day(s)`,
          request.status,
        ].join(' · '),
        url: `/leave/requests/${request.id}`,
      })),
    };
  }

  private async positions(term: string, limit: number): Promise<SearchGroup> {
    const rows = await this.prisma.client.position.findMany({
      where: {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { code: { contains: term, mode: 'insensitive' } },
          { level: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        level: true,
        department: { select: { name: true } },
        _count: { select: { employees: true } },
      },
    });

    return {
      type: 'positions',
      count: rows.length,
      items: rows.map((position) => ({
        type: 'positions' as const,
        id: position.id,
        title: position.title,
        subtitle: [position.department?.name, position.level, `${position._count.employees} employee(s)`]
          .filter(Boolean)
          .join(' · '),
        url: `/positions/${position.id}`,
      })),
    };
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
