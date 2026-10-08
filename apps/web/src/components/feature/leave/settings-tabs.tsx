import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, ApiError, type Paginated } from '../../../lib/api.js';
import { formatDate } from '../../../lib/utils.js';
import type { BlackoutItem, EmployeeListItem, HolidayItem, LeavePolicyItem, LeaveTypeItem } from '../api-types.js';
import { FormDialog, FormField } from '../form-dialog.js';
import { optionalNumber } from '../schemas.js';
import { QueryBoundary } from '../query.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Card, CardHeader, CardTitle } from '../../ui/card.js';
import { ConfirmDialog } from '../../ui/dialog.js';
import { EmptyState } from '../../ui/feedback.js';
import { Field, Input, Select, Textarea } from '../../ui/input.js';
import { Switch } from '../../ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.js';

const APPROVER_TYPES = ['MANAGER', 'HR', 'USER'] as const;

/* ── Leave types ─────────────────────────────────────────────────────────── */

function LeaveTypesPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['leave', 'types', 'all'],
    queryFn: () => api.get<LeaveTypeItem[]>('/leave/types', { query: { includeInactive: true } }),
  });

  const schema = z.object({
    key: z.string().min(2, t('common.required')).max(40),
    name: z.string().min(2, t('common.required')).max(80),
    defaultDaysPerYear: z.number({ message: t('validation.number') }).min(0).max(365),
    isPaid: z.boolean(),
    requiresApproval: z.boolean(),
    allowHalfDay: z.boolean(),
    requiresAttachment: z.boolean(),
    color: z.string().max(9).optional(),
  });
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/leave/types', { ...values, color: values.color || undefined }),
    onSuccess: () => {
      toast.success(t('common.created'));
      void queryClient.invalidateQueries({ queryKey: ['leave', 'types'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (type: LeaveTypeItem) => api.patch(`/leave/types/${type.id}`, { isActive: !type.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leave', 'types'] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('leave.leaveTypes')}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </CardHeader>
      <QueryBoundary
        query={list}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState title={t('leave.noLeaveTypes')} action={<Button onClick={() => setOpen(true)}>{t('common.create')}</Button>} />}
      >
        {(types) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('leave.name')}</TableHead>
                <TableHead>{t('leave.accrual')}</TableHead>
                <TableHead>{t('leave.defaultDays')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((type) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: type.color ?? '#64748b' }} aria-hidden />
                      {type.name}
                    </span>
                  </TableCell>
                  <TableCell>{t(`leave.accrualType.${type.accrualType}`, { defaultValue: type.accrualType })}</TableCell>
                  <TableCell>{type.defaultDaysPerYear ?? '—'}</TableCell>
                  <TableCell>
                    <Badge tone={type.isActive ? 'success' : 'neutral'}>{type.isActive ? t('common.active') : t('common.inactive')}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => toggle.mutate(type)} loading={toggle.isPending}>
                      {type.isActive ? t('common.deactivate') : t('common.activate')}
                    </Button>
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
        title={t('leave.newLeaveType')}
        schema={schema}
        defaultValues={{
          key: '',
          name: '',
          defaultDaysPerYear: 20,
          isPaid: true,
          requiresApproval: true,
          allowHalfDay: true,
          requiresAttachment: false,
          color: '#6366f1',
        }}
        onSubmit={(values) => create.mutateAsync(values)}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('leave.key')} htmlFor="type-key" error={form.formState.errors.key?.message}>
                <Input id="type-key" placeholder="STUDY" {...form.register('key')} />
              </FormField>
              <FormField label={t('leave.name')} htmlFor="type-name" error={form.formState.errors.name?.message}>
                <Input id="type-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('leave.defaultDays')} htmlFor="type-days" error={form.formState.errors.defaultDaysPerYear?.message}>
                <Input id="type-days" type="number" step="0.5" {...form.register('defaultDaysPerYear', { valueAsNumber: true })} />
              </FormField>
              <FormField label={t('leave.color')} htmlFor="type-color">
                <Input id="type-color" type="color" {...form.register('color')} />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['isPaid', 'requiresApproval', 'allowHalfDay', 'requiresAttachment'] as const).map((flag) => (
                <label key={flag} className="flex items-center justify-between gap-3 text-sm">
                  {t(`leave.flags.${flag}`)}
                  <Switch checked={form.watch(flag)} onCheckedChange={(checked) => form.setValue(flag, checked)} />
                </label>
              ))}
            </div>
          </>
        )}
      </FormDialog>
    </Card>
  );
}

/* ── Policies ────────────────────────────────────────────────────────────── */

function PolicyDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [chain, setChain] = useState<Array<{ type: (typeof APPROVER_TYPES)[number]; approverId: string }>>([{ type: 'MANAGER', approverId: '' }]);

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const schema = z.object({
    name: z.string().min(2, t('common.required')).max(120),
    description: z.string().max(500).optional(),
    minNoticeDays: z.number({ message: t('validation.number') }).min(0).max(365),
    maxConsecutiveDays: optionalNumber(t, { min: 1, max: 365 }),
    isDefault: z.boolean(),
  });
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/leave/policies', {
        ...values,
        description: values.description || undefined,
        approvalChain: chain
          .filter((step) => step.type !== 'USER' || step.approverId)
          .map((step) => ({ type: step.type, approverId: step.type === 'USER' ? step.approverId : undefined })),
      }),
    onSuccess: () => {
      toast.success(t('common.created'));
      void queryClient.invalidateQueries({ queryKey: ['leave', 'policies'] });
    },
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('leave.newPolicy')}
      schema={schema}
      defaultValues={{ name: '', description: '', minNoticeDays: 0, maxConsecutiveDays: 30, isDefault: false }}
      onSubmit={(values) => create.mutateAsync(values)}
    >
      {(form) => (
        <>
          <FormField label={t('leave.name')} htmlFor="policy-name" error={form.formState.errors.name?.message}>
            <Input id="policy-name" {...form.register('name')} />
          </FormField>
          <FormField label={t('leave.description')} htmlFor="policy-description">
            <Textarea id="policy-description" rows={2} {...form.register('description')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('leave.minNoticeDays')} htmlFor="policy-notice" error={form.formState.errors.minNoticeDays?.message}>
              <Input id="policy-notice" type="number" min={0} {...form.register('minNoticeDays', { valueAsNumber: true })} />
            </FormField>
            <FormField label={t('leave.maxConsecutiveDays')} htmlFor="policy-max" error={form.formState.errors.maxConsecutiveDays?.message}>
              <Input id="policy-max" type="number" min={1} {...form.register('maxConsecutiveDays', { valueAsNumber: true })} />
            </FormField>
          </div>
          <Field label={t('leave.approvalChain')} hint={t('leave.approvalChainHint')}>
            <ol className="space-y-2">
              {chain.map((step, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-slate-500">{index + 1}.</span>
                  <Select
                    aria-label={t('leave.approverType')}
                    value={step.type}
                    onChange={(event) =>
                      setChain((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, type: event.target.value as (typeof APPROVER_TYPES)[number] } : entry,
                        ),
                      )
                    }
                  >
                    {APPROVER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`leave.approver.${type}`)}
                      </option>
                    ))}
                  </Select>
                  {step.type === 'USER' ? (
                    <Select
                      aria-label={t('leave.specificApprover')}
                      value={step.approverId}
                      onChange={(event) =>
                        setChain((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, approverId: event.target.value } : entry)))
                      }
                    >
                      <option value="">{t('common.select')}</option>
                      {(employees.data?.data ?? []).map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.firstName} {employee.lastName}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('leave.removeStep')}
                    onClick={() => setChain((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setChain((current) => [...current, { type: 'HR', approverId: '' }])}>
              <Plus className="size-3.5" aria-hidden />
              {t('leave.addStep')}
            </Button>
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t('leave.isDefaultPolicy')}
            <Switch checked={form.watch('isDefault')} onCheckedChange={(checked) => form.setValue('isDefault', checked)} />
          </label>
        </>
      )}
    </FormDialog>
  );
}

function PoliciesPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<LeavePolicyItem | null>(null);

  const list = useQuery({ queryKey: ['leave', 'policies'], queryFn: () => api.get<LeavePolicyItem[]>('/leave/policies') });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/policies/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['leave', 'policies'] });
      setToDelete(null);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('leave.policies')}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </CardHeader>
      <QueryBoundary query={list} isEmpty={(data) => data.length === 0} empty={<EmptyState title={t('leave.noPolicies')} />}>
        {(policies) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('leave.name')}</TableHead>
                <TableHead>{t('leave.approvalChain')}</TableHead>
                <TableHead>{t('leave.minNoticeDays')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>{policy.name}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {(policy.approvalChain ?? []).map((step, index) => (
                        <Badge key={index} tone="info">
                          {t(`leave.approver.${step.type}`, { defaultValue: step.type })}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>{policy.minNoticeDays}</TableCell>
                  <TableCell>{policy.isDefault ? <Badge tone="brand">{t('leave.defaultPolicy')}</Badge> : '—'}</TableCell>
                  <TableCell className="text-right">
                    {policy.isDefault ? null : (
                      <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => setToDelete(policy)}>
                        <Trash2 className="size-4 text-rose-600" aria-hidden />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryBoundary>
      <PolicyDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(value) => (value ? undefined : setToDelete(null))}
        title={t('leave.deletePolicy')}
        description={toDelete?.name}
        destructive
        loading={remove.isPending}
        onConfirm={() => (toDelete ? remove.mutate(toDelete.id) : undefined)}
      />
    </Card>
  );
}

/* ── Holidays & blackouts ────────────────────────────────────────────────── */

function HolidaysPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const year = new Date().getUTCFullYear();

  const list = useQuery({
    queryKey: ['leave', 'holidays', year],
    queryFn: () => api.get<HolidayItem[]>('/leave/holidays', { query: { year } }),
  });
  const create = useMutation({
    mutationFn: (values: { name: string; date: string; isRecurringYearly: boolean }) => api.post('/leave/holidays', values),
    onSuccess: () => {
      toast.success(t('common.created'));
      void queryClient.invalidateQueries({ queryKey: ['leave', 'holidays'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leave', 'holidays'] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  const schema = z.object({
    name: z.string().min(2, t('common.required')).max(120),
    date: z.string().min(1, t('common.required')),
    isRecurringYearly: z.boolean(),
  });
  type FormValues = z.infer<typeof schema>;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('leave.holidays', { year })}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </CardHeader>
      <QueryBoundary query={list} isEmpty={(data) => data.length === 0} empty={<EmptyState title={t('leave.noHolidays')} />}>
        {(holidays) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('leave.name')}</TableHead>
                <TableHead>{t('leave.date')}</TableHead>
                <TableHead>{t('leave.recurring')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <TableRow key={holiday.id}>
                  <TableCell>{holiday.name}</TableCell>
                  <TableCell>{formatDate(holiday.date)}</TableCell>
                  <TableCell>{holiday.isRecurringYearly ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => remove.mutate(holiday.id)}>
                      <Trash2 className="size-4 text-rose-600" aria-hidden />
                    </Button>
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
        title={t('leave.newHoliday')}
        schema={schema}
        defaultValues={{ name: '', date: '', isRecurringYearly: false }}
        onSubmit={(values) => create.mutateAsync(values)}
      >
        {(form) => (
          <>
            <FormField label={t('leave.name')} htmlFor="holiday-name" error={form.formState.errors.name?.message}>
              <Input id="holiday-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('leave.date')} htmlFor="holiday-date" error={form.formState.errors.date?.message}>
              <Input id="holiday-date" type="date" {...form.register('date')} />
            </FormField>
            <label className="flex items-center justify-between gap-3 text-sm">
              {t('leave.recurring')}
              <Switch checked={form.watch('isRecurringYearly')} onCheckedChange={(checked) => form.setValue('isRecurringYearly', checked)} />
            </label>
          </>
        )}
      </FormDialog>
    </Card>
  );
}

function BlackoutsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({ queryKey: ['leave', 'blackouts'], queryFn: () => api.get<BlackoutItem[]>('/leave/blackouts') });
  const create = useMutation({
    mutationFn: (values: { name: string; startDate: string; endDate: string; reason?: string }) => api.post('/leave/blackouts', values),
    onSuccess: () => {
      toast.success(t('common.created'));
      void queryClient.invalidateQueries({ queryKey: ['leave', 'blackouts'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/blackouts/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['leave', 'blackouts'] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  const schema = z
    .object({
      name: z.string().min(2, t('common.required')).max(120),
      startDate: z.string().min(1, t('common.required')),
      endDate: z.string().min(1, t('common.required')),
      reason: z.string().max(300).optional(),
    })
    .refine((values) => values.endDate >= values.startDate, { path: ['endDate'], message: t('leave.endBeforeStart') });
  type FormValues = z.infer<typeof schema>;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('leave.blackouts')}</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </CardHeader>
      <QueryBoundary query={list} isEmpty={(data) => data.length === 0} empty={<EmptyState title={t('leave.noBlackouts')} />}>
        {(blackouts) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('leave.name')}</TableHead>
                <TableHead>{t('leave.period')}</TableHead>
                <TableHead>{t('leave.reason')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blackouts.map((blackout) => (
                <TableRow key={blackout.id}>
                  <TableCell>{blackout.name}</TableCell>
                  <TableCell>
                    {formatDate(blackout.startDate)} – {formatDate(blackout.endDate)}
                  </TableCell>
                  <TableCell>{blackout.reason ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => remove.mutate(blackout.id)}>
                      <Trash2 className="size-4 text-rose-600" aria-hidden />
                    </Button>
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
        title={t('leave.newBlackout')}
        schema={schema}
        defaultValues={{ name: '', startDate: '', endDate: '', reason: '' }}
        onSubmit={(values) => create.mutateAsync({ ...values, reason: values.reason || undefined })}
      >
        {(form) => (
          <>
            <FormField label={t('leave.name')} htmlFor="blackout-name" error={form.formState.errors.name?.message}>
              <Input id="blackout-name" {...form.register('name')} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('leave.startDate')} htmlFor="blackout-start" error={form.formState.errors.startDate?.message}>
                <Input id="blackout-start" type="date" {...form.register('startDate')} />
              </FormField>
              <FormField label={t('leave.endDate')} htmlFor="blackout-end" error={form.formState.errors.endDate?.message}>
                <Input id="blackout-end" type="date" {...form.register('endDate')} />
              </FormField>
            </div>
            <FormField label={t('leave.reason')} htmlFor="blackout-reason">
              <Textarea id="blackout-reason" rows={2} {...form.register('reason')} />
            </FormField>
          </>
        )}
      </FormDialog>
    </Card>
  );
}

export function LeaveSettingsTabs() {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="types" className="space-y-4">
      <TabsList>
        <TabsTrigger value="types">{t('leave.leaveTypes')}</TabsTrigger>
        <TabsTrigger value="policies">{t('leave.policies')}</TabsTrigger>
        <TabsTrigger value="holidays">{t('leave.holidays', { year: '' })}</TabsTrigger>
        <TabsTrigger value="blackouts">{t('leave.blackouts')}</TabsTrigger>
      </TabsList>
      <TabsContent value="types">
        <LeaveTypesPanel />
      </TabsContent>
      <TabsContent value="policies">
        <PoliciesPanel />
      </TabsContent>
      <TabsContent value="holidays">
        <HolidaysPanel />
      </TabsContent>
      <TabsContent value="blackouts">
        <BlackoutsPanel />
      </TabsContent>
    </Tabs>
  );
}
