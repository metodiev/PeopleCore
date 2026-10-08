import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { z } from 'zod';
import { FormDialog, FormField } from '../form-dialog.js';
import { Input, Select, Textarea } from '../../ui/input.js';

export interface CorrectionValues {
  date: string;
  requestedClockIn?: string;
  requestedClockOut?: string;
  requestedStatus?: string;
  reason: string;
}

const STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'REMOTE', 'LEAVE', 'HOLIDAY', 'ABSENT'] as const;

export function CorrectionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CorrectionValues) => Promise<unknown>;
}) {
  const { t } = useTranslation();

  const schema = useMemo(
    () =>
      z
        .object({
          date: z.string().min(1, t('common.required')),
          requestedClockIn: z.string().optional(),
          requestedClockOut: z.string().optional(),
          requestedStatus: z.string().optional(),
          reason: z.string().min(3, t('validation.minLength', { count: 3 })).max(1000),
        })
        .refine((values) => Boolean(values.requestedClockIn || values.requestedClockOut || values.requestedStatus), {
          path: ['requestedClockIn'],
          message: t('attendance.correctionNeedsValue'),
        }),
    [t],
  );

  return (
    <FormDialog<CorrectionValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('attendance.requestCorrection')}
      description={t('attendance.correctionHint')}
      schema={schema}
      defaultValues={{ date: '', requestedClockIn: '', requestedClockOut: '', requestedStatus: '', reason: '' }}
      onSubmit={(values) =>
        props.onSubmit({
          ...values,
          requestedClockIn: values.requestedClockIn || undefined,
          requestedClockOut: values.requestedClockOut || undefined,
          requestedStatus: values.requestedStatus || undefined,
        })
      }
    >
      {(form) => (
        <>
          <FormField label={t('attendance.date')} htmlFor="correction-date" error={form.formState.errors.date?.message}>
            <Input id="correction-date" type="date" {...form.register('date')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('attendance.newClockIn')} htmlFor="correction-in" error={form.formState.errors.requestedClockIn?.message}>
              <Input id="correction-in" type="time" {...form.register('requestedClockIn')} />
            </FormField>
            <FormField label={t('attendance.newClockOut')} htmlFor="correction-out">
              <Input id="correction-out" type="time" {...form.register('requestedClockOut')} />
            </FormField>
          </div>
          <FormField label={t('attendance.newStatus')} htmlFor="correction-status">
            <Select id="correction-status" {...form.register('requestedStatus')}>
              <option value="">{t('common.none')}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`attendance.status.${status}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('attendance.reason')} htmlFor="correction-reason" error={form.formState.errors.reason?.message}>
            <Textarea id="correction-reason" rows={3} {...form.register('reason')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}
