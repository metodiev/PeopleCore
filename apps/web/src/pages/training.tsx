import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  CertificationItem,
  CourseRow,
  EmployeeListItem,
  LearningPlanItem,
  SkillMatrixRow,
  TrainingAssignmentItem,
  TrainingDashboard,
  TrainingSkillRow,
} from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { BarPanel } from '../components/feature/charts.js';
import { DefinitionList, FilterBar, SearchInput, SectionCard, useDebouncedValue } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { ConfirmDialog, Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Field, Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const ENROLLMENT_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
const CERTIFICATION_STATUSES = ['VALID', 'EXPIRING', 'EXPIRED', 'REVOKED'] as const;

function useEmployeeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function TrainingDashboardTab() {
  const { t } = useTranslation();
  const dashboard = useQuery({ queryKey: ['training', 'dashboard'], queryFn: () => api.get<TrainingDashboard>('/training/dashboard') });

  return (
    <QueryBoundary query={dashboard} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={4} />}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('training.totalAssignments')} value={data.assignments.total} icon={<GraduationCap className="size-5" />} />
            <StatCard label={t('training.completionRate')} value={`${data.completionRate}%`} tone={data.completionRate >= 80 ? 'positive' : 'warning'} />
            <StatCard label={t('training.overdue')} value={data.assignments.overdue} tone={data.assignments.overdue > 0 ? 'danger' : 'positive'} />
            <StatCard label={t('training.dueWithin30Days')} value={data.assignments.dueWithin30Days} tone={data.assignments.dueWithin30Days > 0 ? 'warning' : 'default'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarPanel
              title={t('training.assignmentsByStatus')}
              data={ENROLLMENT_STATUSES.map((status) => ({ label: t(`training.status.${status}`), value: data.assignments[status] ?? 0 }))}
              xKey="label"
              series={[{ key: 'value', name: t('training.assignments'), color: '#6366f1' }]}
              multiColor
            />
            <BarPanel
              title={t('training.certificationsByStatus')}
              data={CERTIFICATION_STATUSES.map((status) => ({ label: t(`training.certificationStatus.${status}`), value: data.certifications[status] ?? 0 }))}
              xKey="label"
              series={[{ key: 'value', name: t('training.certifications'), color: '#10b981' }]}
              multiColor
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('training.requiredOpen')} value={data.assignments.requiredOpen} tone={data.assignments.requiredOpen > 0 ? 'warning' : 'default'} />
            <StatCard
              label={t('training.expiringCertifications')}
              value={data.certifications.EXPIRING ?? 0}
              hint={t('training.expiringWithinDays', { days: data.certifications.expiringWithinDays })}
              tone={(data.certifications.EXPIRING ?? 0) > 0 ? 'warning' : 'default'}
            />
            <StatCard label={t('training.activePlans')} value={data.activeLearningPlans} />
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function CoursesTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CourseRow | null>(null);

  const list = useQuery({
    queryKey: ['training', 'courses', { search, category, page }],
    queryFn: () =>
      api.get<Paginated<CourseRow>>('/training/courses', {
        query: { search: search || undefined, category: category || undefined, includeInactive: true, page, pageSize: 10 },
      }),
  });

  const schema = useMemo(
    () =>
      z.object({
        title: z.string().min(2, t('common.required')).max(200),
        description: z.string().max(2000).optional(),
        provider: z.string().max(160).optional(),
        url: z.string().max(500).optional(),
        category: z.string().max(80).optional(),
        durationHours: z.string().optional(),
        validityMonths: z.string().optional(),
        isRequired: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const normalize = (values: FormValues) => ({
    ...values,
    description: values.description || undefined,
    provider: values.provider || undefined,
    url: values.url || undefined,
    category: values.category || undefined,
    durationHours: values.durationHours ? Number(values.durationHours) : undefined,
    validityMonths: values.validityMonths ? Number(values.validityMonths) : undefined,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing ? api.patch(`/training/courses/${editing.id}`, normalize(values)) : api.post('/training/courses', normalize(values)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training'] }),
  });

  const toggle = useMutation({
    mutationFn: (course: CourseRow) => api.patch(`/training/courses/${course.id}`, { isActive: !course.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training'] }),
    onError: (error) => toast.error(describeError(error)),
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
          placeholder={t('training.searchCourses')}
          className="sm:w-64"
        />
        <Input
          aria-label={t('training.category')}
          className="sm:w-48"
          value={category}
          placeholder={t('training.category')}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
        />
        {can('training.manage') ? (
          <Button className="sm:ml-auto" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('training.newCourse')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState icon={GraduationCap} title={t('training.noCourses')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('training.course')}</TableHead>
                    <TableHead>{t('training.provider')}</TableHead>
                    <TableHead>{t('training.category')}</TableHead>
                    <TableHead>{t('training.durationHours')}</TableHead>
                    <TableHead>{t('training.assignments')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((course) => (
                    <TableRow key={course.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {course.title}
                        {course.isRequired ? <Badge tone="warning" className="ml-2">{t('training.required')}</Badge> : null}
                      </TableCell>
                      <TableCell>{course.provider ?? '—'}</TableCell>
                      <TableCell>{course.category ?? '—'}</TableCell>
                      <TableCell>{course.durationHours ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">{course._count?.assignments ?? 0}</TableCell>
                      <TableCell>
                        <Badge tone={course.isActive ? 'success' : 'neutral'}>{course.isActive ? t('common.active') : t('common.inactive')}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {can('training.manage') ? (
                          <span className="inline-flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => { setEditing(course); setOpen(true); }}>
                              {t('common.edit')}
                            </Button>
                            <Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate(course)}>
                              {course.isActive ? t('common.deactivate') : t('common.activate')}
                            </Button>
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
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('training.editCourse') : t('training.newCourse')}
        schema={schema}
        defaultValues={{
          title: editing?.title ?? '',
          description: editing?.description ?? '',
          provider: editing?.provider ?? '',
          url: editing?.url ?? '',
          category: editing?.category ?? '',
          durationHours: editing?.durationHours != null ? String(editing.durationHours) : '',
          validityMonths: editing?.validityMonths != null ? String(editing.validityMonths) : '',
          isRequired: editing?.isRequired ?? false,
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('training.course')} htmlFor="course-title" error={form.formState.errors.title?.message}>
                <Input id="course-title" {...form.register('title')} />
              </FormField>
              <FormField label={t('training.provider')} htmlFor="course-provider">
                <Input id="course-provider" {...form.register('provider')} />
              </FormField>
              <FormField label={t('training.category')} htmlFor="course-category">
                <Input id="course-category" {...form.register('category')} />
              </FormField>
              <FormField label={t('training.durationHours')} htmlFor="course-duration">
                <Input id="course-duration" type="number" min={0} step="0.5" {...form.register('durationHours')} />
              </FormField>
              <FormField label={t('training.validityMonths')} htmlFor="course-validity" hint={t('training.validityMonthsHint')}>
                <Input id="course-validity" type="number" min={1} {...form.register('validityMonths')} />
              </FormField>
              <FormField label={t('training.url')} htmlFor="course-url">
                <Input id="course-url" type="url" {...form.register('url')} />
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="course-description">
              <Textarea id="course-description" rows={3} {...form.register('description')} />
            </FormField>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('training.required')}
              <input type="checkbox" checked={form.watch('isRequired')} onChange={(event) => form.setValue('isRequired', event.target.checked)} />
            </label>
          </>
        )}
      </FormDialog>
    </div>
  );
}

function AssignmentsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingAssignmentItem | null>(null);

  const employees = useEmployeeOptions(open);
  const courses = useQuery({
    queryKey: ['training', 'courses', 'options'],
    queryFn: () => api.get<Paginated<CourseRow>>('/training/courses', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const list = useQuery({
    queryKey: ['training', 'assignments', { status, overdue, page }],
    queryFn: () =>
      api.get<Paginated<TrainingAssignmentItem>>('/training/assignments', {
        query: { status: status || undefined, overdue: overdue || undefined, page, pageSize: 10 },
      }),
  });

  const schema = useMemo(
    () =>
      z.object({
        employeeIds: z.array(z.string()).min(1, t('common.required')),
        courseId: z.string().min(1, t('common.required')),
        dueDate: z.string().optional(),
        notes: z.string().max(1000).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const assign = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/training/assignments', {
        employeeIds: values.employeeIds,
        courseId: values.courseId,
        dueDate: values.dueDate || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training'] }),
  });

  const update = useMutation({
    mutationFn: (payload: { id: string; body: Record<string, unknown> }) => api.patch(`/training/assignments/${payload.id}`, payload.body),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['training'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const [editStatus, setEditStatus] = useState('');
  const [editScore, setEditScore] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const openEdit = (assignment: TrainingAssignmentItem) => {
    setEditing(assignment);
    setEditStatus(assignment.status);
    setEditScore(assignment.score != null ? String(assignment.score) : '');
    setEditNotes(assignment.notes ?? '');
  };

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label={t('common.status')} className="sm:w-44" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {ENROLLMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`training.status.${value}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={overdue} onChange={(event) => { setOverdue(event.target.checked); setPage(1); }} />
          {t('training.overdueOnly')}
        </label>
        {can('training.manage') ? (
          <Button className="sm:ml-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('training.assignCourse')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('training.noAssignments')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('training.employee')}</TableHead>
                    <TableHead>{t('training.course')}</TableHead>
                    <TableHead>{t('training.assignedAt')}</TableHead>
                    <TableHead>{t('training.dueDate')}</TableHead>
                    <TableHead>{t('training.score')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((assignment) => (
                    <TableRow key={assignment.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {assignment.employee ? `${assignment.employee.firstName} ${assignment.employee.lastName}` : '—'}
                      </TableCell>
                      <TableCell>{assignment.course?.title ?? '—'}</TableCell>
                      <TableCell>{formatDate(assignment.assignedAt)}</TableCell>
                      <TableCell>{formatDate(assignment.dueDate)}</TableCell>
                      <TableCell className="tabular-nums">{assignment.score ?? '—'}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(assignment.status)}>{t(`training.status.${assignment.status}`, { defaultValue: assignment.status })}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {can('training.manage') ? (
                          <Button size="sm" variant="outline" onClick={() => openEdit(assignment)}>
                            {t('training.updateProgress')}
                          </Button>
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
        title={t('training.assignCourse')}
        schema={schema}
        defaultValues={{ employeeIds: [], courseId: '', dueDate: '', notes: '' }}
        onSubmit={(values) => assign.mutateAsync(values)}
        submitLabel={t('training.assignCourse')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('training.course')} htmlFor="assign-course" error={form.formState.errors.courseId?.message}>
                <Select id="assign-course" {...form.register('courseId')}>
                  <option value="">{t('common.select')}</option>
                  {(courses.data?.data ?? []).map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('training.dueDate')} htmlFor="assign-due">
                <Input id="assign-due" type="date" min={toDateInputValue(new Date())} {...form.register('dueDate')} />
              </FormField>
            </div>
            <Field label={t('training.employees')} htmlFor="assign-employees" error={form.formState.errors.employeeIds?.message} hint={t('training.employeesHint')}>
              <select id="assign-employees" multiple size={6} className="input h-auto" {...form.register('employeeIds')}>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <FormField label={t('training.notes')} htmlFor="assign-notes">
              <Textarea id="assign-notes" rows={2} {...form.register('notes')} />
            </FormField>
          </>
        )}
      </FormDialog>

      <Dialog open={Boolean(editing)} onOpenChange={(value) => (!value ? setEditing(null) : undefined)}>
        <DialogContent title={t('training.updateProgress')} description={editing?.course?.title}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.status')} htmlFor="assignment-status">
                <Select id="assignment-status" value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
                  {ENROLLMENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`training.status.${value}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('training.score')} htmlFor="assignment-score">
                <Input id="assignment-score" type="number" min={0} max={100} value={editScore} onChange={(event) => setEditScore(event.target.value)} />
              </Field>
            </div>
            <Field label={t('training.notes')} htmlFor="assignment-notes">
              <Textarea id="assignment-notes" rows={2} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={update.isPending}
                onClick={() => {
                  if (!editing) return;
                  update.mutate({
                    id: editing.id,
                    body: {
                      status: editStatus || undefined,
                      score: editScore === '' ? undefined : Number(editScore),
                      notes: editNotes || undefined,
                    },
                  });
                }}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CertificationsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CertificationItem | null>(null);
  const employees = useEmployeeOptions(open || can('training.manage'));

  const list = useQuery({
    queryKey: ['training', 'certifications', { status, page }],
    queryFn: () =>
      api.get<Paginated<CertificationItem>>('/training/certifications', {
        query: { status: status || undefined, page, pageSize: 10 },
      }),
  });
  const expiring = useQuery({
    queryKey: ['training', 'certifications', 'expiring'],
    queryFn: () => api.get<CertificationItem[]>('/training/certifications/expiring', { query: { days: 60 } }),
  });

  const schema = useMemo(
    () =>
      z.object({
        employeeId: z.string().optional(),
        name: z.string().min(2, t('common.required')).max(200),
        issuer: z.string().max(160).optional(),
        issuedDate: z.string().min(1, t('common.required')),
        expiresAt: z.string().optional(),
        notes: z.string().max(1000).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/training/certifications', {
        ...values,
        employeeId: values.employeeId || undefined,
        issuer: values.issuer || undefined,
        expiresAt: values.expiresAt || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/training/certifications/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['training'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {(expiring.data ?? []).length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-900/10">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {t('training.expiringBanner', { count: expiring.data?.length ?? 0 })}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-800/90 dark:text-amber-200/90">
              {(expiring.data ?? []).slice(0, 5).map((certification) => (
                <li key={certification.id}>
                  {certification.name}
                  {certification.employee ? ` · ${certification.employee.firstName} ${certification.employee.lastName}` : ''} · {formatDate(certification.expiresAt)}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      <FilterBar>
        <Select aria-label={t('common.status')} className="sm:w-44" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {CERTIFICATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`training.certificationStatus.${value}`)}
            </option>
          ))}
        </Select>
        {can('training.manage') ? (
          <Button className="sm:ml-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('training.newCertification')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('training.noCertifications')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('training.name')}</TableHead>
                    <TableHead>{t('training.employee')}</TableHead>
                    <TableHead>{t('training.issuer')}</TableHead>
                    <TableHead>{t('training.issuedDate')}</TableHead>
                    <TableHead>{t('training.expiresAt')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((certification) => (
                    <TableRow key={certification.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{certification.name}</TableCell>
                      <TableCell>
                        {certification.employee ? `${certification.employee.firstName} ${certification.employee.lastName}` : '—'}
                      </TableCell>
                      <TableCell>{certification.issuer ?? '—'}</TableCell>
                      <TableCell>{formatDate(certification.issuedDate)}</TableCell>
                      <TableCell>{formatDate(certification.expiresAt)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(certification.status)}>
                          {t(`training.certificationStatus.${certification.status}`, { defaultValue: certification.status })}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {can('training.manage') ? (
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(certification)}>
                            {t('common.delete')}
                          </Button>
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
        title={t('training.newCertification')}
        schema={schema}
        defaultValues={{ employeeId: '', name: '', issuer: '', issuedDate: toDateInputValue(new Date()), expiresAt: '', notes: '' }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('training.name')} htmlFor="cert-name" error={form.formState.errors.name?.message}>
                <Input id="cert-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('training.employee')} htmlFor="cert-employee" hint={t('training.employeeHint')}>
                <Select id="cert-employee" {...form.register('employeeId')}>
                  <option value="">{t('training.forMyself')}</option>
                  {(employees.data?.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('training.issuer')} htmlFor="cert-issuer">
                <Input id="cert-issuer" {...form.register('issuer')} />
              </FormField>
              <FormField label={t('training.issuedDate')} htmlFor="cert-issued" error={form.formState.errors.issuedDate?.message}>
                <Input id="cert-issued" type="date" {...form.register('issuedDate')} />
              </FormField>
              <FormField label={t('training.expiresAt')} htmlFor="cert-expires">
                <Input id="cert-expires" type="date" {...form.register('expiresAt')} />
              </FormField>
            </div>
            <FormField label={t('training.notes')} htmlFor="cert-notes">
              <Textarea id="cert-notes" rows={2} {...form.register('notes')} />
            </FormField>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('training.deleteCertification')}
        description={toDelete?.name}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </div>
  );
}

function SkillsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [matrixSearch, setMatrixSearch] = useState('');
  const matrixTerm = useDebouncedValue(matrixSearch, 300);

  const skills = useQuery({
    queryKey: ['training', 'skills', { search, page }],
    queryFn: () => api.get<Paginated<TrainingSkillRow>>('/training/skills', { query: { search: search || undefined, page, pageSize: 10 } }),
    enabled: view === 'list',
  });
  const matrix = useQuery({
    queryKey: ['training', 'matrix', matrixTerm],
    queryFn: () => api.get<SkillMatrixRow[]>('/training/skills/matrix', { query: { search: matrixTerm || undefined } }),
    enabled: view === 'matrix',
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(120),
        category: z.string().max(80).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/training/skills', { ...values, category: values.category || undefined }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['training'] }),
  });

  const skillColumns = useMemo(() => {
    const names = new Set<string>();
    for (const row of matrix.data ?? []) {
      for (const skill of row.skills) names.add(skill.skillName);
    }
    return [...names].sort();
  }, [matrix.data]);

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label={t('training.view')} className="sm:w-40" value={view} onChange={(event) => setView(event.target.value as 'list' | 'matrix')}>
          <option value="list">{t('training.skillList')}</option>
          <option value="matrix">{t('training.skillMatrix')}</option>
        </Select>
        {view === 'list' ? (
          <SearchInput
            value={term}
            onChange={(value) => {
              setTerm(value);
              setPage(1);
            }}
            placeholder={t('training.searchSkills')}
            className="sm:w-60"
          />
        ) : (
          <SearchInput value={matrixSearch} onChange={setMatrixSearch} placeholder={t('training.searchEmployees')} className="sm:w-60" />
        )}
        {view === 'list' && can('training.manage') ? (
          <Button className="sm:ml-auto" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('training.newSkill')}
          </Button>
        ) : null}
      </FilterBar>

      {view === 'list' ? (
        <Card>
          <QueryBoundary query={skills} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('training.noSkills')} />}>
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('training.name')}</TableHead>
                      <TableHead>{t('training.category')}</TableHead>
                      <TableHead>{t('training.employeesWithSkill')}</TableHead>
                      <TableHead>{t('training.courses')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((skill) => (
                      <TableRow key={skill.id}>
                        <TableCell className="font-medium text-slate-900 dark:text-slate-100">{skill.name}</TableCell>
                        <TableCell>{skill.category ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">{skill._count?.employees ?? 0}</TableCell>
                        <TableCell className="tabular-nums">{skill._count?.courses ?? 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
              </>
            )}
          </QueryBoundary>
        </Card>
      ) : (
        <Card>
          <QueryBoundary query={matrix} isEmpty={(data) => data.length === 0} empty={<EmptyState title={t('training.noSkills')} />}>
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('training.employee')}</TableHead>
                    {skillColumns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.employee.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {row.employee.firstName} {row.employee.lastName}
                        {row.employee.department ? <span className="block text-xs text-slate-500">{row.employee.department.name}</span> : null}
                      </TableCell>
                      {skillColumns.map((column) => {
                        const skill = row.skills.find((entry) => entry.skillName === column);
                        return (
                          <TableCell key={column} className="tabular-nums">
                            {skill ? <Badge tone={skill.level >= 4 ? 'success' : skill.level >= 2 ? 'info' : 'neutral'}>{skill.level}</Badge> : '—'}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </Card>
      )}

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('training.newSkill')}
        schema={schema}
        defaultValues={{ name: '', category: '' }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('training.name')} htmlFor="skill-name" error={form.formState.errors.name?.message}>
              <Input id="skill-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('training.category')} htmlFor="skill-category">
              <Input id="skill-category" {...form.register('category')} />
            </FormField>
          </div>
        )}
      </FormDialog>
    </div>
  );
}

function PlansTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<LearningPlanItem | null>(null);
  const [courseId, setCourseId] = useState('');
  const employees = useEmployeeOptions(open || can('training.manage'));

  const list = useQuery({
    queryKey: ['training', 'plans', page],
    queryFn: () => api.get<Paginated<LearningPlanItem>>('/training/plans', { query: { page, pageSize: 10 } }),
  });
  const courses = useQuery({
    queryKey: ['training', 'courses', 'options'],
    queryFn: () => api.get<Paginated<CourseRow>>('/training/courses', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        employeeId: z.string().optional(),
        name: z.string().min(2, t('common.required')).max(160),
        description: z.string().max(1000).optional(),
        targetDate: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['training'] });
  const onError = (error: unknown) => toast.error(describeError(error));

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/training/plans', {
        ...values,
        employeeId: values.employeeId || undefined,
        description: values.description || undefined,
        targetDate: values.targetDate || undefined,
      }),
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: (planId: string) => api.post(`/training/plans/${planId}/items`, { courseId }),
    onSuccess: () => {
      setCourseId('');
      toast.success(t('common.created'));
      invalidate();
    },
    onError,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: string }) => api.patch(`/training/plans/items/${itemId}`, { status }),
    onSuccess: invalidate,
    onError,
  });

  const complete = useMutation({
    mutationFn: (planId: string) => api.post(`/training/plans/${planId}/complete`),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setSelected(null);
      invalidate();
    },
    onError,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {can('training.manage') ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('training.newPlan')}
          </Button>
        ) : null}
      </div>
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('training.noPlans')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('training.plan')}</TableHead>
                    <TableHead>{t('training.employee')}</TableHead>
                    <TableHead>{t('training.targetDate')}</TableHead>
                    <TableHead>{t('training.items')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{plan.name}</TableCell>
                      <TableCell>{plan.employee ? `${plan.employee.firstName} ${plan.employee.lastName}` : '—'}</TableCell>
                      <TableCell>{formatDate(plan.targetDate)}</TableCell>
                      <TableCell className="tabular-nums">{(plan.items ?? []).length}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(plan.status)}>{t(`training.planStatus.${plan.status}`, { defaultValue: plan.status })}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(plan)}>
                          {t('common.details')}
                        </Button>
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
        title={t('training.newPlan')}
        schema={schema}
        defaultValues={{ employeeId: '', name: '', description: '', targetDate: '' }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('training.plan')} htmlFor="plan-name" error={form.formState.errors.name?.message}>
                <Input id="plan-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('training.employee')} htmlFor="plan-employee" hint={t('training.employeeHint')}>
                <Select id="plan-employee" {...form.register('employeeId')}>
                  <option value="">{t('training.forMyself')}</option>
                  {(employees.data?.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('training.targetDate')} htmlFor="plan-target">
                <Input id="plan-target" type="date" {...form.register('targetDate')} />
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="plan-description">
              <Textarea id="plan-description" rows={2} {...form.register('description')} />
            </FormField>
          </>
        )}
      </FormDialog>

      <Dialog open={Boolean(selected)} onOpenChange={(value) => (!value ? setSelected(null) : undefined)}>
        <DialogContent title={selected?.name ?? ''} description={t('training.planItems')} className="w-[min(96vw,44rem)]">
          {selected ? (
            <div className="space-y-4">
              <DefinitionList
                items={[
                  { label: t('training.employee'), value: selected.employee ? `${selected.employee.firstName} ${selected.employee.lastName}` : '—' },
                  { label: t('training.targetDate'), value: formatDate(selected.targetDate) },
                  { label: t('common.status'), value: <Badge tone={statusTone(selected.status)}>{t(`training.planStatus.${selected.status}`, { defaultValue: selected.status })}</Badge> },
                ]}
              />
              <SectionCard title={t('training.items')}>
                {(selected.items ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('training.noPlanItems')}</p>
                ) : (
                  <ul className="space-y-2">
                    {(selected.items ?? [])
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((item) => (
                        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-slate-700 dark:text-slate-200">{item.course?.title ?? item.courseId}</span>
                          <span className="flex items-center gap-2">
                            <Badge tone={statusTone(item.status)}>{t(`training.status.${item.status}`, { defaultValue: item.status })}</Badge>
                            {can('training.manage') ? (
                              <Select
                                aria-label={t('training.updateProgress')}
                                className="w-36"
                                value={item.status}
                                onChange={(event) => updateItem.mutate({ itemId: item.id, status: event.target.value })}
                              >
                                {ENROLLMENT_STATUSES.map((value) => (
                                  <option key={value} value={value}>
                                    {t(`training.status.${value}`)}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </SectionCard>
              {can('training.manage') ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('training.addCourse')} htmlFor="plan-course">
                    <Select id="plan-course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                      <option value="">{t('common.select')}</option>
                      {(courses.data?.data ?? []).map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button size="sm" disabled={!courseId} loading={addItem.isPending} onClick={() => addItem.mutate(selected.id)}>
                    <Plus className="size-3.5" aria-hidden />
                    {t('training.addItem')}
                  </Button>
                  <Button size="sm" variant="outline" className="ml-auto" loading={complete.isPending} onClick={() => complete.mutate(selected.id)}>
                    {t('training.completePlan')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TrainingPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'dashboard', label: t('training.dashboard') },
    { value: 'courses', label: t('training.courses') },
    { value: 'assignments', label: t('training.assignments') },
    { value: 'certifications', label: t('training.certifications') },
    { value: 'skills', label: t('training.skills') },
    { value: 'plans', label: t('training.plans') },
  ];

  const activeTab = params.get('tab') ?? 'dashboard';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'dashboard';

  return (
    <div className="space-y-6">
      <PageHeader title={t('training.title')} description={t('training.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="dashboard">{current === 'dashboard' ? <TrainingDashboardTab /> : null}</TabsContent>
        <TabsContent value="courses">{current === 'courses' ? <CoursesTab /> : null}</TabsContent>
        <TabsContent value="assignments">{current === 'assignments' ? <AssignmentsTab /> : null}</TabsContent>
        <TabsContent value="certifications">{current === 'certifications' ? <CertificationsTab /> : null}</TabsContent>
        <TabsContent value="skills">{current === 'skills' ? <SkillsTab /> : null}</TabsContent>
        <TabsContent value="plans">{current === 'plans' ? <PlansTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
