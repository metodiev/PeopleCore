import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, formatDateTime } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  AuditLogItem,
  EmployeeListItem,
  InvitationItem,
  LocationItem,
  NamedRef,
  PermissionModule,
  PositionItem,
  PrivacySettings,
  RoleSummary,
  TenantOverview,
  TenantProfile,
  TeamItem,
  UserAccountItem,
  WorkScheduleItem,
} from '../components/feature/api-types.js';
import { LeaveSettingsTabs } from '../components/feature/leave/settings-tabs.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { optionalNumber } from '../components/feature/schemas.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { BarPanel } from '../components/feature/charts.js';
import { NotificationPreferencesPanel } from '../components/feature/settings/notification-preferences.js';
import { FilterBar, SectionCard, useDebouncedValue, SearchInput } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { ConfirmDialog } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Field, Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
const SCHEDULE_TYPES = ['FIXED', 'FLEXIBLE', 'SHIFT', 'ROTATING', 'CUSTOM'] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function useEmployeeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useRoleOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['roles', 'options'],
    queryFn: () => api.get<RoleSummary[]>('/roles'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/* ── Company ─────────────────────────────────────────────────────────────── */

function CompanyPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const current = useQuery({ queryKey: ['tenant', 'current'], queryFn: () => api.get<TenantProfile>('/tenants/current') });
  const overview = useQuery({ queryKey: ['tenant', 'overview'], queryFn: () => api.get<TenantOverview>('/tenants/current/overview') });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(160),
        legalName: z.string().max(200).optional(),
        logoUrl: z.string().max(500).optional(),
        locale: z.string().min(2, t('common.required')).max(10),
        timezone: z.string().min(2, t('common.required')).max(80),
        currency: z.string().length(3, t('common.required')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.patch('/tenants/current', {
        ...values,
        legalName: values.legalName || undefined,
        logoUrl: values.logoUrl || undefined,
        currency: values.currency.toUpperCase(),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tenant'] }),
  });

  return (
    <div className="space-y-4">
      <QueryBoundary query={overview} isEmpty={() => false} skeleton={<TableSkeleton rows={2} columns={4} />}>
        {(data) => (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('settings.statUsers')} value={data.users} icon={<Users className="size-5" />} />
              <StatCard label={t('settings.statEmployees')} value={data.employees} hint={t('dashboard.activeEmployees') + `: ${data.activeEmployees}`} />
              <StatCard label={t('people.department')} value={data.departments} />
              <StatCard label={t('settings.statPendingInvites')} value={data.pendingInvites} tone={data.pendingInvites > 0 ? 'warning' : 'default'} />
            </div>
            <BarPanel
              title={t('settings.usersByRole')}
              data={data.usersByRole.map((entry) => ({ label: entry.role, count: entry.count }))}
              xKey="label"
              series={[{ key: 'count', name: t('settings.statUsers'), color: '#6366f1' }]}
              multiColor
            />
          </div>
        )}
      </QueryBoundary>

      <QueryBoundary query={current} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={2} />}>
        {(tenant) => (
          <SectionCard
            title={t('settings.company')}
            description={t('settings.companyHint')}
            action={
              can('settings.manage') ? (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  {t('common.edit')}
                </Button>
              ) : undefined
            }
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {[
                { label: t('settings.name'), value: tenant.name },
                { label: t('settings.slug'), value: tenant.slug },
                { label: t('settings.locale'), value: tenant.locale },
                { label: t('settings.timezone'), value: tenant.timezone },
                { label: t('settings.currency'), value: tenant.currency },
                { label: t('settings.plan'), value: tenant.plan ?? '—' },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-xs uppercase text-slate-500">{item.label}</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{String(item.value ?? '—')}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        )}
      </QueryBoundary>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('settings.company')}
        schema={schema}
        defaultValues={{
          name: current.data?.name ?? '',
          legalName: typeof current.data?.legalName === 'string' ? current.data.legalName : '',
          logoUrl: current.data?.logoUrl ?? '',
          locale: current.data?.locale ?? 'bg-BG',
          timezone: current.data?.timezone ?? 'Europe/Sofia',
          currency: current.data?.currency ?? 'EUR',
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('settings.name')} htmlFor="tenant-name" error={form.formState.errors.name?.message}>
              <Input id="tenant-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('settings.legalName')} htmlFor="tenant-legal">
              <Input id="tenant-legal" {...form.register('legalName')} />
            </FormField>
            <FormField label={t('settings.logoUrl')} htmlFor="tenant-logo">
              <Input id="tenant-logo" {...form.register('logoUrl')} />
            </FormField>
            <FormField label={t('settings.locale')} htmlFor="tenant-locale" error={form.formState.errors.locale?.message}>
              <Input id="tenant-locale" {...form.register('locale')} />
            </FormField>
            <FormField label={t('settings.timezone')} htmlFor="tenant-timezone" error={form.formState.errors.timezone?.message}>
              <Input id="tenant-timezone" {...form.register('timezone')} />
            </FormField>
            <FormField label={t('settings.currency')} htmlFor="tenant-currency" error={form.formState.errors.currency?.message}>
              <Input id="tenant-currency" maxLength={3} {...form.register('currency')} />
            </FormField>
          </div>
        )}
      </FormDialog>
    </div>
  );
}

/* ── Users ───────────────────────────────────────────────────────────────── */

function NewUserDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const roles = useRoleOptions(props.open);
  const employees = useEmployeeOptions(props.open);

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().min(1, t('common.required')).email(t('validation.email')),
        firstName: z.string().min(1, t('common.required')).max(80),
        lastName: z.string().min(1, t('common.required')).max(80),
        password: z.string().max(128).optional(),
        employeeId: z.string().optional(),
        roleKeys: z.array(z.string()),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/users', {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        password: values.password || undefined,
        employeeId: values.employeeId || undefined,
        roleKeys: values.roleKeys.length > 0 ? values.roleKeys : undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('settings.newUser')}
      schema={schema}
      defaultValues={{ email: '', firstName: '', lastName: '', password: '', employeeId: '', roleKeys: [] }}
      onSubmit={(values) => create.mutateAsync(values)}
      submitLabel={t('common.create')}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('auth.email')} htmlFor="user-email" error={form.formState.errors.email?.message}>
              <Input id="user-email" type="email" {...form.register('email')} />
            </FormField>
            <FormField label={t('auth.firstName')} htmlFor="user-first" error={form.formState.errors.firstName?.message}>
              <Input id="user-first" {...form.register('firstName')} />
            </FormField>
            <FormField label={t('auth.lastName')} htmlFor="user-last" error={form.formState.errors.lastName?.message}>
              <Input id="user-last" {...form.register('lastName')} />
            </FormField>
            <FormField label={t('auth.password')} htmlFor="user-password" hint={t('settings.passwordHint')} error={form.formState.errors.password?.message}>
              <Input id="user-password" type="password" autoComplete="new-password" {...form.register('password')} />
            </FormField>
            <FormField label={t('settings.linkEmployee')} htmlFor="user-employee" hint={t('settings.linkEmployeeHint')}>
              <Select id="user-employee" {...form.register('employeeId')}>
                <option value="">{t('common.none')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Field label={t('settings.rolesLabel')} htmlFor="user-roles" hint={t('settings.rolesHint')}>
            <select id="user-roles" multiple size={5} className="input h-auto" {...form.register('roleKeys')}>
              {(roles.data ?? []).map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function EditUserDialog(props: { user: UserAccountItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const roles = useRoleOptions(Boolean(props.user));

  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().min(1, t('common.required')).max(80),
        lastName: z.string().min(1, t('common.required')).max(80),
        status: z.string().min(1, t('common.required')),
        roleKeys: z.array(z.string()),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      await api.patch(`/users/${props.user?.id}`, {
        firstName: values.firstName,
        lastName: values.lastName,
        status: values.status,
      });
      const currentKeys = (props.user?.roles ?? []).map((role) => role.key).sort();
      const nextKeys = [...values.roleKeys].sort();
      if (currentKeys.join(',') !== nextKeys.join(',')) {
        await api.post(`/users/${props.user?.id}/roles`, { roleKeys: values.roleKeys });
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <FormDialog<FormValues>
      open={Boolean(props.user)}
      onOpenChange={props.onOpenChange}
      title={t('settings.editUser')}
      description={props.user?.email}
      schema={schema}
      defaultValues={{
        firstName: props.user?.firstName ?? '',
        lastName: props.user?.lastName ?? '',
        status: props.user?.status ?? 'ACTIVE',
        roleKeys: (props.user?.roles ?? []).map((role) => role.key),
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('auth.firstName')} htmlFor="edit-user-first" error={form.formState.errors.firstName?.message}>
              <Input id="edit-user-first" {...form.register('firstName')} />
            </FormField>
            <FormField label={t('auth.lastName')} htmlFor="edit-user-last" error={form.formState.errors.lastName?.message}>
              <Input id="edit-user-last" {...form.register('lastName')} />
            </FormField>
            <FormField label={t('common.status')} htmlFor="edit-user-status">
              <Select id="edit-user-status" {...form.register('status')}>
                {USER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`settings.userStatus.${status}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Field label={t('settings.rolesLabel')} htmlFor="edit-user-roles" hint={t('settings.rolesHint')}>
            <select id="edit-user-roles" multiple size={5} className="input h-auto" {...form.register('roleKeys')}>
              {(roles.data ?? []).map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function UsersPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [invitesPage, setInvitesPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccountItem | null>(null);
  const [toDelete, setToDelete] = useState<UserAccountItem | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const canManage = can('users.manage');

  const list = useQuery({
    queryKey: ['users', 'list', { search, status, page }],
    queryFn: () =>
      api.get<Paginated<UserAccountItem>>('/users', {
        query: { search: search || undefined, status: status || undefined, page, pageSize: 10 },
      }),
  });
  const invitations = useQuery({
    queryKey: ['users', 'invitations', invitesPage],
    queryFn: () => api.get<Paginated<InvitationItem>>('/users/invitations', { query: { page: invitesPage, pageSize: 5 } }),
  });

  const inviteSchema = useMemo(
    () =>
      z.object({
        email: z.string().min(1, t('common.required')).email(t('validation.email')),
        name: z.string().min(2, t('common.required')).max(160),
        roleKeys: z.array(z.string()),
      }),
    [t],
  );
  type InviteValues = z.infer<typeof inviteSchema>;

  const roles = useRoleOptions(inviteOpen);

  const invite = useMutation({
    mutationFn: (values: InviteValues) =>
      api.post('/users/invitations', { email: values.email, name: values.name, roleKeys: values.roleKeys }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/users/invitations/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setRevokeId(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
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
          placeholder={t('settings.searchUsers')}
          className="sm:w-64"
        />
        <Select aria-label={t('common.status')} className="sm:w-40" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {USER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.userStatus.${value}`)}
            </option>
          ))}
        </Select>
        {canManage ? (
          <Button className="sm:ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newUser')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState icon={Users} title={t('settings.noUsers')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('people.name')}</TableHead>
                    <TableHead>{t('auth.email')}</TableHead>
                    <TableHead>{t('settings.rolesLabel')}</TableHead>
                    <TableHead>{t('settings.lastLoginAt')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {user.firstName} {user.lastName}
                        {user.mfaEnabled ? <Badge tone="success" className="ml-2">MFA</Badge> : null}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <Badge key={role.key} tone="brand">
                              {role.name}
                            </Badge>
                          ))}
                        </span>
                      </TableCell>
                      <TableCell>{formatDateTime(user.lastLoginAt)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(user.status)}>{t(`settings.userStatus.${user.status}`, { defaultValue: user.status })}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <span className="inline-flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                              {t('common.edit')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setToDelete(user)}>
                              {t('common.delete')}
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('settings.invitations')}</h3>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <Plus className="size-3.5" aria-hidden />
              {t('settings.inviteUser')}
            </Button>
          ) : null}
        </div>
        <QueryBoundary
          query={invitations}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState title={t('settings.noInvitations')} />}
          skeleton={<TableSkeleton rows={3} columns={3} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auth.email')}</TableHead>
                    <TableHead>{t('settings.rolesLabel')}</TableHead>
                    <TableHead>{t('settings.expiresAt')}</TableHead>
                    <TableHead>{t('settings.invitedAt')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{invitation.email}</TableCell>
                      <TableCell>{invitation.roleKeys.join(', ') || '—'}</TableCell>
                      <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                      <TableCell>{formatDate(invitation.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <Button size="sm" variant="ghost" onClick={() => setRevokeId(invitation.id)}>
                            {t('settings.revoke')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setInvitesPage} />
            </>
          )}
        </QueryBoundary>
      </Card>

      <NewUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditUserDialog user={editing} onOpenChange={(value) => (!value ? setEditing(null) : undefined)} />

      <FormDialog<InviteValues>
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t('settings.inviteUser')}
        schema={inviteSchema}
        defaultValues={{ email: '', name: '', roleKeys: [] }}
        onSubmit={(values) => invite.mutateAsync(values)}
        submitLabel={t('settings.inviteUser')}
      >
        {(form) => (
          <>
            <FormField label={t('auth.email')} htmlFor="invite-email" error={form.formState.errors.email?.message}>
              <Input id="invite-email" type="email" {...form.register('email')} />
            </FormField>
            <FormField label={t('settings.inviteName')} htmlFor="invite-name" error={form.formState.errors.name?.message}>
              <Input id="invite-name" {...form.register('name')} />
            </FormField>
            <Field label={t('settings.rolesLabel')} htmlFor="invite-roles">
              <select id="invite-roles" multiple size={5} className="input h-auto" {...form.register('roleKeys')}>
                {(roles.data ?? []).map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deleteUser')}
        description={toDelete?.email}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />

      <ConfirmDialog
        open={Boolean(revokeId)}
        onOpenChange={(value) => (!value ? setRevokeId(null) : undefined)}
        title={t('settings.revokeInvitation')}
        destructive
        loading={revoke.isPending}
        confirmLabel={t('settings.revoke')}
        onConfirm={() => {
          if (revokeId) revoke.mutate(revokeId);
        }}
      />
    </div>
  );
}

/* ── Roles & permissions ─────────────────────────────────────────────────── */

function RolesPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleSummary | null>(null);
  const [toDelete, setToDelete] = useState<RoleSummary | null>(null);
  const canManage = can('roles.manage');

  const roles = useQuery({ queryKey: ['roles', 'options'], queryFn: () => api.get<RoleSummary[]>('/roles') });
  const permissions = useQuery({ queryKey: ['permissions', 'catalog'], queryFn: () => api.get<PermissionModule[]>('/permissions') });

  const schema = useMemo(
    () =>
      z.object({
        key: z.string().min(2, t('common.required')).max(60),
        name: z.string().min(2, t('common.required')).max(120),
        description: z.string().max(500).optional(),
        permissions: z.array(z.string()),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const allPermissions = useMemo(() => (permissions.data ?? []).flatMap((module) => module.permissions.map((permission) => permission.key)), [permissions.data]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? api.patch(`/roles/${editing.id}`, { name: values.name, description: values.description || undefined, permissions: values.permissions })
        : api.post('/roles', { ...values, description: values.description || undefined }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newRole')}
          </Button>
        </div>
      ) : null}

      <QueryBoundary query={roles} isEmpty={(data) => data.length === 0} empty={<EmptyState icon={ShieldCheck} title={t('settings.noRoles')} />}>
        {(data) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.map((role) => (
              <Card key={role.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{role.name}</h3>
                    <p className="text-xs font-mono text-slate-500">{role.key}</p>
                    {role.description ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{role.description}</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {role.isSystem ? <Badge tone="info">{t('settings.systemRole')}</Badge> : <Badge tone="brand">{t('settings.customRole')}</Badge>}
                    <span className="text-xs text-slate-500">
                      {role.userCount} {t('settings.usersCount')} · {role.permissions.length} {t('settings.permissionsCount')}
                    </span>
                  </div>
                </div>
                {canManage ? (
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(role); setOpen(true); }}>
                      {t('common.edit')}
                    </Button>
                    {!role.isSystem ? (
                      <Button size="sm" variant="ghost" onClick={() => setToDelete(role)}>
                        {t('common.delete')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editRole') : t('settings.newRole')}
        schema={schema}
        className="w-[min(96vw,54rem)]"
        defaultValues={{
          key: editing?.key ?? '',
          name: editing?.name ?? '',
          description: editing?.description ?? '',
          permissions: editing?.permissions ?? [],
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.roleKey')} htmlFor="role-key" error={form.formState.errors.key?.message}>
                <Input id="role-key" disabled={Boolean(editing)} {...form.register('key')} />
              </FormField>
              <FormField label={t('settings.name')} htmlFor="role-name" error={form.formState.errors.name?.message}>
                <Input id="role-name" {...form.register('name')} />
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="role-description">
              <Textarea id="role-description" rows={2} {...form.register('description')} />
            </FormField>
            <Field label={t('settings.permissions')} htmlFor="role-permissions" hint={t('settings.permissionsHint')}>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => form.setValue('permissions', allPermissions)}>
                    {t('settings.selectAll')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => form.setValue('permissions', [])}>
                    {t('settings.clearAll')}
                  </Button>
                </div>
                {(permissions.data ?? []).map((module) => (
                  <fieldset key={module.module}>
                    <legend className="text-xs font-semibold uppercase text-slate-500">{module.module}</legend>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {module.permissions.map((permission) => (
                        <label key={permission.key} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={form.watch('permissions').includes(permission.key)}
                            onChange={(event) => {
                              const current = form.getValues('permissions');
                              form.setValue(
                                'permissions',
                                event.target.checked ? [...current, permission.key] : current.filter((key) => key !== permission.key),
                              );
                            }}
                          />
                          <span>{permission.description}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </Field>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deleteRole')}
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

/* ── Organization ────────────────────────────────────────────────────────── */

function DepartmentsPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NamedRef | null>(null);
  const [toDelete, setToDelete] = useState<NamedRef | null>(null);
  const canManage = can('departments.manage');

  const list = useQuery({
    queryKey: ['departments', 'settings', 'list'],
    queryFn: () => api.get<Paginated<NamedRef & { code?: string | null; costCenter?: string | null }>>('/departments', { query: { pageSize: 100 } }),
  });

  const schema = useMemo(
    () => z.object({ name: z.string().min(2, t('common.required')).max(120), code: z.string().max(40).optional(), costCenter: z.string().max(60).optional() }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? api.patch(`/departments/${editing.id}`, { ...values, code: values.code || undefined, costCenter: values.costCenter || undefined })
        : api.post('/departments', { ...values, code: values.code || undefined, costCenter: values.costCenter || undefined }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['departments'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newDepartment')}
          </Button>
        </div>
      ) : null}
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState icon={Building2} title={t('settings.noDepartments')} />}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.name')}</TableHead>
                  <TableHead>{t('settings.code')}</TableHead>
                  <TableHead>{t('settings.costCenter')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{department.name}</TableCell>
                    <TableCell className="font-mono text-xs">{department.code ?? '—'}</TableCell>
                    <TableCell>{department.costCenter ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(department); setOpen(true); }}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(department)}>
                            {t('common.delete')}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editDepartment') : t('settings.newDepartment')}
        schema={schema}
        defaultValues={{
          name: editing?.name ?? '',
          code: editing && 'code' in editing && typeof editing.code === 'string' ? editing.code : '',
          costCenter: editing && 'costCenter' in editing && typeof editing.costCenter === 'string' ? editing.costCenter : '',
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('settings.name')} htmlFor="dept-name" error={form.formState.errors.name?.message}>
              <Input id="dept-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('settings.code')} htmlFor="dept-code">
              <Input id="dept-code" {...form.register('code')} />
            </FormField>
            <FormField label={t('settings.costCenter')} htmlFor="dept-cost">
              <Input id="dept-cost" {...form.register('costCenter')} />
            </FormField>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deleteDepartment')}
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

function LocationsPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationItem | null>(null);
  const [toDelete, setToDelete] = useState<LocationItem | null>(null);
  const canManage = can('locations.manage');

  const list = useQuery({
    queryKey: ['locations', 'settings', 'list'],
    queryFn: () => api.get<Paginated<LocationItem>>('/locations', { query: { pageSize: 100 } }),
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(120),
        address: z.string().max(200).optional(),
        city: z.string().max(80).optional(),
        country: z.string().max(80).optional(),
        timezone: z.string().max(80).optional(),
        isActive: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        name: values.name,
        address: values.address || undefined,
        city: values.city || undefined,
        country: values.country || undefined,
        timezone: values.timezone || undefined,
        isActive: values.isActive,
      };
      return editing ? api.patch(`/locations/${editing.id}`, body) : api.post('/locations', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['locations'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newLocation')}
          </Button>
        </div>
      ) : null}
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('settings.noLocations')} />}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.name')}</TableHead>
                  <TableHead>{t('settings.city')}</TableHead>
                  <TableHead>{t('settings.country')}</TableHead>
                  <TableHead>{t('settings.timezone')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{location.name}</TableCell>
                    <TableCell>{location.city ?? '—'}</TableCell>
                    <TableCell>{location.country ?? '—'}</TableCell>
                    <TableCell>{location.timezone ?? '—'}</TableCell>
                    <TableCell>
                      <Badge tone={location.isActive ? 'success' : 'neutral'}>{location.isActive ? t('common.active') : t('common.inactive')}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(location); setOpen(true); }}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(location)}>
                            {t('common.delete')}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editLocation') : t('settings.newLocation')}
        schema={schema}
        defaultValues={{
          name: editing?.name ?? '',
          address: editing?.address ?? '',
          city: editing?.city ?? '',
          country: editing?.country ?? '',
          timezone: editing?.timezone ?? '',
          isActive: editing?.isActive ?? true,
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.name')} htmlFor="loc-name" error={form.formState.errors.name?.message}>
                <Input id="loc-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('settings.address')} htmlFor="loc-address">
                <Input id="loc-address" {...form.register('address')} />
              </FormField>
              <FormField label={t('settings.city')} htmlFor="loc-city">
                <Input id="loc-city" {...form.register('city')} />
              </FormField>
              <FormField label={t('settings.country')} htmlFor="loc-country">
                <Input id="loc-country" {...form.register('country')} />
              </FormField>
              <FormField label={t('settings.timezone')} htmlFor="loc-timezone">
                <Input id="loc-timezone" {...form.register('timezone')} />
              </FormField>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('common.active')}
              <input type="checkbox" checked={form.watch('isActive')} onChange={(event) => form.setValue('isActive', event.target.checked)} />
            </label>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deleteLocation')}
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

function TeamsPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeamItem | null>(null);
  const [toDelete, setToDelete] = useState<TeamItem | null>(null);
  const canManage = can('teams.manage');

  const list = useQuery({
    queryKey: ['teams', 'settings', 'list'],
    queryFn: () => api.get<Paginated<TeamItem>>('/teams', { query: { pageSize: 100 } }),
  });
  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });
  const employees = useEmployeeOptions(canManage);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(120),
        description: z.string().max(500).optional(),
        departmentId: z.string().optional(),
        leadId: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        name: values.name,
        description: values.description || undefined,
        departmentId: values.departmentId || undefined,
        leadId: values.leadId || undefined,
      };
      return editing ? api.patch(`/teams/${editing.id}`, body) : api.post('/teams', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['teams'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/teams/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newTeam')}
          </Button>
        </div>
      ) : null}
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('settings.noTeams')} />}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.name')}</TableHead>
                  <TableHead>{t('people.department')}</TableHead>
                  <TableHead>{t('settings.lead')}</TableHead>
                  <TableHead>{t('settings.members')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((team) => (
                  <TableRow key={team.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                      {team.name}
                      {team.description ? <span className="block text-xs text-slate-500">{team.description}</span> : null}
                    </TableCell>
                    <TableCell>{team.department?.name ?? '—'}</TableCell>
                    <TableCell>{team.lead ? `${team.lead.firstName} ${team.lead.lastName}` : '—'}</TableCell>
                    <TableCell className="tabular-nums">{team.memberCount ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(team); setOpen(true); }}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(team)}>
                            {t('common.delete')}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editTeam') : t('settings.newTeam')}
        schema={schema}
        defaultValues={{
          name: editing?.name ?? '',
          description: editing?.description ?? '',
          departmentId: editing?.department?.id ?? '',
          leadId: editing?.lead?.id ?? '',
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.name')} htmlFor="team-name" error={form.formState.errors.name?.message}>
                <Input id="team-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('people.department')} htmlFor="team-department">
                <Select id="team-department" {...form.register('departmentId')}>
                  <option value="">{t('common.none')}</option>
                  {(departments.data?.data ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('settings.lead')} htmlFor="team-lead">
                <Select id="team-lead" {...form.register('leadId')}>
                  <option value="">{t('common.none')}</option>
                  {(employees.data?.data ?? []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label={t('leave.description')} htmlFor="team-description">
              <Textarea id="team-description" rows={2} {...form.register('description')} />
            </FormField>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deleteTeam')}
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

function PositionsPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PositionItem | null>(null);
  const [toDelete, setToDelete] = useState<PositionItem | null>(null);
  const canManage = can('positions.manage');

  const list = useQuery({
    queryKey: ['positions', 'settings', 'list'],
    queryFn: () => api.get<Paginated<PositionItem>>('/positions', { query: { pageSize: 100 } }),
  });
  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        title: z.string().min(2, t('common.required')).max(120),
        code: z.string().max(40).optional(),
        level: z.string().max(40).optional(),
        departmentId: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        title: values.title,
        code: values.code || undefined,
        level: values.level || undefined,
        departmentId: values.departmentId || undefined,
      };
      return editing ? api.patch(`/positions/${editing.id}`, body) : api.post('/positions', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['positions'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/positions/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newPosition')}
          </Button>
        </div>
      ) : null}
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('settings.noPositions')} />}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('people.position')}</TableHead>
                  <TableHead>{t('settings.code')}</TableHead>
                  <TableHead>{t('settings.level')}</TableHead>
                  <TableHead>{t('people.department')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((position) => (
                  <TableRow key={position.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{position.title}</TableCell>
                    <TableCell className="font-mono text-xs">{position.code ?? '—'}</TableCell>
                    <TableCell>{position.level ?? '—'}</TableCell>
                    <TableCell>{position.department?.name ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(position); setOpen(true); }}>
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setToDelete(position)}>
                            {t('common.delete')}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editPosition') : t('settings.newPosition')}
        schema={schema}
        defaultValues={{
          title: editing?.title ?? '',
          code: editing?.code ?? '',
          level: editing?.level ?? '',
          departmentId: editing?.department?.id ?? '',
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('people.position')} htmlFor="pos-title" error={form.formState.errors.title?.message}>
              <Input id="pos-title" {...form.register('title')} />
            </FormField>
            <FormField label={t('settings.code')} htmlFor="pos-code">
              <Input id="pos-code" {...form.register('code')} />
            </FormField>
            <FormField label={t('settings.level')} htmlFor="pos-level">
              <Input id="pos-level" {...form.register('level')} />
            </FormField>
            <FormField label={t('people.department')} htmlFor="pos-department">
              <Select id="pos-department" {...form.register('departmentId')}>
                <option value="">{t('common.none')}</option>
                {(departments.data?.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('settings.deletePosition')}
        description={toDelete?.title}
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

function SchedulesPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editing, setEditing] = useState<WorkScheduleItem | null>(null);
  const canManage = can('schedules.manage');

  const list = useQuery({
    queryKey: ['schedules', 'settings', 'list'],
    queryFn: () => api.get<Paginated<WorkScheduleItem>>('/schedules', { query: { pageSize: 100 } }),
  });
  const employees = useEmployeeOptions(assignOpen);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(120),
        type: z.string().min(1, t('common.required')),
        startTime: z.string().min(4, t('common.required')).max(5),
        endTime: z.string().min(4, t('common.required')).max(5),
        breakMinutes: optionalNumber(t, { min: 0, max: 480 }),
        workDays: z.array(z.number()).min(1, t('common.required')),
        isDefault: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const assignSchema = useMemo(
    () =>
      z.object({
        employeeId: z.string().min(1, t('common.required')),
        scheduleId: z.string().min(1, t('common.required')),
        effectiveFrom: z.string().min(1, t('common.required')),
      }),
    [t],
  );
  type AssignValues = z.infer<typeof assignSchema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        name: values.name,
        type: values.type,
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: values.breakMinutes,
        workDays: values.workDays,
        isDefault: values.isDefault,
      };
      return editing ? api.patch(`/schedules/${editing.id}`, body) : api.post('/schedules', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const assign = useMutation({
    mutationFn: (values: AssignValues) => api.post('/schedules/assign', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['schedules'] }),
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)}>
            {t('settings.assignSchedule')}
          </Button>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            {t('settings.newSchedule')}
          </Button>
        </div>
      ) : null}
      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('settings.noSchedules')} />}>
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.name')}</TableHead>
                  <TableHead>{t('settings.scheduleType')}</TableHead>
                  <TableHead>{t('settings.hours')}</TableHead>
                  <TableHead>{t('settings.workDays')}</TableHead>
                  <TableHead>{t('settings.breakMinutes')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                      {schedule.name}
                      {schedule.isDefault ? <Badge tone="brand" className="ml-2">{t('settings.default')}</Badge> : null}
                    </TableCell>
                    <TableCell>{t(`settings.scheduleTypeValue.${schedule.type}`, { defaultValue: schedule.type })}</TableCell>
                    <TableCell>
                      {schedule.startTime} – {schedule.endTime}
                    </TableCell>
                    <TableCell>{schedule.workDays.map((day) => t(`calendar.weekdays.${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][day - 1] ?? 'mon'}`)).join(', ')}</TableCell>
                    <TableCell className="tabular-nums">{schedule.breakMinutes ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(schedule); setOpen(true); }}>
                          {t('common.edit')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('settings.editSchedule') : t('settings.newSchedule')}
        schema={schema}
        defaultValues={{
          name: editing?.name ?? '',
          type: editing?.type ?? 'FIXED',
          startTime: editing?.startTime ?? '09:00',
          endTime: editing?.endTime ?? '18:00',
          breakMinutes: editing?.breakMinutes ?? 60,
          workDays: editing?.workDays ?? [1, 2, 3, 4, 5],
          isDefault: editing?.isDefault ?? false,
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.name')} htmlFor="schedule-name" error={form.formState.errors.name?.message}>
                <Input id="schedule-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('settings.scheduleType')} htmlFor="schedule-type">
                <Select id="schedule-type" {...form.register('type')}>
                  {SCHEDULE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`settings.scheduleTypeValue.${type}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('settings.startTime')} htmlFor="schedule-start" error={form.formState.errors.startTime?.message}>
                <Input id="schedule-start" type="time" {...form.register('startTime')} />
              </FormField>
              <FormField label={t('settings.endTime')} htmlFor="schedule-end" error={form.formState.errors.endTime?.message}>
                <Input id="schedule-end" type="time" {...form.register('endTime')} />
              </FormField>
              <FormField label={t('settings.breakMinutes')} htmlFor="schedule-break">
                <Input id="schedule-break" type="number" min={0} max={480} {...form.register('breakMinutes', { valueAsNumber: true })} />
              </FormField>
            </div>
            <Field label={t('settings.workDays')} htmlFor="schedule-days" error={form.formState.errors.workDays?.message}>
              <div id="schedule-days" className="flex flex-wrap gap-3">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.watch('workDays').includes(day)}
                      onChange={(event) => {
                        const current = form.getValues('workDays');
                        form.setValue('workDays', event.target.checked ? [...current, day].sort() : current.filter((value) => value !== day));
                      }}
                    />
                    {t(`calendar.weekdays.${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][day - 1]}`)}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('settings.default')}
              <input type="checkbox" checked={form.watch('isDefault')} onChange={(event) => form.setValue('isDefault', event.target.checked)} />
            </label>
          </>
        )}
      </FormDialog>

      <FormDialog<AssignValues>
        open={assignOpen}
        onOpenChange={setAssignOpen}
        title={t('settings.assignSchedule')}
        schema={assignSchema}
        defaultValues={{ employeeId: '', scheduleId: '', effectiveFrom: new Date().toISOString().slice(0, 10) }}
        onSubmit={(values) => assign.mutateAsync(values)}
        submitLabel={t('settings.assignSchedule')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('training.employee')} htmlFor="assign-schedule-employee" error={form.formState.errors.employeeId?.message}>
              <Select id="assign-schedule-employee" {...form.register('employeeId')}>
                <option value="">{t('common.select')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('settings.schedule')} htmlFor="assign-schedule-id" error={form.formState.errors.scheduleId?.message}>
              <Select id="assign-schedule-id" {...form.register('scheduleId')}>
                <option value="">{t('common.select')}</option>
                {(list.data?.data ?? []).map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('settings.effectiveFrom')} htmlFor="assign-schedule-from" error={form.formState.errors.effectiveFrom?.message}>
              <Input id="assign-schedule-from" type="date" {...form.register('effectiveFrom')} />
            </FormField>
          </div>
        )}
      </FormDialog>
    </div>
  );
}

function OrganizationPanel() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="departments" className="space-y-4">
      <TabsList>
        <TabsTrigger value="departments">{t('people.department')}</TabsTrigger>
        <TabsTrigger value="locations">{t('people.location')}</TabsTrigger>
        <TabsTrigger value="teams">{t('people.team')}</TabsTrigger>
        <TabsTrigger value="positions">{t('people.position')}</TabsTrigger>
        <TabsTrigger value="schedules">{t('settings.schedules')}</TabsTrigger>
      </TabsList>
      <TabsContent value="departments">
        <DepartmentsPanel />
      </TabsContent>
      <TabsContent value="locations">
        <LocationsPanel />
      </TabsContent>
      <TabsContent value="teams">
        <TeamsPanel />
      </TabsContent>
      <TabsContent value="positions">
        <PositionsPanel />
      </TabsContent>
      <TabsContent value="schedules">
        <SchedulesPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ── Privacy ─────────────────────────────────────────────────────────────── */

function PrivacyPanel() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const privacy = useQuery({ queryKey: ['tenant', 'privacy'], queryFn: () => api.get<PrivacySettings>('/tenants/current/privacy') });

  const schema = useMemo(
    () =>
      z.object({
        dpoName: z.string().max(160).optional(),
        dpoEmail: z.string().max(160).optional(),
        dataProcessingBasis: z.string().max(500).optional(),
        defaultRetentionDays: optionalNumber(t, { min: 0, max: 36500 }),
        gpsTrackingEnabled: z.boolean(),
        gpsConsentRequired: z.boolean(),
        biometricEnabled: z.boolean(),
        allowEmployeeExport: z.boolean(),
        allowEmployeeErasure: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => api.patch('/tenants/current/privacy', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tenant', 'privacy'] }),
  });

  return (
    <div className="space-y-4">
      <QueryBoundary query={privacy} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
        {(data) => (
          <SectionCard
            title={t('settings.privacy')}
            description={t('settings.privacyHint')}
            action={
              can('gdpr.manage') ? (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  {t('common.edit')}
                </Button>
              ) : undefined
            }
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                { label: t('settings.dpoEmail'), value: data.dpoEmail },
                { label: t('settings.retentionDays'), value: data.dataRetentionDays ?? data.defaultRetentionDays },
                { label: t('settings.gpsTracking'), value: data.gpsTrackingEnabled ? t('common.yes') : t('common.no') },
                { label: t('settings.biometric'), value: data.biometricEnabled ? t('common.yes') : t('common.no') },
                { label: t('settings.allowEmployeeExport'), value: data.allowEmployeeExport ? t('common.yes') : t('common.no') },
                { label: t('settings.allowEmployeeErasure'), value: data.allowEmployeeErasure ? t('common.yes') : t('common.no') },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-xs uppercase text-slate-500">{item.label}</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{String(item.value ?? '—')}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        )}
      </QueryBoundary>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('settings.privacy')}
        schema={schema}
        defaultValues={{
          dpoName: typeof privacy.data?.dpoName === 'string' ? privacy.data.dpoName : '',
          dpoEmail: privacy.data?.dpoEmail ?? '',
          dataProcessingBasis: typeof privacy.data?.dataProcessingBasis === 'string' ? privacy.data.dataProcessingBasis : '',
          defaultRetentionDays: typeof privacy.data?.defaultRetentionDays === 'number' ? privacy.data.defaultRetentionDays : undefined,
          gpsTrackingEnabled: Boolean(privacy.data?.gpsTrackingEnabled),
          gpsConsentRequired: Boolean(privacy.data?.gpsConsentRequired),
          biometricEnabled: Boolean(privacy.data?.biometricEnabled),
          allowEmployeeExport: Boolean(privacy.data?.allowEmployeeExport),
          allowEmployeeErasure: Boolean(privacy.data?.allowEmployeeErasure),
        }}
        onSubmit={(values) => save.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('settings.dpoName')} htmlFor="privacy-dpo-name">
                <Input id="privacy-dpo-name" {...form.register('dpoName')} />
              </FormField>
              <FormField label={t('settings.dpoEmail')} htmlFor="privacy-dpo-email">
                <Input id="privacy-dpo-email" type="email" {...form.register('dpoEmail')} />
              </FormField>
              <FormField label={t('settings.retentionDays')} htmlFor="privacy-retention">
                <Input id="privacy-retention" type="number" min={0} {...form.register('defaultRetentionDays', { valueAsNumber: true })} />
              </FormField>
            </div>
            <FormField label={t('settings.processingBasis')} htmlFor="privacy-basis">
              <Textarea id="privacy-basis" rows={2} {...form.register('dataProcessingBasis')} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['gpsTrackingEnabled', t('settings.gpsTracking')],
                  ['gpsConsentRequired', t('settings.gpsConsent')],
                  ['biometricEnabled', t('settings.biometric')],
                  ['allowEmployeeExport', t('settings.allowEmployeeExport')],
                  ['allowEmployeeErasure', t('settings.allowEmployeeErasure')],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex items-center justify-between gap-3 text-sm">
                  {label}
                  <input type="checkbox" checked={form.watch(field)} onChange={(event) => form.setValue(field, event.target.checked)} />
                </label>
              ))}
            </div>
          </>
        )}
      </FormDialog>
    </div>
  );
}

/* ── Audit log ───────────────────────────────────────────────────────────── */

function AuditPanel() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ entityType: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ['audit', 'logs', { ...filters, page }],
    queryFn: () =>
      api.get<Paginated<AuditLogItem>>('/audit-logs', {
        query: {
          entityType: filters.entityType || undefined,
          action: filters.action || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page,
          pageSize: 15,
        },
      }),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar>
        <Input
          aria-label={t('audit.entity')}
          className="sm:w-52"
          placeholder={t('audit.entity')}
          value={filters.entityType}
          onChange={(event) => update({ entityType: event.target.value })}
        />
        <Input
          aria-label={t('audit.action')}
          className="sm:w-52"
          placeholder={t('audit.action')}
          value={filters.action}
          onChange={(event) => update({ action: event.target.value })}
        />
        <Input aria-label={t('common.from')} type="date" className="sm:w-40" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
        <Input aria-label={t('common.to')} type="date" className="sm:w-40" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
      </FilterBar>
      <Card>
        <QueryBoundary query={logs} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('audit.noEntries')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.date')}</TableHead>
                    <TableHead>{t('audit.action')}</TableHead>
                    <TableHead>{t('audit.entity')}</TableHead>
                    <TableHead>{t('audit.actor')}</TableHead>
                    <TableHead>{t('audit.ip')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{entry.action}</TableCell>
                      <TableCell>
                        {entry.entityType}
                        {entry.entityId ? <span className="block font-mono text-xs text-slate-500">{entry.entityId}</span> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.actorUserId ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.ip ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'company', label: t('settings.company'), permission: 'settings.view' },
    { value: 'users', label: t('settings.users'), permission: 'users.view' },
    { value: 'roles', label: t('settings.roles'), permission: 'roles.view' },
    { value: 'organization', label: t('settings.organization'), permission: 'departments.view' },
    { value: 'leave', label: t('nav.leave'), permission: 'leave.manage' },
    { value: 'privacy', label: t('settings.privacy'), permission: 'gdpr.view' },
    { value: 'notifications', label: t('notifications.preferences'), permission: 'notifications.self.manage' },
    { value: 'audit', label: t('settings.audit'), permission: 'audit.view' },
  ].filter((tab) => can(tab.permission));

  const activeTab = params.get('tab') ?? 'company';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : tabs[0]?.value ?? 'company';

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="company">{current === 'company' ? <CompanyPanel /> : null}</TabsContent>
        <TabsContent value="users">{current === 'users' ? <UsersPanel /> : null}</TabsContent>
        <TabsContent value="roles">{current === 'roles' ? <RolesPanel /> : null}</TabsContent>
        <TabsContent value="organization">{current === 'organization' ? <OrganizationPanel /> : null}</TabsContent>
        <TabsContent value="leave">
          {current === 'leave' ? (
            <div className="space-y-4">
              <LeaveSettingsTabs />
              <LeaveBalanceAdjustPanel />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="privacy">{current === 'privacy' ? <PrivacyPanel /> : null}</TabsContent>
        <TabsContent value="notifications">
          {current === 'notifications' ? (
            <SectionCard title={t('notifications.preferences')} description={t('notifications.preferencesHint')}>
              <NotificationPreferencesPanel />
            </SectionCard>
          ) : null}
        </TabsContent>
        <TabsContent value="audit">{current === 'audit' ? <AuditPanel /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}

function LeaveBalanceAdjustPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const employees = useEmployeeOptions(open);
  const leaveTypes = useQuery({
    queryKey: ['leave', 'types', 'all'],
    queryFn: async () => {
      const types = await api.get<Array<{ id: string; name: string }>>('/leave/types', { query: { includeInactive: false } });
      return types;
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        employeeId: z.string().min(1, t('common.required')),
        leaveTypeId: z.string().min(1, t('common.required')),
        year: z.coerce.number({ message: t('validation.number') }).int().min(2000).max(2100),
        adjustment: z.coerce.number({ message: t('validation.number') }),
        reason: z.string().min(3, t('common.required')).max(300),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const adjust = useMutation({
    mutationFn: (values: FormValues) => api.post('/leave/balances/adjust', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leave'] }),
  });

  return (
    <SectionCard
      title={t('settings.adjustBalance')}
      description={t('settings.adjustBalanceHint')}
      action={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t('settings.adjustBalance')}
        </Button>
      }
    >
      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('settings.adjustBalance')}
        schema={schema}
        defaultValues={{ employeeId: '', leaveTypeId: '', year: new Date().getFullYear(), adjustment: 0, reason: '' }}
        onSubmit={(values) => adjust.mutateAsync(values)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('training.employee')} htmlFor="balance-employee" error={form.formState.errors.employeeId?.message}>
              <Select id="balance-employee" {...form.register('employeeId')}>
                <option value="">{t('common.select')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('leave.leaveType')} htmlFor="balance-type" error={form.formState.errors.leaveTypeId?.message}>
              <Select id="balance-type" {...form.register('leaveTypeId')}>
                <option value="">{t('common.select')}</option>
                {(leaveTypes.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('profile.year')} htmlFor="balance-year" error={form.formState.errors.year?.message}>
              <Input id="balance-year" type="number" min={2000} max={2100} {...form.register('year', { valueAsNumber: true })} />
            </FormField>
            <FormField label={t('settings.adjustment')} htmlFor="balance-adjustment" hint={t('settings.adjustmentHint')} error={form.formState.errors.adjustment?.message}>
              <Input id="balance-adjustment" type="number" step="0.5" {...form.register('adjustment', { valueAsNumber: true })} />
            </FormField>
          </div>
        )}
      </FormDialog>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('settings.adjustBalanceNote')}</p>
      {adjust.isError ? <p className="mt-2 text-xs text-rose-600">{t('common.error')}</p> : null}
    </SectionCard>
  );
}
