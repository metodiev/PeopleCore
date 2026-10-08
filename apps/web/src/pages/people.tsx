import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { EmployeeListItem, NamedRef } from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary } from '../components/feature/query.js';
import { ClickableRow, FilterBar, SearchInput, useDebouncedValue } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { EmptyState } from '../components/ui/feedback.js';
import { Input, Select } from '../components/ui/input.js';
import { Avatar, PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Switch } from '../components/ui/misc.js';

const STATUSES = ['ACTIVE', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'] as const;

interface PositionOption {
  id: string;
  title: string;
  department?: NamedRef | null;
}

function NewEmployeeDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });
  const locations = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/locations', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });
  const positions = useQuery({
    queryKey: ['positions', 'options'],
    queryFn: () => api.get<Paginated<PositionOption>>('/positions', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });
  const managers = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().min(1, t('common.required')).max(80),
        lastName: z.string().min(1, t('common.required')).max(80),
        workEmail: z.string().min(1, t('common.required')).email(t('validation.email')),
        employeeNumber: z.string().max(32).optional(),
        phone: z.string().max(40).optional(),
        hireDate: z.string().min(1, t('common.required')),
        employmentType: z.string().min(1, t('common.required')),
        departmentId: z.string().optional(),
        positionId: z.string().optional(),
        locationId: z.string().optional(),
        managerId: z.string().optional(),
        createUserAccount: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<EmployeeListItem>('/employees', {
        ...values,
        employeeNumber: values.employeeNumber || undefined,
        phone: values.phone || undefined,
        departmentId: values.departmentId || undefined,
        positionId: values.positionId || undefined,
        locationId: values.locationId || undefined,
        managerId: values.managerId || undefined,
        createUserAccount: values.createUserAccount || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('people.addEmployee')}
      schema={schema}
      className="w-[min(96vw,46rem)]"
      defaultValues={{
        firstName: '',
        lastName: '',
        workEmail: '',
        employeeNumber: '',
        phone: '',
        hireDate: toDateInputValue(new Date()),
        employmentType: 'FULL_TIME',
        departmentId: '',
        positionId: '',
        locationId: '',
        managerId: '',
        createUserAccount: false,
      }}
      onSubmit={(values) => create.mutateAsync(values)}
      submitLabel={t('common.create')}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('auth.firstName')} htmlFor="emp-first" error={form.formState.errors.firstName?.message}>
              <Input id="emp-first" {...form.register('firstName')} />
            </FormField>
            <FormField label={t('auth.lastName')} htmlFor="emp-last" error={form.formState.errors.lastName?.message}>
              <Input id="emp-last" {...form.register('lastName')} />
            </FormField>
            <FormField label={t('people.workEmail')} htmlFor="emp-email" error={form.formState.errors.workEmail?.message}>
              <Input id="emp-email" type="email" {...form.register('workEmail')} />
            </FormField>
            <FormField label={t('people.employeeNumber')} htmlFor="emp-number" hint={t('people.employeeNumberHint')}>
              <Input id="emp-number" {...form.register('employeeNumber')} />
            </FormField>
            <FormField label={t('people.hireDate')} htmlFor="emp-hire" error={form.formState.errors.hireDate?.message}>
              <Input id="emp-hire" type="date" {...form.register('hireDate')} />
            </FormField>
            <FormField label={t('people.employmentTypeLabel')} htmlFor="emp-type">
              <Select id="emp-type" {...form.register('employmentType')}>
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`people.employmentType.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.department')} htmlFor="emp-department">
              <Select id="emp-department" {...form.register('departmentId')}>
                <option value="">{t('common.none')}</option>
                {(departments.data?.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.position')} htmlFor="emp-position">
              <Select id="emp-position" {...form.register('positionId')}>
                <option value="">{t('common.none')}</option>
                {(positions.data?.data ?? []).map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.title}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.location')} htmlFor="emp-location">
              <Select id="emp-location" {...form.register('locationId')}>
                <option value="">{t('common.none')}</option>
                {(locations.data?.data ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.manager')} htmlFor="emp-manager">
              <Select id="emp-manager" {...form.register('managerId')}>
                <option value="">{t('common.none')}</option>
                {(managers.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.phone')} htmlFor="emp-phone">
              <Input id="emp-phone" {...form.register('phone')} />
            </FormField>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
            <span>
              {t('people.createAccount')}
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t('people.createAccountHint')}</span>
            </span>
            <Switch checked={form.watch('createUserAccount')} onCheckedChange={(checked) => form.setValue('createUserAccount', checked)} />
          </label>
        </>
      )}
    </FormDialog>
  );
}

export function PeoplePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const can = useAuth((state) => state.can);
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', departmentId: '', locationId: '' });
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });
  const locations = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/locations', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const employees = useQuery({
    queryKey: ['employees', 'list', { search, ...filters, page }],
    queryFn: () =>
      api.get<Paginated<EmployeeListItem>>('/employees', {
        query: {
          search: search || undefined,
          status: filters.status || undefined,
          departmentId: filters.departmentId || undefined,
          locationId: filters.locationId || undefined,
          page,
          pageSize: 10,
        },
      }),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('people.title')}
        description={t('people.subtitle')}
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={!can('employees.create')}>
            <Plus className="size-4" aria-hidden />
            {t('people.addEmployee')}
          </Button>
        }
      />

      <FilterBar>
        <SearchInput
          value={term}
          onChange={(value) => {
            setTerm(value);
            setPage(1);
          }}
          placeholder={t('people.searchPlaceholder')}
          className="sm:w-72"
        />
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`people.status.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('people.department')} className="sm:w-52" value={filters.departmentId} onChange={(event) => update({ departmentId: event.target.value })}>
          <option value="">{t('people.allDepartments')}</option>
          {(departments.data?.data ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('people.location')} className="sm:w-48" value={filters.locationId} onChange={(event) => update({ locationId: event.target.value })}>
          <option value="">{t('people.allLocations')}</option>
          {(locations.data?.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      <Card>
        <QueryBoundary
          query={employees}
          isEmpty={(data) => data.data.length === 0}
          empty={
            <EmptyState
              icon={Users}
              title={t('common.noResults')}
              description={t('common.noResultsHint')}
              action={can('employees.create') ? <Button onClick={() => setDialogOpen(true)}>{t('people.addEmployee')}</Button> : undefined}
            />
          }
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('people.employeeNumber')}</TableHead>
                    <TableHead>{t('people.name')}</TableHead>
                    <TableHead>{t('people.department')}</TableHead>
                    <TableHead>{t('people.manager')}</TableHead>
                    <TableHead>{t('people.hireDate')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((employee) => (
                    <ClickableRow key={employee.id} onActivate={() => navigate(`/people/${employee.id}`)}>
                      <TableCell className="font-mono text-xs">{employee.employeeNumber}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-3">
                          <Avatar firstName={employee.firstName} lastName={employee.lastName} src={employee.photoUrl} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                              {employee.firstName} {employee.lastName}
                            </span>
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{employee.workEmail}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block">{employee.department?.name ?? '—'}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{employee.position?.title ?? ''}</span>
                      </TableCell>
                      <TableCell>{employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'}</TableCell>
                      <TableCell>{formatDate(employee.hireDate)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(employee.status)}>{t(`people.status.${employee.status}`, { defaultValue: employee.status })}</Badge>
                      </TableCell>
                    </ClickableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>

      <NewEmployeeDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
