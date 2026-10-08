import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MapPin, Pencil, Phone, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { Employee360, EmployeeListItem, EmploymentHistoryItem, NamedRef } from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary } from '../components/feature/query.js';
import {
  AttendanceTab,
  CompensationTab,
  DocumentsTab,
  EmploymentTab,
  LeaveTab,
  OrganizationTab,
} from '../components/feature/employee/employee-data-tabs.js';
import {
  ActivityTab,
  AssetsTab,
  ExpensesTab,
  PerformanceTab,
  RequestsTab,
  TrainingTab,
} from '../components/feature/employee/employee-more-tabs.js';
import { ProfileSubResources } from '../components/feature/employee/profile-sub-resources.js';
import { DefinitionList, SectionCard } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { ErrorState, EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Input, Select } from '../components/ui/input.js';
import { Avatar, PageHeader } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'] as const;

function EditEmployeeDialog(props: { employee: Employee360 | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const employee = props.employee;

  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    enabled: Boolean(employee),
    staleTime: 5 * 60_000,
  });
  const locations = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/locations', { query: { pageSize: 100 } }),
    enabled: Boolean(employee),
    staleTime: 5 * 60_000,
  });
  const positions = useQuery({
    queryKey: ['positions', 'options'],
    queryFn: () => api.get<Paginated<{ id: string; title: string }>>('/positions', { query: { pageSize: 100 } }),
    enabled: Boolean(employee),
    staleTime: 5 * 60_000,
  });
  const managers = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: Boolean(employee),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().min(1, t('common.required')).max(80),
        lastName: z.string().min(1, t('common.required')).max(80),
        preferredName: z.string().max(80).optional(),
        workEmail: z.string().min(1, t('common.required')).email(t('validation.email')),
        phone: z.string().max(40).optional(),
        birthDate: z.string().optional(),
        employmentType: z.string().min(1, t('common.required')),
        departmentId: z.string().optional(),
        positionId: z.string().optional(),
        locationId: z.string().optional(),
        managerId: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.patch(`/employees/${employee?.profile.id}`, {
        ...values,
        preferredName: values.preferredName || undefined,
        phone: values.phone || undefined,
        birthDate: values.birthDate || undefined,
        departmentId: values.departmentId || undefined,
        positionId: values.positionId || undefined,
        locationId: values.locationId || undefined,
        managerId: values.managerId || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employees', 'detail'] }),
  });

  return (
    <FormDialog<FormValues>
      open={Boolean(employee)}
      onOpenChange={props.onOpenChange}
      title={t('employee.editEmployee')}
      schema={schema}
      className="w-[min(96vw,46rem)]"
      defaultValues={{
        firstName: employee?.profile.firstName ?? '',
        lastName: employee?.profile.lastName ?? '',
        preferredName: employee?.profile.preferredName ?? '',
        workEmail: employee?.profile.workEmail ?? '',
        phone: employee?.profile.phone ?? '',
        birthDate: toDateInputValue(employee?.profile.birthDate),
        employmentType: employee?.profile.employmentType ?? 'FULL_TIME',
        departmentId: employee?.profile.department?.id ?? '',
        positionId: employee?.profile.position?.id ?? '',
        locationId: employee?.profile.location?.id ?? '',
        managerId: employee?.profile.manager?.id ?? '',
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('auth.firstName')} htmlFor="edit-first" error={form.formState.errors.firstName?.message}>
            <Input id="edit-first" {...form.register('firstName')} />
          </FormField>
          <FormField label={t('auth.lastName')} htmlFor="edit-last" error={form.formState.errors.lastName?.message}>
            <Input id="edit-last" {...form.register('lastName')} />
          </FormField>
          <FormField label={t('employee.preferredName')} htmlFor="edit-preferred">
            <Input id="edit-preferred" {...form.register('preferredName')} />
          </FormField>
          <FormField label={t('people.workEmail')} htmlFor="edit-email" error={form.formState.errors.workEmail?.message}>
            <Input id="edit-email" type="email" {...form.register('workEmail')} />
          </FormField>
          <FormField label={t('people.phone')} htmlFor="edit-phone">
            <Input id="edit-phone" {...form.register('phone')} />
          </FormField>
          <FormField label={t('profile.birthDate')} htmlFor="edit-birth">
            <Input id="edit-birth" type="date" {...form.register('birthDate')} />
          </FormField>
          <FormField label={t('people.employmentTypeLabel')} htmlFor="edit-type">
            <Select id="edit-type" {...form.register('employmentType')}>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`people.employmentType.${type}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('people.department')} htmlFor="edit-department">
            <Select id="edit-department" {...form.register('departmentId')}>
              <option value="">{t('common.none')}</option>
              {(departments.data?.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('people.position')} htmlFor="edit-position">
            <Select id="edit-position" {...form.register('positionId')}>
              <option value="">{t('common.none')}</option>
              {(positions.data?.data ?? []).map((position) => (
                <option key={position.id} value={position.id}>
                  {position.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('people.location')} htmlFor="edit-location">
            <Select id="edit-location" {...form.register('locationId')}>
              <option value="">{t('common.none')}</option>
              {(locations.data?.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('people.manager')} htmlFor="edit-manager">
            <Select id="edit-manager" {...form.register('managerId')}>
              <option value="">{t('common.none')}</option>
              {(managers.data?.data ?? []).filter((entry) => entry.id !== employee?.profile.id).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.firstName} {entry.lastName}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      )}
    </FormDialog>
  );
}

function TerminateDialog(props: { employee: Employee360 | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        terminationDate: z.string().min(1, t('common.required')),
        reason: z.string().max(500).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const terminate = useMutation({
    mutationFn: (values: FormValues) =>
      api.post(`/employees/${props.employee?.profile.id}/terminate`, { terminationDate: values.terminationDate, reason: values.reason || undefined }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  return (
    <FormDialog<FormValues>
      open={Boolean(props.employee)}
      onOpenChange={props.onOpenChange}
      title={t('employee.terminate')}
      description={t('employee.terminateHint')}
      schema={schema}
      defaultValues={{ terminationDate: toDateInputValue(new Date()), reason: '' }}
      onSubmit={(values) => terminate.mutateAsync(values)}
      submitLabel={t('employee.terminate')}
    >
      {(form) => (
        <>
          <FormField label={t('employee.terminationDate')} htmlFor="terminate-date" error={form.formState.errors.terminationDate?.message}>
            <Input id="terminate-date" type="date" {...form.register('terminationDate')} />
          </FormField>
          <FormField label={t('leave.reason')} htmlFor="terminate-reason">
            <Input id="terminate-reason" {...form.register('reason')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function ProfileOverviewTab({ data, allowEdit }: { data: Employee360; allowEdit: boolean }) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ['employees', 'history', data.profile.id],
    queryFn: () => api.get<EmploymentHistoryItem[]>(`/employees/${data.profile.id}/history`),
  });
  const profile = data.profile;

  return (
    <div className="space-y-4">
      <SectionCard title={t('employee.personal')}>
        <DefinitionList
          items={[
            { label: t('people.employeeNumber'), value: profile.employeeNumber },
            { label: t('people.workEmail'), value: profile.workEmail },
            { label: t('profile.personalEmail'), value: profile.personalEmail ?? '—' },
            { label: t('people.phone'), value: profile.phone ?? '—' },
            { label: t('profile.birthDate'), value: formatDate(profile.birthDate) },
            { label: t('profile.gender'), value: profile.gender ? t(`people.gender.${profile.gender}`, { defaultValue: profile.gender }) : '—' },
            { label: t('profile.address'), value: profile.address ?? '—' },
            { label: t('profile.city'), value: profile.city ?? '—' },
            { label: t('profile.country'), value: profile.country ?? '—' },
            { label: t('employee.workingHours'), value: profile.workingHoursPerWeek ?? '—' },
          ]}
        />
      </SectionCard>

      <SectionCard title={t('employeeProfile.title')} description={t('employeeProfile.hint')}>
        <ProfileSubResources employeeId={profile.id} allowEdit={allowEdit} />
      </SectionCard>

      <SectionCard title={t('employee.history')}>
        <QueryBoundary
          query={history}
          isEmpty={(entries) => entries.length === 0}
          empty={<EmptyState title={t('employee.noHistory')} />}
          skeleton={<TableSkeleton rows={3} columns={3} />}
        >
          {(entries) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('employee.effectiveFrom')}</TableHead>
                  <TableHead>{t('employee.changeType')}</TableHead>
                  <TableHead>{t('common.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.effectiveFrom)}</TableCell>
                    <TableCell>{t(`employee.changeTypes.${entry.changeType ?? 'OTHER'}`, { defaultValue: entry.changeType ?? '—' })}</TableCell>
                    <TableCell>{entry.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </SectionCard>
    </div>
  );
}

export function EmployeePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);

  const employee = useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: () => api.get<Employee360>(`/employees/${id}/360`),
    enabled: Boolean(id),
  });

  const tabs = [
    { value: 'overview', label: t('people.tabs.overview') },
    { value: 'employment', label: t('people.tabs.employment') },
    { value: 'organization', label: t('people.tabs.organization') },
    { value: 'compensation', label: t('people.tabs.compensation') },
    { value: 'leave', label: t('people.tabs.leave') },
    { value: 'attendance', label: t('people.tabs.attendance') },
    { value: 'documents', label: t('people.tabs.documents') },
    { value: 'performance', label: t('people.tabs.performance') },
    { value: 'training', label: t('people.tabs.training') },
    { value: 'assets', label: t('people.tabs.assets') },
    { value: 'expenses', label: t('people.tabs.expenses') },
    { value: 'requests', label: t('people.tabs.requests') },
    { value: 'activity', label: t('people.tabs.activity') },
  ];

  const activeTab = params.get('tab') ?? 'overview';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'overview';
  const data = employee.data;

  return (
    <div className="space-y-6">
      {employee.isError ? (
        <Card>
          <ErrorState message={t('employee.notFound')} onRetry={() => void employee.refetch()} />
        </Card>
      ) : (
        <>
          <PageHeader
            title={t('employee.title')}
            breadcrumb={
              <Link to="/people" className="hover:underline">
                ← {t('nav.people')}
              </Link>
            }
            actions={
              data ? (
                <>
                  {can('employees.edit') ? (
                    <Button variant="outline" onClick={() => setEditOpen(true)}>
                      <Pencil className="size-4" aria-hidden />
                      {t('common.edit')}
                    </Button>
                  ) : null}
                  {can('employees.terminate') && data.profile.status !== 'TERMINATED' ? (
                    <Button variant="danger" onClick={() => setTerminateOpen(true)}>
                      <UserX className="size-4" aria-hidden />
                      {t('employee.terminate')}
                    </Button>
                  ) : null}
                </>
              ) : undefined
            }
          />

          <QueryBoundary
            query={employee}
            isEmpty={() => false}
            skeleton={
              <Card>
                <TableSkeleton rows={4} columns={4} />
              </Card>
            }
          >
            {(payload) => (
              <Card className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <Avatar
                    firstName={payload.profile.firstName}
                    lastName={payload.profile.lastName}
                    src={payload.profile.photoUrl}
                    className="size-16 text-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                        {payload.profile.firstName} {payload.profile.lastName}
                      </h2>
                      <Badge tone={statusTone(payload.profile.status)}>
                        {t(`people.status.${payload.profile.status}`, { defaultValue: payload.profile.status })}
                      </Badge>
                      <span className="font-mono text-xs text-slate-500">{payload.profile.employeeNumber}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {payload.profile.position?.title ?? '—'} · {payload.profile.department?.name ?? '—'}
                      {payload.profile.location ? ` · ${payload.profile.location.name}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3.5" aria-hidden />
                        {payload.profile.workEmail}
                      </span>
                      {payload.profile.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3.5" aria-hidden />
                          {payload.profile.phone}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {payload.profile.city ?? payload.profile.country ?? '—'}
                      </span>
                      <span>
                        {t('people.hireDate')}: {formatDate(payload.profile.hireDate)}
                      </span>
                      {payload.profile.manager ? (
                        <span>
                          {t('people.manager')}:{' '}
                          <Link to={`/people/${payload.profile.manager.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                            {payload.profile.manager.firstName} {payload.profile.manager.lastName}
                          </Link>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </QueryBoundary>

          <QueryBoundary query={employee} isEmpty={() => false} skeleton={<TableSkeleton rows={6} columns={6} />}>
            {(payload) => (
              <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
                <TabsList>
                  {tabs.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="overview">
                  {current === 'overview' ? <ProfileOverviewTab data={payload} allowEdit={can('employees.edit')} /> : null}
                </TabsContent>
                <TabsContent value="employment">{current === 'employment' ? <EmploymentTab data={payload} /> : null}</TabsContent>
                <TabsContent value="organization">{current === 'organization' ? <OrganizationTab data={payload} /> : null}</TabsContent>
                <TabsContent value="compensation">{current === 'compensation' ? <CompensationTab data={payload} /> : null}</TabsContent>
                <TabsContent value="leave">{current === 'leave' ? <LeaveTab data={payload} /> : null}</TabsContent>
                <TabsContent value="attendance">{current === 'attendance' ? <AttendanceTab data={payload} /> : null}</TabsContent>
                <TabsContent value="documents">{current === 'documents' ? <DocumentsTab data={payload} /> : null}</TabsContent>
                <TabsContent value="performance">{current === 'performance' ? <PerformanceTab data={payload} /> : null}</TabsContent>
                <TabsContent value="training">{current === 'training' ? <TrainingTab data={payload} /> : null}</TabsContent>
                <TabsContent value="assets">{current === 'assets' ? <AssetsTab data={payload} /> : null}</TabsContent>
                <TabsContent value="expenses">{current === 'expenses' ? <ExpensesTab data={payload} /> : null}</TabsContent>
                <TabsContent value="requests">{current === 'requests' ? <RequestsTab data={payload} /> : null}</TabsContent>
                <TabsContent value="activity">{current === 'activity' ? <ActivityTab data={payload} /> : null}</TabsContent>
              </Tabs>
            )}
          </QueryBoundary>

          <EditEmployeeDialog employee={data && editOpen ? data : null} onOpenChange={(open) => (!open ? setEditOpen(false) : undefined)} />
          <TerminateDialog employee={data && terminateOpen ? data : null} onOpenChange={(open) => (!open ? setTerminateOpen(false) : undefined)} />
        </>
      )}
    </div>
  );
}
