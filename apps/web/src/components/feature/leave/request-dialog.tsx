import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../../lib/api.js';
import { formatDate } from '../../../lib/utils.js';
import type { LeaveTypeItem } from '../api-types.js';
import { FormDialog, FormField } from '../form-dialog.js';
import { Input, Select, Textarea } from '../../ui/input.js';
import { Switch } from '../../ui/misc.js';

export interface LeaveRequestValues {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  reason?: string;
}

function countWeekdays(start: string, end: string): number {
  if (!start || !end) return 0;
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  let days = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Client-side estimate shown live; the API remains the authority on balances. */
export function estimateLeaveDays(values: Pick<LeaveRequestValues, 'startDate' | 'endDate' | 'startHalfDay' | 'endHalfDay'>): number {
  const weekdays = countWeekdays(values.startDate, values.endDate);
  if (weekdays <= 0) return 0;
  const sameDay = values.startDate === values.endDate;
  let days = weekdays;
  if (sameDay) {
    if (values.startHalfDay || values.endHalfDay) days = 0.5;
    return days;
  }
  if (values.startHalfDay) days -= 0.5;
  if (values.endHalfDay) days -= 0.5;
  return Math.max(0, days);
}

export function RequestLeaveDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: LeaveRequestValues) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api.get<LeaveTypeItem[]>('/leave/types'),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z
        .object({
          leaveTypeId: z.string().min(1, t('common.required')),
          startDate: z.string().min(1, t('common.required')),
          endDate: z.string().min(1, t('common.required')),
          startHalfDay: z.boolean(),
          endHalfDay: z.boolean(),
          reason: z.string().max(1000).optional(),
        })
        .refine((values) => values.endDate >= values.startDate, {
          path: ['endDate'],
          message: t('leave.endBeforeStart'),
        })
        .refine((values) => estimateLeaveDays(values) > 0, {
          path: ['endDate'],
          message: t('leave.noWorkingDays'),
        }),
    [t],
  );

  const onSubmit = async (values: LeaveRequestValues) => {
    await props.onSubmit({
      ...values,
      reason: values.reason && values.reason.trim().length > 0 ? values.reason : undefined,
    });
  };

  return (
    <FormDialog<LeaveRequestValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('leave.newRequest')}
      schema={schema}
      defaultValues={{ leaveTypeId: '', startDate: '', endDate: '', startHalfDay: false, endHalfDay: false, reason: '' }}
      onSubmit={onSubmit}
      submitLabel={t('leave.submitRequest')}
    >
      {(form) => {
        const values = form.watch();
        const days = estimateLeaveDays(values);
        const type = (types.data ?? []).find((entry) => entry.id === values.leaveTypeId);
        return (
          <>
            <FormField label={t('leave.leaveType')} htmlFor="leave-type" error={form.formState.errors.leaveTypeId?.message}>
              <Select id="leave-type" {...form.register('leaveTypeId')}>
                <option value="">{t('common.select')}</option>
                {(types.data ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.defaultDaysPerYear ? ` (${entry.defaultDaysPerYear})` : ''}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('leave.startDate')} htmlFor="leave-start" error={form.formState.errors.startDate?.message}>
                <Input id="leave-start" type="date" {...form.register('startDate')} />
              </FormField>
              <FormField label={t('leave.endDate')} htmlFor="leave-end" error={form.formState.errors.endDate?.message}>
                <Input id="leave-end" type="date" {...form.register('endDate')} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('leave.startHalfDay')}
                <Switch id="leave-start-half" checked={values.startHalfDay} onCheckedChange={(checked) => form.setValue('startHalfDay', checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('leave.endHalfDay')}
                <Switch id="leave-end-half" checked={values.endHalfDay} onCheckedChange={(checked) => form.setValue('endHalfDay', checked)} />
              </label>
            </div>
            <FormField label={t('leave.reason')} htmlFor="leave-reason" error={form.formState.errors.reason?.message}>
              <Textarea id="leave-reason" rows={3} {...form.register('reason')} />
            </FormField>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
              <p className="font-medium text-slate-900 dark:text-slate-100">{t('leave.computedDays', { days })}</p>
              {type?.requiresAttachment ? <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('leave.attachmentRequired', { name: type.name })}</p> : null}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('leave.period')}: {formatDate(values.startDate)} – {formatDate(values.endDate)}
              </p>
            </div>
          </>
        );
      }}
    </FormDialog>
  );
}
