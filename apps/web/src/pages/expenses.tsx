import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeDollarSign, Download, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, ApiError, type Paginated } from '../lib/api.js';
import { formatDate, formatMoney, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  EmployeeListItem,
  ExpenseCategoryItem,
  ExpenseExportResult,
  ExpenseItem,
  ExpenseSummaryResult,
} from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { optionalNumber } from '../components/feature/schemas.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { BarPanel } from '../components/feature/charts.js';
import { FilterBar, SearchInput, SectionCard, useDebouncedValue } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { ConfirmDialog, Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Field, Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'REIMBURSED', 'CANCELLED'] as const;

function ExpenseDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; expense: ExpenseItem | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = props.expense;

  const categories = useQuery({
    queryKey: ['expenses', 'categories', 'active'],
    queryFn: () => api.get<Paginated<ExpenseCategoryItem>>('/expenses/categories', { query: { pageSize: 100, includeInactive: false } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        categoryId: z.string().min(1, t('common.required')),
        title: z.string().min(2, t('common.required')).max(200),
        amount: z.coerce.number({ message: t('validation.number') }).positive(t('validation.min', { count: 0 })),
        currency: z.string().length(3, t('validation.length', { count: 3 })),
        expenseDate: z.string().min(1, t('common.required')),
        description: z.string().max(2000).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? api.patch<ExpenseItem>(`/expenses/${editing.id}`, { ...values, description: values.description || undefined, currency: values.currency.toUpperCase() })
        : api.post<ExpenseItem>('/expenses', { ...values, description: values.description || undefined, currency: values.currency.toUpperCase() }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={editing ? t('expenses.editExpense') : t('expenses.newExpense')}
      schema={schema}
      defaultValues={{
        categoryId: editing?.category?.id ?? '',
        title: editing?.title ?? '',
        amount: editing ? Number(editing.amount) : Number.NaN,
        currency: editing?.currency ?? 'EUR',
        expenseDate: editing ? toDateInputValue(editing.expenseDate) : toDateInputValue(new Date()),
        description: editing?.description ?? '',
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('expenses.titleField')} htmlFor="exp-title" error={form.formState.errors.title?.message}>
              <Input id="exp-title" {...form.register('title')} />
            </FormField>
            <FormField label={t('expenses.category')} htmlFor="exp-category" error={form.formState.errors.categoryId?.message}>
              <Select id="exp-category" {...form.register('categoryId')}>
                <option value="">{t('common.select')}</option>
                {(categories.data?.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('expenses.amount')} htmlFor="exp-amount" error={form.formState.errors.amount?.message}>
              <Input id="exp-amount" type="number" step="0.01" min={0} {...form.register('amount', { valueAsNumber: true })} />
            </FormField>
            <FormField label={t('expenses.currency')} htmlFor="exp-currency" error={form.formState.errors.currency?.message}>
              <Input id="exp-currency" maxLength={3} {...form.register('currency')} />
            </FormField>
            <FormField label={t('expenses.date')} htmlFor="exp-date" error={form.formState.errors.expenseDate?.message}>
              <Input id="exp-date" type="date" {...form.register('expenseDate')} />
            </FormField>
          </div>
          <FormField label={t('expenses.notes')} htmlFor="exp-description">
            <Textarea id="exp-description" rows={3} {...form.register('description')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function DecisionDialog(props: { expense: ExpenseItem | null; decision: 'approve' | 'reject' | 'request-changes' | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: () => {
      const body = { reviewNote: note || undefined };
      if (props.decision === 'request-changes') return api.post(`/expenses/${props.expense?.id}/request-changes`, body);
      if (props.decision === 'reject') return api.post(`/expenses/${props.expense?.id}/reject`, body);
      return api.post(`/expenses/${props.expense?.id}/approve`, body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      setNote('');
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const requiresNote = props.decision !== 'approve';

  return (
    <Dialog open={Boolean(props.expense && props.decision)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t(`expenses.decision.${props.decision ?? 'approve'}`)} description={props.expense?.title}>
        <div className="space-y-4">
          <Field
            label={t('expenses.reviewNote')}
            htmlFor="expense-note"
            error={requiresNote && note.trim().length === 0 ? t('common.required') : null}
          >
            <Textarea id="expense-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={props.decision === 'reject' ? 'danger' : 'primary'}
              disabled={requiresNote && note.trim().length === 0}
              loading={decide.isPending}
              onClick={() => decide.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDetailDialog(props: { expenseId: string | null; onOpenChange: (open: boolean) => void; onEdit: (expense: ExpenseItem) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const can = useAuth((state) => state.can);
  const [decision, setDecision] = useState<'approve' | 'reject' | 'request-changes' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const detail = useQuery({
    queryKey: ['expenses', 'detail', props.expenseId],
    queryFn: () => api.get<ExpenseItem>(`/expenses/${props.expenseId}`),
    enabled: Boolean(props.expenseId),
  });

  const action = useMutation({
    mutationFn: ({ id, path }: { id: string; path: 'submit' | 'cancel' | 'reimburse' }) => {
      if (path === 'submit') return api.post(`/expenses/${id}/submit`);
      if (path === 'cancel') return api.post(`/expenses/${id}/cancel`);
      return api.post(`/expenses/${id}/reimburse`);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      setConfirmCancel(false);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const expense = detail.data;

  return (
    <Dialog open={Boolean(props.expenseId)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('expenses.detailTitle')} className="w-[min(96vw,46rem)]">
        <QueryBoundary query={detail} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
          {(data) => (
            <div className="space-y-4">
              <SectionCard
                title={data.title}
                action={<Badge tone={statusTone(data.status)}>{t(`expenses.status.${data.status}`, { defaultValue: data.status })}</Badge>}
              >
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.amount')}</dt>
                    <dd className="font-medium">{formatMoney(data.amount, data.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.category')}</dt>
                    <dd>{data.category?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.date')}</dt>
                    <dd>{formatDate(data.expenseDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.employee')}</dt>
                    <dd>{data.employee ? `${data.employee.firstName} ${data.employee.lastName}` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.submittedAt')}</dt>
                    <dd>{formatDate(data.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('expenses.reviewedAt')}</dt>
                    <dd>{formatDate(data.reviewedAt)}</dd>
                  </div>
                </dl>
                {data.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{data.description}</p> : null}
                {data.reviewNote ? (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {t('expenses.reviewNote')}: {data.reviewNote}
                  </p>
                ) : null}
              </SectionCard>

              <div className="flex flex-wrap justify-end gap-2">
                {data.status === 'DRAFT' || data.status === 'CHANGES_REQUESTED' ? (
                  <>
                    <Button variant="outline" onClick={() => props.onEdit(data)}>
                      {t('common.edit')}
                    </Button>
                    <Button loading={action.isPending} onClick={() => action.mutate({ id: data.id, path: 'submit' })}>
                      {t('expenses.submit')}
                    </Button>
                  </>
                ) : null}
                {data.status === 'SUBMITTED' && can('expenses.approve') ? (
                  <>
                    <Button variant="outline" onClick={() => setDecision('request-changes')}>
                      {t('expenses.requestChanges')}
                    </Button>
                    <Button variant="danger" onClick={() => setDecision('reject')}>
                      {t('expenses.reject')}
                    </Button>
                    <Button onClick={() => setDecision('approve')}>{t('expenses.approve')}</Button>
                  </>
                ) : null}
                {data.status === 'APPROVED' && can('expenses.manage') ? (
                  <Button loading={action.isPending} onClick={() => action.mutate({ id: data.id, path: 'reimburse' })}>
                    {t('expenses.reimburse')}
                  </Button>
                ) : null}
                {data.status === 'DRAFT' || data.status === 'SUBMITTED' || data.status === 'CHANGES_REQUESTED' ? (
                  <Button variant="outline" onClick={() => setConfirmCancel(true)}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </QueryBoundary>
      </DialogContent>

      <DecisionDialog
        expense={expense && decision ? expense : null}
        decision={decision}
        onOpenChange={(open) => (!open ? setDecision(null) : undefined)}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('expenses.cancelConfirm')}
        destructive
        loading={action.isPending}
        confirmLabel={t('common.confirm')}
        onConfirm={() => {
          if (expense) action.mutate({ id: expense.id, path: 'cancel' });
        }}
      />
    </Dialog>
  );
}

function ClaimsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', categoryId: '', employeeId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canSeeOthers = can('expenses.view');

  const categories = useQuery({
    queryKey: ['expenses', 'categories', 'active'],
    queryFn: () => api.get<Paginated<ExpenseCategoryItem>>('/expenses/categories', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: canSeeOthers,
    staleTime: 5 * 60_000,
  });

  const list = useQuery({
    queryKey: ['expenses', 'list', { search, ...filters, page }],
    queryFn: () =>
      api.get<Paginated<ExpenseItem>>('/expenses', {
        query: {
          search: search || undefined,
          status: filters.status || undefined,
          categoryId: filters.categoryId || undefined,
          employeeId: canSeeOthers ? filters.employeeId || undefined : undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page,
          pageSize: 10,
        },
      }),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const exportExpenses = useMutation({
    mutationFn: () =>
      api.post<ExpenseExportResult>('/expenses/export', {
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    onSuccess: (result) => {
      const blob = new Blob([result.body], { type: result.contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t('expenses.exported', { count: result.rowCount }));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          value={term}
          onChange={(value) => {
            setTerm(value);
            setPage(1);
          }}
          placeholder={t('expenses.searchPlaceholder')}
          className="sm:w-60"
        />
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {EXPENSE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`expenses.status.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('expenses.category')} className="sm:w-44" value={filters.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {(categories.data?.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        {canSeeOthers ? (
          <Select aria-label={t('expenses.employee')} className="sm:w-48" value={filters.employeeId} onChange={(event) => update({ employeeId: event.target.value })}>
            <option value="">{t('expenses.allEmployees')}</option>
            {(employees.data?.data ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        ) : null}
        <Input aria-label={t('common.from')} type="date" className="sm:w-40" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
        <Input aria-label={t('common.to')} type="date" className="sm:w-40" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
        <Button variant="outline" loading={exportExpenses.isPending} onClick={() => exportExpenses.mutate()}>
          <Download className="size-4" aria-hidden />
          {t('common.export')}
        </Button>
      </FilterBar>

      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState icon={BadgeDollarSign} title={t('expenses.noExpenses')} description={t('expenses.noExpensesHint')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('expenses.titleField')}</TableHead>
                    {canSeeOthers ? <TableHead>{t('expenses.employee')}</TableHead> : null}
                    <TableHead>{t('expenses.category')}</TableHead>
                    <TableHead>{t('expenses.date')}</TableHead>
                    <TableHead>{t('expenses.amount')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((expense) => (
                    <TableRow
                      key={expense.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setOpenId(expense.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setOpenId(expense.id);
                      }}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{expense.title}</TableCell>
                      {canSeeOthers ? (
                        <TableCell>{expense.employee ? `${expense.employee.firstName} ${expense.employee.lastName}` : '—'}</TableCell>
                      ) : null}
                      <TableCell>{expense.category?.name ?? '—'}</TableCell>
                      <TableCell>{formatDate(expense.expenseDate)}</TableCell>
                      <TableCell className="tabular-nums">{formatMoney(expense.amount, expense.currency)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(expense.status)}>{t(`expenses.status.${expense.status}`, { defaultValue: expense.status })}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>

      <ExpenseDialog
        open={dialogOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['expenses'] });
          }
        }}
        expense={editing}
      />

      <ExpenseDetailDialog
        expenseId={openId}
        onOpenChange={(open) => (!open ? setOpenId(null) : undefined)}
        onEdit={(expense) => {
          setOpenId(null);
          setEditing(expense);
        }}
      />

      <div className="flex justify-end">
        <Button
          disabled={!can('expenses.create')}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t('expenses.newExpense')}
        </Button>
      </div>
      {exportExpenses.isError ? <p className="text-sm text-rose-600">{describeError(exportExpenses.error)}</p> : null}
    </div>
  );
}

function SummaryTab() {
  const { t } = useTranslation();
  const [range, setRange] = useState({ from: '', to: '' });

  const summary = useQuery({
    queryKey: ['expenses', 'summary', range],
    queryFn: () => api.get<ExpenseSummaryResult>('/expenses/summary', { query: { from: range.from || undefined, to: range.to || undefined } }),
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <Input aria-label={t('common.from')} type="date" className="sm:w-40" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
        <Input aria-label={t('common.to')} type="date" className="sm:w-40" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
      </FilterBar>
      <QueryBoundary query={summary} isEmpty={() => false} skeleton={<TableSkeleton rows={3} columns={4} />}>
        {(data) => {
          const totalAmount = data.byStatus.reduce((sum, row) => sum + row.total, 0);
          const pending = data.byStatus.filter((row) => row.status === 'SUBMITTED' || row.status === 'CHANGES_REQUESTED');
          const approved = data.byStatus.filter((row) => row.status === 'APPROVED');
          const reimbursed = data.byStatus.filter((row) => row.status === 'REIMBURSED');
          const currency = data.byStatus[0]?.currency ?? 'EUR';
          return (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label={t('expenses.totalAmount')} value={formatMoney(totalAmount, currency)} icon={<BadgeDollarSign className="size-5" />} />
                <StatCard
                  label={t('expenses.pendingAmount')}
                  value={formatMoney(pending.reduce((sum, row) => sum + row.total, 0), currency)}
                  tone={pending.length > 0 ? 'warning' : 'default'}
                />
                <StatCard
                  label={t('expenses.approvedAmount')}
                  value={formatMoney(approved.reduce((sum, row) => sum + row.total, 0), currency)}
                  tone="positive"
                />
                <StatCard label={t('expenses.reimbursedAmount')} value={formatMoney(reimbursed.reduce((sum, row) => sum + row.total, 0), currency)} />
              </div>
              <BarPanel
                title={t('expenses.byCategory')}
                data={data.byCategory.map((row) => ({ label: row.categoryName ?? row.categoryKey ?? '—', total: row.total }))}
                xKey="label"
                series={[{ key: 'total', name: t('expenses.amount'), color: '#0ea5e9' }]}
                multiColor
              />
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('expenses.currency')}</TableHead>
                      <TableHead>{t('expenses.count')}</TableHead>
                      <TableHead>{t('expenses.amount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byStatus.map((row) => (
                      <TableRow key={`${row.status}-${row.currency}`}>
                        <TableCell>
                          <Badge tone={statusTone(row.status)}>{t(`expenses.status.${row.status}`, { defaultValue: row.status })}</Badge>
                        </TableCell>
                        <TableCell>{row.currency}</TableCell>
                        <TableCell className="tabular-nums">{row.count}</TableCell>
                        <TableCell className="tabular-nums">{formatMoney(row.total, row.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          );
        }}
      </QueryBoundary>
    </div>
  );
}

function CategoriesTab() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ExpenseCategoryItem | null>(null);

  const list = useQuery({
    queryKey: ['expenses', 'categories', 'all'],
    queryFn: () => api.get<Paginated<ExpenseCategoryItem>>('/expenses/categories', { query: { pageSize: 100, includeInactive: true } }),
  });

  const schema = useMemo(
    () =>
      z.object({
        key: z.string().min(2, t('common.required')).max(40),
        name: z.string().min(2, t('common.required')).max(120),
        requiresReceipt: z.boolean(),
        maxAmount: optionalNumber(t, { min: 0 }),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/expenses/categories', {
        key: values.key,
        name: values.name,
        requiresReceipt: values.requiresReceipt,
        maxAmount: values.maxAmount || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] }),
  });

  const toggle = useMutation({
    mutationFn: (category: ExpenseCategoryItem) => api.patch(`/expenses/categories/${category.id}`, { isActive: !category.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] }),
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/categories/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('expenses.categories')}</h3>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </div>
      <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('expenses.noCategories')} />}>
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('expenses.name')}</TableHead>
                <TableHead>{t('expenses.key')}</TableHead>
                <TableHead>{t('expenses.requiresReceipt')}</TableHead>
                <TableHead>{t('expenses.maxAmount')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">{category.name}</TableCell>
                  <TableCell className="font-mono text-xs">{category.key}</TableCell>
                  <TableCell>{category.requiresReceipt ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>{category.maxAmount != null ? formatMoney(category.maxAmount, 'EUR') : '—'}</TableCell>
                  <TableCell>
                    <Badge tone={category.isActive ? 'success' : 'neutral'}>{category.isActive ? t('common.active') : t('common.inactive')}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-2">
                      <Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate(category)}>
                        {category.isActive ? t('common.deactivate') : t('common.activate')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setToDelete(category)}>
                        {t('common.delete')}
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryBoundary>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('expenses.newCategory')}
        schema={schema}
        defaultValues={{ key: '', name: '', requiresReceipt: true, maxAmount: undefined }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('expenses.key')} htmlFor="cat-key" error={form.formState.errors.key?.message}>
              <Input id="cat-key" placeholder="TRAVEL" {...form.register('key')} />
            </FormField>
            <FormField label={t('expenses.name')} htmlFor="cat-name" error={form.formState.errors.name?.message}>
              <Input id="cat-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('expenses.maxAmount')} htmlFor="cat-max" hint={t('expenses.maxAmountHint')}>
              <Input id="cat-max" type="number" step="0.01" min={0} {...form.register('maxAmount', { valueAsNumber: true })} />
            </FormField>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('expenses.requiresReceipt')}
              <input type="checkbox" checked={form.watch('requiresReceipt')} onChange={(event) => form.setValue('requiresReceipt', event.target.checked)} />
            </label>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('expenses.deleteCategory')}
        description={toDelete?.name}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </Card>
  );
}

export function ExpensesPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'claims', label: t('expenses.claims') },
    { value: 'summary', label: t('expenses.summary'), permission: 'expenses.view' },
    { value: 'categories', label: t('expenses.categories'), permission: 'expenses.manage' },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const activeTab = params.get('tab') ?? 'claims';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'claims';

  return (
    <div className="space-y-6">
      <PageHeader title={t('expenses.title')} description={t('expenses.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="claims">{current === 'claims' ? <ClaimsTab /> : null}</TabsContent>
        <TabsContent value="summary">{current === 'summary' ? <SummaryTab /> : null}</TabsContent>
        <TabsContent value="categories">{current === 'categories' ? <CategoriesTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
