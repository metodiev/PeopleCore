import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, formatDateTime, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { EmployeeListItem, RequestCommentItem, RequestItem, RequestStats } from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { useApiErrorText, QueryBoundary } from '../components/feature/query.js';
import { FilterBar, SearchInput, SectionCard, useDebouncedValue } from '../components/feature/widgets.js';
import { BarPanel } from '../components/feature/charts.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Field, Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const REQUEST_TYPES = ['HR', 'CERTIFICATE', 'DOCUMENT', 'PAYROLL', 'EQUIPMENT', 'REMOTE_WORK', 'IT', 'OTHER'] as const;
const REQUEST_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const REQUEST_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_EMPLOYEE', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;
const HANDLED_STATUSES = ['IN_PROGRESS', 'WAITING_EMPLOYEE', 'RESOLVED', 'CLOSED'] as const;

function NewRequestDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const can = useAuth((state) => state.can);

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: props.open && can('requests.manage'),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        type: z.string().min(1, t('common.required')),
        subject: z.string().min(3, t('common.required')).max(160),
        description: z.string().min(3, t('common.required')).max(4000),
        priority: z.string().min(1, t('common.required')),
        dueDate: z.string().optional(),
        employeeId: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<RequestItem>('/requests', {
        ...values,
        dueDate: values.dueDate || undefined,
        employeeId: values.employeeId || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['requests'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('requests.newRequest')}
      schema={schema}
      defaultValues={{ type: 'HR', subject: '', description: '', priority: 'NORMAL', dueDate: '', employeeId: '' }}
      onSubmit={(values) => create.mutateAsync(values)}
      submitLabel={t('common.create')}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('requests.type')} htmlFor="req-type" error={form.formState.errors.type?.message}>
              <Select id="req-type" {...form.register('type')}>
                {REQUEST_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`requests.typeValue.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('requests.priority')} htmlFor="req-priority">
              <Select id="req-priority" {...form.register('priority')}>
                {REQUEST_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`requests.priorityValue.${priority}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('requests.subject')} htmlFor="req-subject" error={form.formState.errors.subject?.message}>
              <Input id="req-subject" {...form.register('subject')} />
            </FormField>
            <FormField label={t('requests.dueDate')} htmlFor="req-due">
              <Input id="req-due" type="date" min={toDateInputValue(new Date())} {...form.register('dueDate')} />
            </FormField>
            {can('requests.manage') ? (
              <FormField label={t('requests.onBehalfOf')} htmlFor="req-employee" hint={t('requests.onBehalfOfHint')}>
                <Select id="req-employee" {...form.register('employeeId')}>
                  <option value="">{t('requests.forMyself')}</option>
                  {(employees.data?.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
          </div>
          <FormField label={t('requests.description')} htmlFor="req-description" error={form.formState.errors.description?.message}>
            <Textarea id="req-description" rows={4} {...form.register('description')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function RequestDetailDialog(props: { requestId: string | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const can = useAuth((state) => state.can);
  const canManage = can('requests.manage');
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState('');
  const [resolution, setResolution] = useState('');

  const request = useQuery({
    queryKey: ['requests', 'detail', props.requestId],
    queryFn: () => api.get<RequestItem>(`/requests/${props.requestId}`),
    enabled: Boolean(props.requestId),
  });

  const assignees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: Boolean(props.requestId) && canManage,
    staleTime: 5 * 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
  };

  const onError = (error: unknown) => toast.error(describeError(error));

  const addComment = useMutation({
    mutationFn: () => api.post<RequestCommentItem>(`/requests/${props.requestId}/comments`, { body: comment, isInternal: internal }),
    onSuccess: () => {
      setComment('');
      setInternal(false);
      invalidate();
    },
    onError,
  });

  const assign = useMutation({
    mutationFn: () => api.post(`/requests/${props.requestId}/assign`, { assigneeId }),
    onSuccess: () => {
      setAssigneeId('');
      invalidate();
    },
    onError,
  });

  const changeStatus = useMutation({
    mutationFn: () => api.post(`/requests/${props.requestId}/status`, { status, resolution: resolution || undefined }),
    onSuccess: () => {
      setStatus('');
      setResolution('');
      invalidate();
    },
    onError,
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/requests/${props.requestId}/cancel`),
    onSuccess: invalidate,
    onError,
  });

  return (
    <Dialog open={Boolean(props.requestId)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('requests.detailTitle')} className="w-[min(96vw,52rem)]">
        <QueryBoundary query={request} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
          {(data) => (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.subject}</h3>
                  <Badge tone={statusTone(data.status)}>{t(`requests.status.${data.status}`, { defaultValue: data.status })}</Badge>
                  <Badge tone={statusTone(data.priority)}>{t(`requests.priorityValue.${data.priority}`, { defaultValue: data.priority })}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t(`requests.typeValue.${data.type}`, { defaultValue: data.type })} · {t('requests.createdAt')}{' '}
                  {formatDateTime(data.createdAt)}
                  {data.dueDate ? ` · ${t('requests.dueDate')}: ${formatDate(data.dueDate)}` : ''}
                </p>
              </div>

              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase text-slate-500">{t('requests.requester')}</dt>
                  <dd>
                    {data.employee ? `${data.employee.firstName} ${data.employee.lastName}` : t('requests.forMyself')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">{t('requests.assignee')}</dt>
                  <dd>{data.assignee ? `${data.assignee.firstName} ${data.assignee.lastName}` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">{t('requests.resolvedAt')}</dt>
                  <dd>{formatDate(data.resolvedAt)}</dd>
                </div>
              </dl>

              <SectionCard title={t('requests.description')}>
                <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{data.description}</p>
                {data.resolution ? (
                  <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                    {t('requests.resolution')}: {data.resolution}
                  </p>
                ) : null}
              </SectionCard>

              <SectionCard title={t('requests.comments')}>
                <div className="space-y-3">
                  {(data.comments ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t('requests.noComments')}</p>
                  ) : (
                    <ul className="space-y-3">
                      {(data.comments ?? []).map((item) => (
                        <li key={item.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {item.authorName ?? t('requests.systemAuthor')} · {formatDateTime(item.createdAt)}
                            {item.isInternal ? <Badge tone="warning" className="ml-2">{t('requests.internalNote')}</Badge> : null}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{item.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Field label={t('requests.addComment')} htmlFor="req-comment">
                    <Textarea id="req-comment" rows={2} value={comment} onChange={(event) => setComment(event.target.value)} />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    {canManage ? (
                      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                        {t('requests.internalNote')}
                      </label>
                    ) : null}
                    <Button size="sm" disabled={comment.trim().length < 2} loading={addComment.isPending} onClick={() => addComment.mutate()}>
                      {t('requests.addComment')}
                    </Button>
                  </div>
                </div>
              </SectionCard>

              {canManage ? (
                <SectionCard title={t('requests.manage')}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Field label={t('requests.assignee')} htmlFor="req-assignee">
                        <Select id="req-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                          <option value="">{t('common.select')}</option>
                          {(assignees.data?.data ?? []).map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.firstName} {employee.lastName}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button size="sm" disabled={!assigneeId} loading={assign.isPending} onClick={() => assign.mutate()}>
                        {t('requests.assign')}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Field label={t('common.status')} htmlFor="req-status">
                        <Select
                          id="req-status"
                          value={status}
                          onChange={(event) => setStatus(event.target.value)}
                        >
                          <option value="">{t('common.select')}</option>
                          {HANDLED_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {t(`requests.status.${value}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {status === 'RESOLVED' || status === 'CLOSED' ? (
                        <Field label={t('requests.resolution')} htmlFor="req-resolution">
                          <Textarea id="req-resolution" rows={2} value={resolution} onChange={(event) => setResolution(event.target.value)} />
                        </Field>
                      ) : null}
                      <Button size="sm" disabled={!status} loading={changeStatus.isPending} onClick={() => changeStatus.mutate()}>
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>
                </SectionCard>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                  {t('common.close')}
                </Button>
                {data.status !== 'RESOLVED' && data.status !== 'CLOSED' && data.status !== 'CANCELLED' ? (
                  <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                    {t('requests.cancelRequest')}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </QueryBoundary>
      </DialogContent>
    </Dialog>
  );
}

function RequestList(props: { mode: 'mine' | 'inbox' }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', type: '', priority: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['requests', props.mode, { search, ...filters, page }],
    queryFn: () => {
      const query = {
        mine: props.mode === 'mine' ? true : undefined,
        search: search || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
        priority: filters.priority || undefined,
        page,
        pageSize: 10,
      };
      return props.mode === 'inbox'
        ? api.get<Paginated<RequestItem>>('/requests/inbox', { query })
        : api.get<Paginated<RequestItem>>('/requests', { query });
    },
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          value={term}
          onChange={(value) => {
            setTerm(value);
            setPage(1);
          }}
          placeholder={t('requests.searchPlaceholder')}
          className="sm:w-64"
        />
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`requests.status.${value}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('requests.type')} className="sm:w-44" value={filters.type} onChange={(event) => update({ type: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`requests.typeValue.${value}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('requests.priority')} className="sm:w-40" value={filters.priority} onChange={(event) => update({ priority: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {REQUEST_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {t(`requests.priorityValue.${value}`)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(data) => data.data.length === 0}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={t('requests.noRequests')}
              description={props.mode === 'inbox' ? t('requests.inboxEmptyHint') : t('requests.noRequestsHint')}
            />
          }
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('requests.subject')}</TableHead>
                    <TableHead>{t('requests.type')}</TableHead>
                    <TableHead>{t('requests.priority')}</TableHead>
                    <TableHead>{t('requests.assignee')}</TableHead>
                    <TableHead>{t('requests.createdAt')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((request) => (
                    <TableRow
                      key={request.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setOpenId(request.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setOpenId(request.id);
                      }}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {request.subject}
                        {request.employee ? (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {request.employee.firstName} {request.employee.lastName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{t(`requests.typeValue.${request.type}`, { defaultValue: request.type })}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(request.priority)}>{t(`requests.priorityValue.${request.priority}`, { defaultValue: request.priority })}</Badge>
                      </TableCell>
                      <TableCell>{request.assignee ? `${request.assignee.firstName} ${request.assignee.lastName}` : '—'}</TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(request.status)}>{t(`requests.status.${request.status}`, { defaultValue: request.status })}</Badge>
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

      <RequestDetailDialog requestId={openId} onOpenChange={(open) => (!open ? setOpenId(null) : undefined)} />
    </div>
  );
}

function RequestStatsPanel() {
  const { t } = useTranslation();
  const stats = useQuery({ queryKey: ['requests', 'stats'], queryFn: () => api.get<RequestStats>('/requests/stats') });

  return (
    <QueryBoundary query={stats} isEmpty={() => false} skeleton={<TableSkeleton rows={3} columns={4} />}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('requests.open')} value={data.open ?? 0} tone={(data.open ?? 0) > 0 ? 'warning' : 'positive'} />
            <StatCard label={t('requests.resolved')} value={data.resolved ?? 0} tone="positive" />
            <StatCard
              label={t('requests.averageResolution')}
              value={data.averageResolutionHours != null ? t('requests.hoursValue', { count: data.averageResolutionHours }) : '—'}
            />
            <StatCard
              label={t('requests.oldestOpen')}
              value={data.oldestOpen ? t('requests.hoursValue', { count: data.oldestOpen.ageHours ?? data.oldestOpenAgeHours ?? 0 }) : '—'}
              hint={data.oldestOpen?.subject}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarPanel
              title={t('requests.openByType')}
              data={Object.entries(data.openByType ?? {}).map(([label, count]) => ({ label, count }))}
              xKey="label"
              series={[{ key: 'count', name: t('requests.count'), color: '#6366f1' }]}
              multiColor
            />
            <BarPanel
              title={t('requests.openByPriority')}
              data={Object.entries(data.openByPriority ?? {}).map(([label, count]) => ({ label, count }))}
              xKey="label"
              series={[{ key: 'count', name: t('requests.count'), color: '#f59e0b' }]}
              multiColor
            />
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

export function RequestsPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);

  const tabs = [
    { value: 'mine', label: t('requests.myRequests') },
    { value: 'inbox', label: t('requests.inbox'), permission: 'requests.manage' },
    { value: 'stats', label: t('requests.stats'), permission: 'requests.view' },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const activeTab = params.get('tab') ?? 'mine';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'mine';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('requests.title')}
        description={t('requests.subtitle')}
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={!can('requests.create')}>
            <Plus className="size-4" aria-hidden />
            {t('requests.newRequest')}
          </Button>
        }
      />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="mine">{current === 'mine' ? <RequestList mode="mine" /> : null}</TabsContent>
        <TabsContent value="inbox">{current === 'inbox' ? <RequestList mode="inbox" /> : null}</TabsContent>
        <TabsContent value="stats">{current === 'stats' ? <RequestStatsPanel /> : null}</TabsContent>
      </Tabs>
      <NewRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
