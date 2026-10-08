import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from '../src/config/configuration.js';
import { AssetsModule } from '../src/modules/assets/assets.module.js';
import { ExpensesModule } from '../src/modules/expenses/expenses.module.js';
import { PerformanceModule } from '../src/modules/performance/performance.module.js';
import { RequestsModule } from '../src/modules/requests/requests.module.js';
import { TrainingModule } from '../src/modules/training/training.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { runWithTenantContext } from '../src/prisma/request-context.js';
import { tenantScoped } from '../src/prisma/tenant-context.util.js';
import { createHttpClient } from './utils/http-client.js';
import { signUpCompany, type TestContext } from './utils/test-app.js';

/**
 * Boots the API the same way `test-app.ts` does, plus the five HR-operations
 * modules this suite exercises (performance, training, expenses, assets and
 * HR requests) so the suite is self-contained.
 */
async function createHrOpsTestApp(): Promise<TestContext> {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_DRIVER'] = 'pglite';
  process.env['PGLITE_DATA_DIR'] = 'memory';
  process.env['PGLITE_SYNC_TO_FS'] = 'false';
  process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-0123456789-0123456789';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-0123456789-0123456789';
  process.env['ENCRYPTION_KEY'] ??= 'c0R2S1Cq1Zx3qnO0CbQ0Y1C6yXK1l2W3m4N5o6P7q8A=';
  process.env['MAIL_DRIVER'] = 'console';
  process.env['WEB_APP_URL'] = 'http://localhost:5173';
  process.env['LOG_LEVEL'] = 'error';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, PerformanceModule, TrainingModule, ExpensesModule, AssetsModule, RequestsModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.init();

  // macOS caps Unix socket paths at ~104 characters — keep the name short.
  const socketPath = join(tmpdir(), `pc-hr-${randomUUID().slice(0, 8)}.sock`);
  await app.listen(socketPath);

  return {
    app,
    http: createHttpClient(socketPath),
    config,
    close: async () => {
      await app.close();
      await rm(socketPath, { force: true }).catch(() => undefined);
    },
  };
}

describe('HR operations (e2e)', () => {
  let context: TestContext;
  let adminToken: string;
  let adminUserId: string;
  let tenantId: string;
  let employeeId: string;
  let employeeToken: string;
  let managerId: string;

  const auth = () => ({ token: adminToken });
  const asEmployee = () => ({ token: employeeToken });

  beforeAll(async () => {
    context = await createHrOpsTestApp();
    const company = await signUpCompany(context.http);
    adminToken = company.token;
    adminUserId = company.userId;
    tenantId = company.tenantId;
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('creates the test org (manager + employee with a login)', async () => {
    const manager = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Mila',
        lastName: 'Boss',
        workEmail: `boss-${Date.now()}@example.com`,
        hireDate: '2023-01-10',
        createUserAccount: true,
        roleKeys: ['MANAGER'],
      },
      auth(),
    );
    expect(manager.status).toBe(201);
    managerId = manager.body.id;

    const employeeEmail = `eva-${Date.now()}@example.com`;
    const employee = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Eva',
        lastName: 'Worker',
        workEmail: employeeEmail,
        hireDate: '2024-05-01',
        managerId,
        createUserAccount: true,
        roleKeys: ['EMPLOYEE'],
      },
      auth(),
    );
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;

    const users = await context.http.get<{ data: { id: string; email: string }[] }>(
      `/api/v1/users?search=${encodeURIComponent(employeeEmail)}`,
      auth(),
    );
    const employeeUser = users.body.data.find((candidate) => candidate.email === employeeEmail);
    expect(employeeUser).toBeDefined();

    const password = 'Employee-Passw0rd!23';
    const reset = await context.http.patch(`/api/v1/users/${employeeUser!.id}`, { password }, auth());
    expect(reset.status).toBe(200);

    const login = await context.http.post<{ tokens: { accessToken: string } }>('/api/v1/auth/login', {
      email: employeeEmail,
      password,
    });
    expect(login.status).toBe(200);
    employeeToken = login.body.tokens.accessToken;

    const me = await context.http.get<{ id: string }>('/api/v1/employees/me', asEmployee());
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(employeeId);
  }, 120_000);

  // ── Expenses ──────────────────────────────────────────────────────────────

  describe('expenses', () => {
    let travelCategoryId: string;
    let mealCategoryId: string;
    let expenseId: string;

    it('enforces the category amount limit and the receipt requirement', async () => {
      // Every new company is provisioned with standard expense categories.
      const seeded = await context.http.get<{ data: { id: string; key: string }[] }>('/api/v1/expenses/categories', auth());
      expect(seeded.status).toBe(200);
      travelCategoryId = seeded.body.data.find((category) => category.key === 'TRAVEL')!.id;
      mealCategoryId = seeded.body.data.find((category) => category.key === 'MEALS')!.id;

      const travel = await context.http.patch<{ id: string }>(
        `/api/v1/expenses/categories/${travelCategoryId}`,
        { requiresReceipt: true, maxAmount: 500 },
        auth(),
      );
      expect(travel.status).toBe(200);
      travelCategoryId = travel.body.id;

      const meals = await context.http.patch<{ id: string }>(
        `/api/v1/expenses/categories/${mealCategoryId}`,
        { requiresReceipt: false, maxAmount: 100 },
        auth(),
      );
      expect(meals.status).toBe(200);
      mealCategoryId = meals.body.id;

      const categories = await context.http.get<{ data: { id: string; maxAmount: number; requiresReceipt: boolean }[] }>(
        '/api/v1/expenses/categories',
        auth(),
      );
      expect(categories.status).toBe(200);
      const mealsRow = categories.body.data.find((row) => row.id === mealCategoryId)!;
      expect(mealsRow.maxAmount).toBe(100);
      expect(mealsRow.requiresReceipt).toBe(false);

      const overLimit = await context.http.post<{ error: { code: string; details: { code: string } } }>(
        '/api/v1/expenses',
        { categoryId: travelCategoryId, title: 'Flight to Berlin', amount: 900, expenseDate: '2026-03-02', employeeId },
        auth(),
      );
      expect(overLimit.status).toBe(400);
      expect(overLimit.body.error.details.code).toBe('CATEGORY_LIMIT_EXCEEDED');

      const withoutReceipt = await context.http.post<{ error: { details: { code: string } } }>(
        '/api/v1/expenses',
        { categoryId: travelCategoryId, title: 'Taxi', amount: 40, expenseDate: '2026-03-02', employeeId },
        auth(),
      );
      expect(withoutReceipt.status).toBe(400);
      expect(withoutReceipt.body.error.details.code).toBe('RECEIPT_REQUIRED');
    });

    it('files, approves and reimburses an expense', async () => {
      const receiptDocumentId = await createReceiptDocument();
      const created = await context.http.post<{ id: string; status: string; amount: number }>(
        '/api/v1/expenses',
        {
          categoryId: travelCategoryId,
          title: 'Hotel — Berlin',
          description: 'Two nights',
          amount: 240.5,
          currency: 'EUR',
          expenseDate: '2026-03-03',
          employeeId,
          receiptDocumentId,
        },
        auth(),
      );
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('DRAFT');
      expect(created.body.amount).toBe(240.5);
      expenseId = created.body.id;

      const approvedBeforeSubmit = await context.http.post<{ error: { code: string } }>(
        `/api/v1/expenses/${expenseId}/approve`,
        {},
        auth(),
      );
      expect(approvedBeforeSubmit.status).toBe(409);

      const submitted = await context.http.post<{ status: string }>(`/api/v1/expenses/${expenseId}/submit`, {}, auth());
      expect(submitted.status).toBe(201);
      expect(submitted.body.status).toBe('SUBMITTED');

      const approved = await context.http.post<{ status: string; reviewNote: string }>(
        `/api/v1/expenses/${expenseId}/approve`,
        { reviewNote: 'Approved — within policy' },
        auth(),
      );
      expect(approved.status).toBe(201);
      expect(approved.body.status).toBe('APPROVED');

      const reimbursed = await context.http.post<{ status: string }>(
        `/api/v1/expenses/${expenseId}/reimburse`,
        { reviewNote: 'Paid with the March payroll' },
        auth(),
      );
      expect(reimbursed.status).toBe(201);
      expect(reimbursed.body.status).toBe('REIMBURSED');

      const list = await context.http.get<{ data: { id: string; status: string }[] }>(
        `/api/v1/expenses?employeeId=${employeeId}&status=REIMBURSED`,
        auth(),
      );
      expect(list.status).toBe(200);
      expect(list.body.data.some((expense) => expense.id === expenseId)).toBe(true);
    });

    it('the employee sees only their own expenses', async () => {
      const list = await context.http.get<{ data: { id: string }[] }>('/api/v1/expenses', {
        token: employeeToken,
      });
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]!.id).toBe(expenseId);
    });

    it('summarises totals and exports approved/reimbursed expenses as CSV', async () => {
      const summary = await context.http.get<{
        byStatus: { status: string; total: number; count: number; currency: string }[];
        byCategory: { categoryKey: string; total: number }[];
      }>(`/api/v1/expenses/summary?from=2026-03-01&to=2026-03-31&employeeId=${employeeId}`, auth());
      expect(summary.status).toBe(200);
      const reimbursed = summary.body.byStatus.find((row) => row.status === 'REIMBURSED');
      expect(reimbursed?.total).toBe(240.5);
      expect(summary.body.byCategory.find((row) => row.categoryKey === 'TRAVEL')?.total).toBe(240.5);

      const exported = await context.http.post<{
        filename: string;
        contentType: string;
        rowCount: number;
        body: string;
      }>('/api/v1/expenses/export', { to: '2026-03-31' }, auth());
      expect(exported.status).toBe(201);
      expect(exported.body.contentType).toContain('text/csv');
      expect(exported.body.rowCount).toBeGreaterThanOrEqual(1);
      const lines = exported.body.body.split('\n');
      expect(lines[0]).toContain('expense_id');
      expect(lines.some((line) => line.includes('Hotel — Berlin') && line.includes('REIMBURSED'))).toBe(true);
    });
  });

  // ── Assets ────────────────────────────────────────────────────────────────

  describe('assets', () => {
    let assetId: string;

    it('assigns an asset to the employee and returns it', async () => {
      const asset = await context.http.post<{ id: string; status: string; serialNumber: string }>(
        '/api/v1/assets',
        {
          category: 'LAPTOP',
          name: 'MacBook Pro 14"',
          serialNumber: `MBP-${Date.now()}`,
          vendor: 'Apple',
          purchaseDate: '2026-01-15',
          purchaseCost: 2399,
          currency: 'EUR',
          warrantyEndDate: '2028-01-15',
        },
        auth(),
      );
      expect(asset.status).toBe(201);
      expect(asset.body.status).toBe('AVAILABLE');
      assetId = asset.body.id;

      const duplicateSerial = await context.http.post(
        '/api/v1/assets',
        { category: 'LAPTOP', name: 'Twin', serialNumber: asset.body.serialNumber },
        auth(),
      );
      expect(duplicateSerial.status).toBe(409);

      const assigned = await context.http.post<{
        status: string;
        assignedToId: string;
        assignedAt: string;
        condition: string;
      }>(`/api/v1/assets/${assetId}/assign`, { employeeId, condition: 'NEW', notes: 'Handed over in the office' }, auth());
      expect(assigned.status).toBe(201);
      expect(assigned.body.status).toBe('ASSIGNED');
      expect(assigned.body.assignedToId).toBe(employeeId);
      expect(assigned.body.assignedAt).not.toBeNull();

      const detail = await context.http.get<{ status: string; assignments: { returnedAt: string | null }[] }>(
        `/api/v1/assets/${assetId}`,
        auth(),
      );
      expect(detail.body.assignments).toHaveLength(1);
      expect(detail.body.assignments[0]!.returnedAt).toBeNull();

      const mine = await context.http.get<{ current: { id: string }[]; history: { id: string }[] }>(
        `/api/v1/assets/employee/${employeeId}`,
        asEmployee(),
      );
      expect(mine.status).toBe(200);
      expect(mine.body.current.map((row) => row.id)).toContain(assetId);
      expect(mine.body.history).toHaveLength(1);

      const returned = await context.http.post<{ status: string; assignedToId: string | null }>(
        `/api/v1/assets/${assetId}/return`,
        { condition: 'GOOD', notes: 'Returned on time' },
        auth(),
      );
      expect(returned.status).toBe(201);
      expect(returned.body.status).toBe('AVAILABLE');
      expect(returned.body.assignedToId).toBeNull();

      const closed = await context.http.get<{ assignments: { returnedAt: string | null; conditionAtReturn: string }[] }>(
        `/api/v1/assets/${assetId}`,
        auth(),
      );
      expect(closed.status).toBe(200);
      expect(closed.body.assignments[0]!.returnedAt).not.toBeNull();
      expect(closed.body.assignments[0]!.conditionAtReturn).toBe('GOOD');
    });

    it('reports the inventory dashboard', async () => {
      const dashboard = await context.http.get<{
        total: number;
        byStatus: Record<string, number>;
        byCategory: Record<string, number>;
        warrantyExpiring: unknown[];
      }>('/api/v1/assets/dashboard', auth());
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.total).toBeGreaterThanOrEqual(1);
      expect(dashboard.body.byStatus['AVAILABLE']).toBeGreaterThanOrEqual(1);
      expect(dashboard.body.byCategory['LAPTOP']).toBeGreaterThanOrEqual(1);
    });
  });

  // ── HR requests ───────────────────────────────────────────────────────────

  describe('HR requests', () => {
    let requestId: string;

    it('raises a ticket, comments on it, assigns and resolves it', async () => {
      const created = await context.http.post<{ id: string; status: string; priority: string }>(
        '/api/v1/requests',
        {
          type: 'CERTIFICATE',
          subject: 'Employment certificate for the bank',
          description: 'I need a signed certificate stating my position and salary.',
          priority: 'HIGH',
        },
        asEmployee(),
      );
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('OPEN');
      requestId = created.body.id;

      const internalAttempt = await context.http.post<{ error: { code: string } }>(
        `/api/v1/requests/${requestId}/comments`,
        { body: 'HR-only note attempt', isInternal: true },
        asEmployee(),
      );
      expect(internalAttempt.status).toBe(403);
      expect(internalAttempt.body.error.code).toBe('REQUEST_INTERNAL_COMMENT_DENIED');

      const publicComment = await context.http.post<{ isInternal: boolean }>(
        `/api/v1/requests/${requestId}/comments`,
        { body: 'Could you confirm how long it takes?' },
        asEmployee(),
      );
      expect(publicComment.status).toBe(201);
      expect(publicComment.body.isInternal).toBe(false);

      const internalComment = await context.http.post<{ isInternal: boolean }>(
        `/api/v1/requests/${requestId}/comments`,
        { body: 'Checked with payroll — salary confirmation attached.', isInternal: true },
        auth(),
      );
      expect(internalComment.status).toBe(201);
      expect(internalComment.body.isInternal).toBe(true);

      const employeeView = await context.http.get<{ comments: { isInternal: boolean }[] }>(
        `/api/v1/requests/${requestId}`,
        asEmployee(),
      );
      expect(employeeView.status).toBe(200);
      expect(employeeView.body.comments).toHaveLength(1);
      expect(employeeView.body.comments[0]!.isInternal).toBe(false);

      const hrView = await context.http.get<{ comments: { isInternal: boolean; author: { id: string } | null }[] }>(
        `/api/v1/requests/${requestId}`,
        auth(),
      );
      expect(hrView.body.comments).toHaveLength(2);
      expect(hrView.body.comments.every((comment) => comment.author !== null)).toBe(true);

      const inbox = await context.http.get<{ data: { id: string }[] }>('/api/v1/requests/inbox?unassigned=true', auth());
      expect(inbox.status).toBe(200);
      expect(inbox.body.data.map((row) => row.id)).toContain(requestId);

      const assigned = await context.http.post<{ status: string; assigneeId: string }>(
        `/api/v1/requests/${requestId}/assign`,
        { assigneeId: adminUserId },
        auth(),
      );
      expect(assigned.status).toBe(201);
      expect(assigned.body.status).toBe('IN_PROGRESS');
      expect(assigned.body.assigneeId).toBe(adminUserId);

      const resolved = await context.http.post<{ status: string; resolution: string; resolvedAt: string }>(
        `/api/v1/requests/${requestId}/status`,
        { status: 'RESOLVED', resolution: 'Certificate signed and sent to your work email.' },
        auth(),
      );
      expect(resolved.status).toBe(201);
      expect(resolved.body.status).toBe('RESOLVED');
      expect(resolved.body.resolvedAt).not.toBeNull();
    });

    it('reports SLA statistics', async () => {
      const second = await context.http.post<{ id: string }>(
        '/api/v1/requests',
        { type: 'IT', subject: 'VPN access', description: 'I cannot reach the VPN from home.', priority: 'URGENT' },
        asEmployee(),
      );
      expect(second.status).toBe(201);

      const stats = await context.http.get<{
        open: number;
        openByType: Record<string, number>;
        openByPriority: Record<string, number>;
        resolved: number;
        averageResolutionHours: number | null;
        oldestOpen: { id: string; ageHours: number } | null;
      }>('/api/v1/requests/stats', auth());
      expect(stats.status).toBe(200);
      expect(stats.body.open).toBe(1);
      expect(stats.body.openByType['IT']).toBe(1);
      expect(stats.body.openByPriority['URGENT']).toBe(1);
      expect(stats.body.resolved).toBe(1);
      expect(stats.body.averageResolutionHours).toBeGreaterThanOrEqual(0);
      expect(stats.body.oldestOpen?.id).toBe(second.body.id);
      expect(stats.body.oldestOpen!.ageHours).toBeGreaterThanOrEqual(0);
    });

    it('lets the employee cancel their own ticket but not read someone else’s', async () => {
      const created = await context.http.post<{ id: string }>(
        '/api/v1/requests',
        { type: 'DOCUMENT', subject: 'Copy of my contract', description: 'Please send me a copy.' },
        asEmployee(),
      );
      expect(created.status).toBe(201);

      const cancelled = await context.http.post<{ status: string }>(
        `/api/v1/requests/${created.body.id}/cancel`,
        {},
        asEmployee(),
      );
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.status).toBe('CANCELLED');

      const colleaguesTicket = await context.http.post<{ id: string }>(
        '/api/v1/requests',
        {
          type: 'PAYROLL',
          subject: 'Payslip question',
          description: 'Please clarify the overtime line on my payslip.',
          employeeId: managerId,
        },
        auth(),
      );
      expect(colleaguesTicket.status).toBe(201);

      const forbidden = await context.http.get<{ error: { code: string } }>(
        `/api/v1/requests/${colleaguesTicket.body.id}`,
        asEmployee(),
      );
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('REQUEST_SCOPE_DENIED');
    });
  });

  // ── Performance ───────────────────────────────────────────────────────────

  describe('performance', () => {
    let cycleId: string;
    let managerReviewId: string;
    let selfReviewId: string;

    it('creates and activates a review cycle with self and manager reviews', async () => {
      const cycle = await context.http.post<{ id: string; status: string; includesPeerReview: boolean }>(
        '/api/v1/performance/cycles',
        {
          name: `H1 2026 ${Date.now()}`,
          description: 'Mid-year review',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
          includesSelfReview: true,
          includesPeerReview: true,
        },
        auth(),
      );
      expect(cycle.status).toBe(201);
      expect(cycle.body.status).toBe('DRAFT');
      cycleId = cycle.body.id;

      const activated = await context.http.post<{ status: string }>(`/api/v1/performance/cycles/${cycleId}/activate`, {}, auth());
      expect(activated.status).toBe(201);
      expect(activated.body.status).toBe('ACTIVE');

      const managerReview = await context.http.post<{ id: string; status: string; reviewerId: string; type: string }>(
        '/api/v1/performance/reviews',
        { cycleId, employeeId, reviewerId: managerId, type: 'MANAGER' },
        auth(),
      );
      expect(managerReview.status).toBe(201);
      expect(managerReview.body.status).toBe('PENDING');
      expect(managerReview.body.reviewerId).toBe(managerId);
      managerReviewId = managerReview.body.id;

      const selfReview = await context.http.post<{ id: string; reviewerId: string; type: string }>(
        '/api/v1/performance/reviews',
        { cycleId, employeeId, type: 'SELF' },
        auth(),
      );
      expect(selfReview.status).toBe(201);
      expect(selfReview.body.type).toBe('SELF');
      // A self review is owned by the reviewed employee.
      expect(selfReview.body.reviewerId).toBe(employeeId);
      selfReviewId = selfReview.body.id;

      const duplicate = await context.http.post(
        '/api/v1/performance/reviews',
        { cycleId, employeeId, reviewerId: managerId, type: 'MANAGER' },
        auth(),
      );
      expect(duplicate.status).toBe(409);
    });

    it('submits the manager review and lets the employee acknowledge it', async () => {
      const submitted = await context.http.patch<{ status: string; overallRating: number }>(
        `/api/v1/performance/reviews/${managerReviewId}`,
        {
          overallRating: 4.5,
          summary: 'Strong delivery on the migration project.',
          strengths: 'Ownership, communication with stakeholders.',
          improvements: 'Delegate earlier.',
        },
        auth(),
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe('SUBMITTED');
      expect(submitted.body.overallRating).toBe(4.5);

      const acknowledged = await context.http.post<{ status: string; acknowledgedAt: string }>(
        `/api/v1/performance/reviews/${managerReviewId}/acknowledge`,
        {},
        asEmployee(),
      );
      expect(acknowledged.status).toBe(201);
      expect(acknowledged.body.status).toBe('ACKNOWLEDGED');
      expect(acknowledged.body.acknowledgedAt).not.toBeNull();

      const mine = await context.http.get<{ data: { id: string; status: string }[] }>(
        '/api/v1/performance/reviews?mineAsSubject=true',
        asEmployee(),
      );
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((review) => review.id).sort()).toEqual([managerReviewId, selfReviewId].sort());
    });

    it('lets the employee write their own self review', async () => {
      const submitted = await context.http.patch<{ status: string }>(
        `/api/v1/performance/reviews/${selfReviewId}`,
        { overallRating: 4, summary: 'I grew into the platform role this half.' },
        asEmployee(),
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe('SUBMITTED');
    });

    it('manages goals, key results and progress', async () => {
      const goal = await context.http.post<{ id: string; type: string; status: string; progress: number }>(
        '/api/v1/performance/goals',
        {
          title: 'Ship the reporting module',
          type: 'OKR',
          priority: 'HIGH',
          dueDate: '2026-06-30',
          keyResults: [{ title: 'Deliver 5 report types', targetValue: 5, currentValue: 0, unit: 'reports' }],
        },
        asEmployee(),
      );
      expect(goal.status).toBe(201);
      expect(goal.body.type).toBe('OKR');
      expect(goal.body.progress).toBe(0);
      const goalId = goal.body.id;

      const keyResults = await context.http.get<{ keyResults: { id: string }[] }>(
        `/api/v1/performance/goals/${goalId}`,
        asEmployee(),
      );
      const keyResultId = keyResults.body.keyResults[0]!.id;

      const updated = await context.http.patch<{
        currentValue: number;
        progress: number;
        goalProgress: number;
      }>(`/api/v1/performance/key-results/${keyResultId}`, { currentValue: 4 }, asEmployee());
      expect(updated.status).toBe(200);
      expect(updated.body.progress).toBe(80);
      expect(updated.body.goalProgress).toBe(80);

      const progress = await context.http.patch<{ progress: number; status: string }>(
        `/api/v1/performance/goals/${goalId}/progress`,
        { progress: 100 },
        asEmployee(),
      );
      expect(progress.status).toBe(200);
      expect(progress.body.progress).toBe(100);
      expect(progress.body.status).toBe('COMPLETED');

      // A manager may not create goals for an employee they do not manage.
      const otherTeam = await context.http.post<{ id: string }>(
        '/api/v1/performance/goals',
        { title: 'Quarterly KPI', type: 'KPI', employeeId: managerId },
        asEmployee(),
      );
      expect(otherTeam.status).toBe(403);
    });

    it('applies the feedback visibility rules', async () => {
      const visible = await context.http.post<{ id: string }>(
        '/api/v1/performance/feedback',
        {
          subjectEmployeeId: employeeId,
          message: 'Great support during the audit.',
          type: 'PRAISE',
          visibility: 'EMPLOYEE',
        },
        auth(),
      );
      expect(visible.status).toBe(201);

      const hrOnly = await context.http.post<{ id: string }>(
        '/api/v1/performance/feedback',
        {
          subjectEmployeeId: employeeId,
          message: 'Retention risk — discuss growth path.',
          type: 'CONCERN',
          visibility: 'HR_ONLY',
          isAnonymous: true,
        },
        auth(),
      );
      expect(hrOnly.status).toBe(201);

      const employeeFeedback = await context.http.get<{ data: { id: string; authorUserId: string | null }[] }>(
        `/api/v1/performance/feedback?employeeId=${employeeId}`,
        asEmployee(),
      );
      expect(employeeFeedback.status).toBe(200);
      expect(employeeFeedback.body.data.map((entry) => entry.id)).toEqual([visible.body.id]);

      const hrFeedback = await context.http.get<{ data: { id: string; authorUserId: string | null }[] }>(
        `/api/v1/performance/feedback?employeeId=${employeeId}`,
        auth(),
      );
      expect(hrFeedback.body.data.map((entry) => entry.id).sort()).toEqual([visible.body.id, hrOnly.body.id].sort());
      // HR is the only role that sees who wrote anonymous feedback.
      expect(hrFeedback.body.data.find((entry) => entry.id === hrOnly.body.id)!.authorUserId).toBe(adminUserId);
    });

    it('summarises the performance dashboard', async () => {
      const dashboard = await context.http.get<{
        activeCycles: { id: string }[];
        pendingReviews: number;
        averageRating: number | null;
        goals: { total: number; byStatus: Record<string, number>; overdue: number };
      }>('/api/v1/performance/dashboard', auth());
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.activeCycles.map((cycle) => cycle.id)).toContain(cycleId);
      expect(dashboard.body.averageRating).toBe(4.25); // (4.5 + 4.0) / 2
      expect(dashboard.body.goals.byStatus['COMPLETED']).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Training ──────────────────────────────────────────────────────────────

  describe('training', () => {
    let courseId: string;
    let assignmentId: string;

    it('assigns a course and completes it with a score', async () => {
      const skill = await context.http.post<{ id: string; name: string }>(
        '/api/v1/training/skills',
        { name: `Kubernetes-${Date.now()}`, category: 'Engineering' },
        auth(),
      );
      expect(skill.status).toBe(201);

      const course = await context.http.post<{ id: string; skills: { id: string }[]; validityMonths: number }>(
        '/api/v1/training/courses',
        {
          title: `Security awareness ${Date.now()}`,
          description: 'Annual mandatory training',
          provider: 'Internal Academy',
          category: 'Compliance',
          durationHours: 2,
          isRequired: true,
          validityMonths: 12,
          skillIds: [skill.body.id],
        },
        auth(),
      );
      expect(course.status).toBe(201);
      expect(course.body.skills.map((linked) => linked.id)).toEqual([skill.body.id]);
      courseId = course.body.id;

      const assignment = await context.http.post<{ assignments: number; assignmentIds: string[] }>(
        '/api/v1/training/assignments',
        { employeeIds: [employeeId], courseId, dueDate: '2026-12-31' },
        auth(),
      );
      expect(assignment.status).toBe(201);
      expect(assignment.body.assignments).toBe(1);
      assignmentId = assignment.body.assignmentIds[0]!;

      const employeeAssignments = await context.http.get<{ data: { id: string; status: string; isOverdue: boolean }[] }>(
        '/api/v1/training/assignments',
        asEmployee(),
      );
      expect(employeeAssignments.status).toBe(200);
      expect(employeeAssignments.body.data).toHaveLength(1);
      expect(employeeAssignments.body.data[0]!.status).toBe('ASSIGNED');
      expect(employeeAssignments.body.data[0]!.isOverdue).toBe(false);

      const started = await context.http.patch<{ status: string; startedAt: string }>(
        `/api/v1/training/assignments/${assignmentId}`,
        { status: 'IN_PROGRESS' },
        asEmployee(),
      );
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('IN_PROGRESS');
      expect(started.body.startedAt).not.toBeNull();

      const completed = await context.http.patch<{ status: string; score: number; completedAt: string; certificationId: string | null }>(
        `/api/v1/training/assignments/${assignmentId}`,
        { status: 'COMPLETED', score: 92.5, notes: 'Passed with distinction' },
        asEmployee(),
      );
      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('COMPLETED');
      expect(completed.body.score).toBe(92.5);
      expect(completed.body.completedAt).not.toBeNull();
      // Courses with a validity period issue a certification on completion.
      expect(completed.body.certificationId).not.toBeNull();
    });

    it('tracks certifications and the training dashboard', async () => {
      const certifications = await context.http.get<{ data: { status: string; name: string }[] }>(
        `/api/v1/training/certifications?employeeId=${employeeId}`,
        auth(),
      );
      expect(certifications.status).toBe(200);
      expect(certifications.body.data).toHaveLength(1);
      expect(certifications.body.data[0]!.status).toBe('VALID');

      const expiring = await context.http.get<unknown[]>('/api/v1/training/certifications/expiring?days=30', auth());
      expect(expiring.status).toBe(200);
      expect(expiring.body).toHaveLength(0);

      const dashboard = await context.http.get<{
        assignments: { COMPLETED: number; IN_PROGRESS: number; overdue: number; total: number };
        certifications: { VALID: number };
        completionRate: number;
      }>('/api/v1/training/dashboard', auth());
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.assignments.COMPLETED).toBe(1);
      expect(dashboard.body.assignments.overdue).toBe(0);
      expect(dashboard.body.certifications.VALID).toBe(1);
      expect(dashboard.body.completionRate).toBe(100);
    });

    it('runs a learning plan to completion', async () => {
      const plan = await context.http.post<{ id: string; status: string }>(
        '/api/v1/training/plans',
        { employeeId, name: 'Platform onboarding path', targetDate: '2026-09-30' },
        auth(),
      );
      expect(plan.status).toBe(201);

      const item = await context.http.post<{ id: string; courseId: string }>(
        `/api/v1/training/plans/${plan.body.id}/items`,
        { courseId, order: 1 },
        auth(),
      );
      expect(item.status).toBe(201);

      const incomplete = await context.http.post<{ error: { details: { code: string } } }>(
        `/api/v1/training/plans/${plan.body.id}/complete`,
        {},
        auth(),
      );
      expect(incomplete.status).toBe(400);
      expect(incomplete.body.error.details.code).toBe('PLAN_INCOMPLETE');

      const itemDone = await context.http.patch<{ status: string; completedAt: string }>(
        `/api/v1/training/plans/items/${item.body.id}`,
        { status: 'COMPLETED' },
        asEmployee(),
      );
      expect(itemDone.status).toBe(200);
      expect(itemDone.body.status).toBe('COMPLETED');

      const completed = await context.http.post<{ status: string }>(
        `/api/v1/training/plans/${plan.body.id}/complete`,
        {},
        auth(),
      );
      expect(completed.status).toBe(201);
      expect(completed.body.status).toBe('COMPLETED');

      const plans = await context.http.get<{ data: { id: string; progress: number; status: string }[] }>(
        `/api/v1/training/plans?employeeId=${employeeId}`,
        auth(),
      );
      expect(plans.status).toBe(200);
      expect(plans.body.data[0]!.progress).toBe(100);
    });

    it('flags overdue assignments as expired', async () => {
      const overdue = await context.http.post<{ assignments: number }>(
        '/api/v1/training/assignments',
        { employeeIds: [managerId], courseId, dueDate: '2026-01-15' },
        auth(),
      );
      expect(overdue.status).toBe(201);

      const list = await context.http.get<{ data: { employee: { id: string }; isOverdue: boolean; displayStatus: string }[] }>(
        '/api/v1/training/assignments?overdue=true',
        auth(),
      );
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]!.employee.id).toBe(managerId);
      expect(list.body.data[0]!.isOverdue).toBe(true);
      expect(list.body.data[0]!.displayStatus).toBe('EXPIRED');

      const dashboard = await context.http.get<{ assignments: { overdue: number; COMPLETED: number } }>(
        '/api/v1/training/dashboard',
        auth(),
      );
      expect(dashboard.body.assignments.overdue).toBe(1);
      expect(dashboard.body.assignments.COMPLETED).toBe(1);
    });

    it('exposes the skill matrix for the caller’s scope', async () => {
      const skillName = `Terraform-${Date.now()}`;
      const skill = await context.http.post<{ id: string }>(
        '/api/v1/training/skills',
        { name: skillName, category: 'Engineering' },
        auth(),
      );
      expect(skill.status).toBe(201);

      const assigned = await context.http.post(
        `/api/v1/employees/${employeeId}/profile/skills`,
        { name: skillName, category: 'Engineering', level: 4, yearsOfExp: 6 },
        auth(),
      );
      expect(assigned.status).toBe(201);

      const matrix = await context.http.get<{
        employees: { employee: { id: string }; skills: { name: string; level: number }[] }[];
        skills: { id: string; name: string; employees: number; averageLevel: number }[];
      }>(`/api/v1/training/skills/matrix?employeeId=${employeeId}`, auth());
      expect(matrix.status).toBe(200);

      const row = matrix.body.employees.find((entry) => entry.employee.id === employeeId)!;
      expect(row.skills.find((entry) => entry.name === skillName)?.level).toBe(4);
      const catalogEntry = matrix.body.skills.find((entry) => entry.id === skill.body.id)!;
      expect(catalogEntry.employees).toBe(1);
      expect(catalogEntry.averageLevel).toBe(4);
    });
  });

  /** Creates a real receipt document so the expense receipt rule can be satisfied. */
  async function createReceiptDocument(): Promise<string> {
    const prisma = context.app.get(PrismaService);
    return runWithTenantContext(tenantId, async () => {
      const document = await prisma.client.document.create({
        data: tenantScoped({ name: 'Hotel receipt — Berlin', employeeId }),
        select: { id: true },
      });
      return document.id;
    });
  }
});
