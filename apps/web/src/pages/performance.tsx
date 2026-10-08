import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  EmployeeListItem,
  FeedbackItem,
  GoalItem,
  PerformanceDashboard,
  PerformanceReviewItem,
  ReviewCycleItem,
} from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { BarPanel } from '../components/feature/charts.js';
import { DefinitionList, FilterBar, ProgressBar, SectionCard, SearchInput, useDebouncedValue } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Field, Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const GOAL_TYPES = ['GOAL', 'OKR', 'KPI'] as const;
const GOAL_STATUSES = ['DRAFT', 'ACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED', 'CANCELLED'] as const;
const GOAL_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const REVIEW_TYPES = ['SELF', 'MANAGER', 'PEER', 'UPWARD'] as const;
const REVIEW_STATUSES = ['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'ACKNOWLEDGED'] as const;
const FEEDBACK_TYPES = ['PRAISE', 'CONSTRUCTIVE', 'PEER', 'MANAGER', 'SELF'] as const;
const FEEDBACK_VISIBILITIES = ['PRIVATE', 'MANAGER', 'PUBLIC'] as const;

function useEmployeeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function DashboardTab() {
  const { t } = useTranslation();
  const dashboard = useQuery({ queryKey: ['performance', 'dashboard'], queryFn: () => api.get<PerformanceDashboard>('/performance/dashboard') });

  return (
    <QueryBoundary query={dashboard} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={4} />}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('performance.activeCycles')} value={data.activeCycles.length} icon={<Target className="size-5" />} />
            <StatCard label={t('performance.pendingReviews')} value={data.pendingReviews} tone={data.pendingReviews > 0 ? 'warning' : 'positive'} />
            <StatCard label={t('performance.awaitingMe')} value={data.reviewsAwaitingMyAction} tone={data.reviewsAwaitingMyAction > 0 ? 'warning' : 'default'} />
            <StatCard
              label={t('performance.averageRating')}
              value={data.averageRating != null ? data.averageRating.toFixed(2) : '—'}
              hint={t('performance.ratedReviews', { count: data.ratedReviews })}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarPanel
              title={t('performance.goalsByStatus')}
              data={Object.entries(data.goals.byStatus).map(([label, value]) => ({ label: t(`performance.status.${label}`, { defaultValue: label }), value }))}
              xKey="label"
              series={[{ key: 'value', name: t('performance.goals'), color: '#6366f1' }]}
              multiColor
            />
            <Card>
              <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('performance.activeCycles')}</h3>
              </div>
              {data.activeCycles.length === 0 ? (
                <EmptyState title={t('performance.noActiveCycles')} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('performance.cycle')}</TableHead>
                      <TableHead>{t('performance.period')}</TableHead>
                      <TableHead>{t('performance.reviewCount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.activeCycles.map((cycle) => (
                      <TableRow key={cycle.id}>
                        <TableCell className="font-medium text-slate-900 dark:text-slate-100">{cycle.name}</TableCell>
                        <TableCell>
                          {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                        </TableCell>
                        <TableCell className="tabular-nums">{cycle.reviewCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('performance.goalsTotal')} value={data.goals.total} />
            <StatCard label={t('performance.goalsOverdue')} value={data.goals.overdue} tone={data.goals.overdue > 0 ? 'danger' : 'positive'} />
            <StatCard label={t('performance.goalsDueSoon')} value={data.goals.dueWithin30Days} tone={data.goals.dueWithin30Days > 0 ? 'warning' : 'default'} />
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function CyclesTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['performance', 'cycles', statusFilter, page],
    queryFn: () =>
      api.get<Paginated<ReviewCycleItem>>('/performance/cycles', {
        query: { status: statusFilter || undefined, page, pageSize: 10 },
      }),
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(160),
        description: z.string().max(1000).optional(),
        startDate: z.string().min(1, t('common.required')),
        endDate: z.string().min(1, t('common.required')),
        includesSelfReview: z.boolean(),
        includesPeerReview: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['performance'] });

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/performance/cycles', { ...values, description: values.description || undefined }),
    onSuccess: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'close' }) =>
      action === 'activate'
        ? api.post(`/performance/cycles/${id}/activate`)
        : api.post(`/performance/cycles/${id}/close`),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label={t('common.status')} className="sm:w-44" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {['DRAFT', 'ACTIVE', 'CLOSED'].map((status) => (
            <option key={status} value={status}>
              {t(`performance.cycleStatus.${status}`)}
            </option>
          ))}
        </Select>
        {can('performance.manage') ? (
          <Button className="sm:ml-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('performance.newCycle')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('performance.noCycles')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('performance.cycle')}</TableHead>
                    <TableHead>{t('performance.period')}</TableHead>
                    <TableHead>{t('performance.reviewCount')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((cycle) => (
                    <TableRow key={cycle.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {cycle.name}
                        {cycle.description ? <span className="block text-xs text-slate-500">{cycle.description}</span> : null}
                      </TableCell>
                      <TableCell>
                        {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                      </TableCell>
                      <TableCell className="tabular-nums">{cycle.reviewCount ?? 0}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(cycle.status)}>{t(`performance.cycleStatus.${cycle.status}`, { defaultValue: cycle.status })}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {can('performance.manage') ? (
                          <span className="inline-flex gap-2">
                            {cycle.status === 'DRAFT' ? (
                              <Button size="sm" variant="outline" loading={transition.isPending} onClick={() => transition.mutate({ id: cycle.id, action: 'activate' })}>
                                {t('performance.activate')}
                              </Button>
                            ) : null}
                            {cycle.status === 'ACTIVE' ? (
                              <Button size="sm" variant="outline" loading={transition.isPending} onClick={() => transition.mutate({ id: cycle.id, action: 'close' })}>
                                {t('performance.close')}
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
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

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('performance.newCycle')}
        schema={schema}
        defaultValues={{
          name: '',
          description: '',
          startDate: toDateInputValue(new Date()),
          endDate: toDateInputValue(new Date(Date.now() + 90 * 86_400_000)),
          includesSelfReview: true,
          includesPeerReview: false,
        }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <FormField label={t('performance.cycle')} htmlFor="cycle-name" error={form.formState.errors.name?.message}>
              <Input id="cycle-name" {...form.register('name')} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('performance.startDate')} htmlFor="cycle-start" error={form.formState.errors.startDate?.message}>
                <Input id="cycle-start" type="date" {...form.register('startDate')} />
              </FormField>
              <FormField label={t('performance.endDate')} htmlFor="cycle-end" error={form.formState.errors.endDate?.message}>
                <Input id="cycle-end" type="date" {...form.register('endDate')} />
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="cycle-description">
              <Textarea id="cycle-description" rows={2} {...form.register('description')} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('performance.selfReview')}
                <input type="checkbox" checked={form.watch('includesSelfReview')} onChange={(event) => form.setValue('includesSelfReview', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('performance.peerReview')}
                <input type="checkbox" checked={form.watch('includesPeerReview')} onChange={(event) => form.setValue('includesPeerReview', event.target.checked)} />
              </label>
            </div>
          </>
        )}
      </FormDialog>
    </div>
  );
}

function ReviewDetailDialog(props: { review: PerformanceReviewItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState('');
  const [summary, setSummary] = useState('');
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.patch(`/performance/reviews/${props.review?.id}`, {
        overallRating: rating ? Number(rating) : undefined,
        summary: summary || undefined,
        strengths: strengths || undefined,
        improvements: improvements || undefined,
        submit,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const acknowledge = useMutation({
    mutationFn: () => api.post(`/performance/reviews/${props.review?.id}/acknowledge`),
    onSuccess: () => {
      toast.success(t('performance.acknowledged'));
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const review = props.review;

  return (
    <Dialog open={Boolean(review)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('performance.reviewDetail')} className="w-[min(96vw,44rem)]">
        {review ? (
          <div className="space-y-4">
            <DefinitionList
              items={[
                { label: t('performance.cycle'), value: review.cycle?.name ?? '—' },
                { label: t('performance.employee'), value: review.employee ? `${review.employee.firstName} ${review.employee.lastName}` : '—' },
                { label: t('performance.reviewer'), value: review.reviewer ? `${review.reviewer.firstName} ${review.reviewer.lastName}` : '—' },
                { label: t('performance.reviewTypeLabel'), value: t(`performance.type.${review.type}`, { defaultValue: review.type }) },
                { label: t('common.status'), value: <Badge tone={statusTone(review.status)}>{t(`performance.status.${review.status}`, { defaultValue: review.status })}</Badge> },
                { label: t('performance.submittedAt'), value: formatDate(review.submittedAt) },
              ]}
            />
            {review.status === 'SUBMITTED' || review.status === 'ACKNOWLEDGED' ? (
              <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <p>
                  <span className="font-medium">{t('performance.rating')}:</span> {review.overallRating ?? '—'}
                </p>
                <p className="whitespace-pre-wrap">{review.summary ?? '—'}</p>
                {review.strengths ? (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">{t('performance.strengths')}:</span> {review.strengths}
                  </p>
                ) : null}
                {review.improvements ? (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">{t('performance.improvements')}:</span> {review.improvements}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('performance.rating')} htmlFor="review-rating" hint={t('performance.ratingHint')}>
                    <Input id="review-rating" type="number" min={1} max={5} step="0.5" value={rating} onChange={(event) => setRating(event.target.value)} />
                  </Field>
                </div>
                <Field label={t('performance.summary')} htmlFor="review-summary">
                  <Textarea id="review-summary" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('performance.strengths')} htmlFor="review-strengths">
                    <Textarea id="review-strengths" rows={2} value={strengths} onChange={(event) => setStrengths(event.target.value)} />
                  </Field>
                  <Field label={t('performance.improvements')} htmlFor="review-improvements">
                    <Textarea id="review-improvements" rows={2} value={improvements} onChange={(event) => setImprovements(event.target.value)} />
                  </Field>
                </div>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                {t('common.close')}
              </Button>
              {review.status !== 'SUBMITTED' && review.status !== 'ACKNOWLEDGED' ? (
                <>
                  <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(false)}>
                    {t('performance.saveDraft')}
                  </Button>
                  <Button loading={save.isPending} onClick={() => save.mutate(true)}>
                    {t('performance.submitReview')}
                  </Button>
                </>
              ) : null}
              {review.status === 'SUBMITTED' ? (
                <Button loading={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
                  {t('performance.acknowledge')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReviewsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ status: '', type: '', scope: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PerformanceReviewItem | null>(null);

  const cycles = useQuery({
    queryKey: ['performance', 'cycles', 'options'],
    queryFn: () => api.get<Paginated<ReviewCycleItem>>('/performance/cycles', { query: { pageSize: 50 } }),
    staleTime: 5 * 60_000,
  });
  const employees = useEmployeeOptions(open);

  const list = useQuery({
    queryKey: ['performance', 'reviews', { ...filters, page }],
    queryFn: () =>
      api.get<Paginated<PerformanceReviewItem>>('/performance/reviews', {
        query: {
          status: filters.status || undefined,
          type: filters.type || undefined,
          mineAsReviewer: filters.scope === 'reviewer' ? true : undefined,
          mineAsSubject: filters.scope === 'subject' ? true : undefined,
          page,
          pageSize: 10,
        },
      }),
  });

  const schema = useMemo(
    () =>
      z.object({
        cycleId: z.string().min(1, t('common.required')),
        employeeId: z.string().min(1, t('common.required')),
        reviewerId: z.string().optional(),
        type: z.string().min(1, t('common.required')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/performance/reviews', { ...values, reviewerId: values.reviewerId || undefined }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['performance'] }),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`performance.status.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('performance.reviewTypeLabel')} className="sm:w-40" value={filters.type} onChange={(event) => update({ type: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {REVIEW_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`performance.type.${type}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('performance.scope')} className="sm:w-44" value={filters.scope} onChange={(event) => update({ scope: event.target.value })}>
          <option value="">{t('common.all')}</option>
          <option value="reviewer">{t('performance.asReviewer')}</option>
          <option value="subject">{t('performance.asSubject')}</option>
        </Select>
        {can('performance.manage') ? (
          <Button className="sm:ml-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('performance.newReview')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('performance.noReviews')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('performance.employee')}</TableHead>
                    <TableHead>{t('performance.cycle')}</TableHead>
                    <TableHead>{t('performance.reviewTypeLabel')}</TableHead>
                    <TableHead>{t('performance.reviewer')}</TableHead>
                    <TableHead>{t('performance.rating')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((review) => (
                    <TableRow
                      key={review.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setSelected(review)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setSelected(review);
                      }}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {review.employee ? `${review.employee.firstName} ${review.employee.lastName}` : '—'}
                      </TableCell>
                      <TableCell>{review.cycle?.name ?? '—'}</TableCell>
                      <TableCell>{t(`performance.type.${review.type}`, { defaultValue: review.type })}</TableCell>
                      <TableCell>{review.reviewer ? `${review.reviewer.firstName} ${review.reviewer.lastName}` : '—'}</TableCell>
                      <TableCell className="tabular-nums">{review.overallRating ?? '—'}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(review.status)}>{t(`performance.status.${review.status}`, { defaultValue: review.status })}</Badge>
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

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('performance.newReview')}
        schema={schema}
        defaultValues={{ cycleId: '', employeeId: '', reviewerId: '', type: 'MANAGER' }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('performance.cycle')} htmlFor="review-cycle" error={form.formState.errors.cycleId?.message}>
              <Select id="review-cycle" {...form.register('cycleId')}>
                <option value="">{t('common.select')}</option>
                {(cycles.data?.data ?? []).map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('performance.employee')} htmlFor="review-employee" error={form.formState.errors.employeeId?.message}>
              <Select id="review-employee" {...form.register('employeeId')}>
                <option value="">{t('common.select')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('performance.reviewer')} htmlFor="review-reviewer" hint={t('performance.reviewerHint')}>
              <Select id="review-reviewer" {...form.register('reviewerId')}>
                <option value="">{t('common.none')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('performance.reviewTypeLabel')} htmlFor="review-type">
              <Select id="review-type" {...form.register('type')}>
                {REVIEW_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`performance.type.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </FormDialog>

      <ReviewDetailDialog review={selected} onOpenChange={(open) => (!open ? setSelected(null) : undefined)} />
    </div>
  );
}

function GoalDetailDialog(props: { goal: GoalItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState('');
  const [status, setStatus] = useState('');
  const [recompute, setRecompute] = useState(false);
  const [krTitle, setKrTitle] = useState('');
  const [krTarget, setKrTarget] = useState('');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['performance'] });
  const onError = (error: unknown) => toast.error(describeError(error));

  const updateProgress = useMutation({
    mutationFn: () =>
      api.patch(`/performance/goals/${props.goal?.id}/progress`, {
        progress: progress === '' ? undefined : Number(progress),
        status: status || undefined,
        recomputeFromKeyResults: recompute || undefined,
      }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
    onError,
  });

  const addKeyResult = useMutation({
    mutationFn: () =>
      api.post(`/performance/goals/${props.goal?.id}/key-results`, {
        title: krTitle,
        targetValue: Number(krTarget),
      }),
    onSuccess: () => {
      setKrTitle('');
      setKrTarget('');
      toast.success(t('common.created'));
      invalidate();
    },
    onError,
  });

  const goal = props.goal;

  return (
    <Dialog open={Boolean(goal)} onOpenChange={props.onOpenChange}>
      <DialogContent title={goal?.title ?? ''} className="w-[min(96vw,44rem)]">
        {goal ? (
          <div className="space-y-4">
            <DefinitionList
              items={[
                { label: t('performance.goalType'), value: t(`performance.goalTypeValue.${goal.type}`, { defaultValue: goal.type }) },
                { label: t('performance.priority'), value: t(`performance.priorityValue.${goal.priority}`, { defaultValue: goal.priority }) },
                { label: t('common.status'), value: <Badge tone={statusTone(goal.status)}>{t(`performance.status.${goal.status}`, { defaultValue: goal.status })}</Badge> },
                { label: t('performance.startDate'), value: formatDate(goal.startDate) },
                { label: t('performance.dueDate'), value: formatDate(goal.dueDate) },
                { label: t('performance.employee'), value: goal.employee ? `${goal.employee.firstName} ${goal.employee.lastName}` : '—' },
              ]}
            />
            <div>
              <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                <span>{t('performance.progress')}</span>
                <span className="tabular-nums">{goal.progress}%</span>
              </div>
              <div className="mt-1">
                <ProgressBar value={goal.progress} tone={goal.status === 'AT_RISK' || goal.status === 'OFF_TRACK' ? 'danger' : 'brand'} />
              </div>
            </div>

            <SectionCard title={t('performance.keyResults')}>
              {(goal.keyResults ?? []).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('performance.noKeyResults')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(goal.keyResults ?? []).map((result) => (
                    <li key={result.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{result.title}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                        {result.currentValue} / {result.targetValue} {result.unit ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={t('performance.keyResultTitle')} htmlFor="kr-title">
                  <Input id="kr-title" value={krTitle} onChange={(event) => setKrTitle(event.target.value)} />
                </Field>
                <Field label={t('performance.targetValue')} htmlFor="kr-target">
                  <Input id="kr-target" type="number" className="sm:w-32" value={krTarget} onChange={(event) => setKrTarget(event.target.value)} />
                </Field>
                <Button size="sm" disabled={krTitle.trim().length < 2 || krTarget === ''} loading={addKeyResult.isPending} onClick={() => addKeyResult.mutate()}>
                  <Plus className="size-3.5" aria-hidden />
                  {t('performance.addKeyResult')}
                </Button>
              </div>
            </SectionCard>

            <SectionCard title={t('performance.updateProgress')}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('performance.progress')} htmlFor="goal-progress">
                  <Input id="goal-progress" type="number" min={0} max={100} value={progress} onChange={(event) => setProgress(event.target.value)} />
                </Field>
                <Field label={t('common.status')} htmlFor="goal-status">
                  <Select id="goal-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="">{t('common.none')}</option>
                    {GOAL_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`performance.status.${value}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-end gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={recompute} onChange={(event) => setRecompute(event.target.checked)} />
                  {t('performance.recomputeFromKeyResults')}
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" loading={updateProgress.isPending} onClick={() => updateProgress.mutate()}>
                  {t('common.save')}
                </Button>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GoalsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', type: '', employeeId: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GoalItem | null>(null);
  const [selected, setSelected] = useState<GoalItem | null>(null);

  const employees = useEmployeeOptions(open);
  const canPickEmployee = can('performance.manage');

  const list = useQuery({
    queryKey: ['performance', 'goals', { search, ...filters, page }],
    queryFn: () =>
      api.get<Paginated<GoalItem>>('/performance/goals', {
        query: {
          search: search || undefined,
          status: filters.status || undefined,
          type: filters.type || undefined,
          employeeId: filters.employeeId || undefined,
          page,
          pageSize: 10,
        },
      }),
  });

  const schema = useMemo(
    () =>
      z.object({
        employeeId: z.string().optional(),
        title: z.string().min(2, t('common.required')).max(200),
        description: z.string().max(2000).optional(),
        type: z.string().min(1, t('common.required')),
        status: z.string().min(1, t('common.required')),
        priority: z.string().min(1, t('common.required')),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        weight: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const normalize = (values: FormValues) => ({
    employeeId: values.employeeId || undefined,
    title: values.title,
    description: values.description || undefined,
    type: values.type,
    status: values.status,
    priority: values.priority,
    startDate: values.startDate || undefined,
    dueDate: values.dueDate || undefined,
    weight: values.weight ? Number(values.weight) : undefined,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing ? api.patch(`/performance/goals/${editing.id}`, normalize(values)) : api.post('/performance/goals', normalize(values)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['performance'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/performance/goals/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
    onError: (error) => toast.error(describeError(error)),
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
          placeholder={t('performance.searchGoals')}
          className="sm:w-60"
        />
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {GOAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`performance.status.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('performance.goalType')} className="sm:w-40" value={filters.type} onChange={(event) => update({ type: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {GOAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`performance.goalTypeValue.${type}`)}
            </option>
          ))}
        </Select>
        {can('performance.manage') ? (
          <Button className="sm:ml-auto" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('performance.newGoal')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState icon={Target} title={t('performance.noGoals')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('performance.goal')}</TableHead>
                    <TableHead>{t('performance.employee')}</TableHead>
                    <TableHead>{t('performance.progress')}</TableHead>
                    <TableHead>{t('performance.dueDate')}</TableHead>
                    <TableHead>{t('performance.priority')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((goal) => (
                    <TableRow key={goal.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {goal.title}
                        <span className="block text-xs text-slate-500">
                          {t(`performance.goalTypeValue.${goal.type}`, { defaultValue: goal.type })}
                        </span>
                      </TableCell>
                      <TableCell>{goal.employee ? `${goal.employee.firstName} ${goal.employee.lastName}` : '—'}</TableCell>
                      <TableCell className="w-40">
                        <div className="flex items-center gap-2">
                          <span className="w-10 tabular-nums text-xs">{goal.progress}%</span>
                          <span className="min-w-16 flex-1">
                            <ProgressBar value={goal.progress} tone={goal.status === 'AT_RISK' || goal.status === 'OFF_TRACK' ? 'danger' : 'brand'} />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(goal.dueDate)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(goal.priority)}>{t(`performance.priorityValue.${goal.priority}`, { defaultValue: goal.priority })}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusTone(goal.status)}>{t(`performance.status.${goal.status}`, { defaultValue: goal.status })}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSelected(goal)}>
                            {t('common.details')}
                          </Button>
                          {can('performance.manage') ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => { setEditing(goal); setOpen(true); }}>
                                {t('common.edit')}
                              </Button>
                              <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(goal.id)}>
                                {t('common.delete')}
                              </Button>
                            </>
                          ) : null}
                        </span>
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

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('performance.editGoal') : t('performance.newGoal')}
        schema={schema}
        defaultValues={{
          employeeId: editing?.employeeId ?? '',
          title: editing?.title ?? '',
          description: editing?.description ?? '',
          type: editing?.type ?? 'GOAL',
          status: editing?.status ?? 'ACTIVE',
          priority: editing?.priority ?? 'MEDIUM',
          startDate: toDateInputValue(editing?.startDate),
          dueDate: toDateInputValue(editing?.dueDate),
          weight: editing?.weight != null ? String(editing.weight) : '',
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('performance.goal')} htmlFor="goal-title" error={form.formState.errors.title?.message}>
                <Input id="goal-title" {...form.register('title')} />
              </FormField>
              {canPickEmployee ? (
                <FormField label={t('performance.employee')} htmlFor="goal-employee">
                  <Select id="goal-employee" {...form.register('employeeId')}>
                    <option value="">{t('performance.forMyself')}</option>
                    {(employees.data?.data ?? []).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.firstName} {employee.lastName}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              <FormField label={t('performance.goalType')} htmlFor="goal-type">
                <Select id="goal-type" {...form.register('type')}>
                  {GOAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`performance.goalTypeValue.${type}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('performance.priority')} htmlFor="goal-priority">
                <Select id="goal-priority" {...form.register('priority')}>
                  {GOAL_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {t(`performance.priorityValue.${priority}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('common.status')} htmlFor="goal-form-status">
                <Select id="goal-form-status" {...form.register('status')}>
                  {GOAL_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`performance.status.${status}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('performance.weight')} htmlFor="goal-weight" hint={t('performance.weightHint')}>
                <Input id="goal-weight" type="number" min={0} max={100} {...form.register('weight')} />
              </FormField>
              <FormField label={t('performance.startDate')} htmlFor="goal-start">
                <Input id="goal-start" type="date" {...form.register('startDate')} />
              </FormField>
              <FormField label={t('performance.dueDate')} htmlFor="goal-due">
                <Input id="goal-due" type="date" {...form.register('dueDate')} />
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="goal-description">
              <Textarea id="goal-description" rows={3} {...form.register('description')} />
            </FormField>
          </>
        )}
      </FormDialog>

      <GoalDetailDialog goal={selected} onOpenChange={(value) => (!value ? setSelected(null) : undefined)} />
    </div>
  );
}

function FeedbackTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const employees = useEmployeeOptions(open);

  const list = useQuery({
    queryKey: ['performance', 'feedback', page],
    queryFn: () => api.get<Paginated<FeedbackItem>>('/performance/feedback', { query: { page, pageSize: 10 } }),
  });

  const schema = useMemo(
    () =>
      z.object({
        subjectEmployeeId: z.string().min(1, t('common.required')),
        message: z.string().min(5, t('common.required')).max(2000),
        type: z.string().min(1, t('common.required')),
        visibility: z.string().min(1, t('common.required')),
        isAnonymous: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/performance/feedback', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['performance', 'feedback'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t('performance.giveFeedback')}
        </Button>
      </div>
      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState title={t('performance.noFeedback')} description={t('performance.noFeedbackHint')} />}
        >
          {(data) => (
            <>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((item) => (
                  <li key={item.id} className="space-y-1 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Badge tone={statusTone(item.type)}>{t(`performance.feedbackType.${item.type}`, { defaultValue: item.type })}</Badge>
                      <span>{item.isAnonymous ? t('performance.anonymous') : item.authorName ?? '—'}</span>
                      <span>· {formatDate(item.createdAt)}</span>
                      <span>· {t(`performance.visibility.${item.visibility}`, { defaultValue: item.visibility })}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{item.message}</p>
                  </li>
                ))}
              </ul>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('performance.giveFeedback')}
        schema={schema}
        defaultValues={{ subjectEmployeeId: '', message: '', type: 'PRAISE', visibility: 'MANAGER', isAnonymous: false }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('performance.employee')} htmlFor="feedback-employee" error={form.formState.errors.subjectEmployeeId?.message}>
                <Select id="feedback-employee" {...form.register('subjectEmployeeId')}>
                  <option value="">{t('common.select')}</option>
                  {(employees.data?.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('performance.feedbackTypeLabel')} htmlFor="feedback-type">
                <Select id="feedback-type" {...form.register('type')}>
                  {FEEDBACK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`performance.feedbackType.${type}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('performance.visibilityLabel')} htmlFor="feedback-visibility">
                <Select id="feedback-visibility" {...form.register('visibility')}>
                  {FEEDBACK_VISIBILITIES.map((value) => (
                    <option key={value} value={value}>
                      {t(`performance.visibility.${value}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={form.watch('isAnonymous')} onChange={(event) => form.setValue('isAnonymous', event.target.checked)} />
                {t('performance.anonymous')}
              </label>
            </div>
            <FormField label={t('performance.message')} htmlFor="feedback-message" error={form.formState.errors.message?.message}>
              <Textarea id="feedback-message" rows={4} {...form.register('message')} />
            </FormField>
          </>
        )}
      </FormDialog>
    </div>
  );
}

export function PerformancePage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'dashboard', label: t('performance.dashboard'), permission: 'performance.self.view' },
    { value: 'cycles', label: t('performance.cycles'), permission: 'performance.view' },
    { value: 'reviews', label: t('performance.reviews'), permission: 'performance.self.view' },
    { value: 'goals', label: t('performance.goals'), permission: 'performance.self.view' },
    { value: 'feedback', label: t('performance.feedback'), permission: 'performance.self.view' },
  ].filter((tab) => can(tab.permission));

  const activeTab = params.get('tab') ?? 'dashboard';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : tabs[0]?.value ?? 'dashboard';

  return (
    <div className="space-y-6">
      <PageHeader title={t('performance.title')} description={t('performance.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="dashboard">{current === 'dashboard' ? <DashboardTab /> : null}</TabsContent>
        <TabsContent value="cycles">{current === 'cycles' ? <CyclesTab /> : null}</TabsContent>
        <TabsContent value="reviews">{current === 'reviews' ? <ReviewsTab /> : null}</TabsContent>
        <TabsContent value="goals">{current === 'goals' ? <GoalsTab /> : null}</TabsContent>
        <TabsContent value="feedback">{current === 'feedback' ? <FeedbackTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
