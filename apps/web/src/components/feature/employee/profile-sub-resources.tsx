import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../../../lib/api.js';
import { formatDate } from '../../../lib/utils.js';
import { useAuth } from '../../../store/auth.js';
import type {
  BankAccount,
  EducationItem,
  EmergencyContact,
  EmployeeNoteItem,
  LanguageItem,
  SkillItem,
} from '../api-types.js';
import { FormDialog, FormField } from '../form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../query.js';
import { LockedSection } from '../widgets.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { Card } from '../../ui/card.js';
import { ConfirmDialog } from '../../ui/dialog.js';
import { EmptyState, TableSkeleton } from '../../ui/feedback.js';
import { Input, Select, Textarea } from '../../ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';

/**
 * Exactly the `:resource` values accepted by `/employees/:id/profile/:resource`
 * (mirrors `PROFILE_RESOURCES` in the API's employee-profile.service.ts).
 * `experience`, `dependents` and `identifications` do not exist.
 */
export const PROFILE_RESOURCES = ['emergency-contacts', 'bank-accounts', 'education', 'skills', 'languages', 'notes'] as const;

export type ProfileResourceName = (typeof PROFILE_RESOURCES)[number];

const NOTE_VISIBILITIES = ['HR_ONLY', 'MANAGER', 'PRIVATE'] as const;

/**
 * The API never exposes the raw IBAN for display: `ibanMasked` carries the
 * masked form. Anything without a mask is masked defensively before it is
 * rendered so a raw value can never leak into the UI.
 */
function maskedIban(account: BankAccount): string {
  if (account.ibanMasked) return account.ibanMasked;
  const raw = account.iban ?? '';
  if (raw.includes('•') || raw.includes('*')) return raw;
  return raw.length > 8 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : '••••';
}

/** True while the IBAN input still holds the masked placeholder. */
function isMaskedValue(value: string): boolean {
  return value.includes('•') || value.includes('*');
}

/**
 * Shared list / create / update / delete plumbing for one profile
 * sub-resource. Sensitive resources (bank accounts, notes) stay disabled
 * unless the caller may read them.
 */
function useProfileResource<T extends { id: string }>(employeeId: string, resource: ProfileResourceName, enabled: boolean) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['employees', employeeId, 'profile', resource],
    queryFn: () => api.get<T[]>(`/employees/${employeeId}/profile/${resource}`),
    enabled,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['employees', employeeId, 'profile', resource] });

  const save = useMutation({
    mutationFn: ({ id, values }: { id?: string; values: Record<string, unknown> }) =>
      id
        ? api.patch(`/employees/${employeeId}/profile/${resource}/${id}`, values)
        : api.post(`/employees/${employeeId}/profile/${resource}`, values),
    onSuccess: () => {
      toast.success(t('common.saved'));
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${employeeId}/profile/${resource}/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return { list, save, remove };
}

interface ResourceCardProps<T extends { id: string }> {
  title: string;
  description?: string;
  query: UseQueryResult<T[], unknown>;
  columns: Array<{ key: string; label: string; render: (item: T) => ReactNode }>;
  emptyTitle: string;
  allowEdit: boolean;
  addLabel?: string;
  onAdd?: () => void;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
}

function ResourceCard<T extends { id: string }>(props: ResourceCardProps<T>) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{props.title}</h3>
          {props.description ? <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{props.description}</p> : null}
        </div>
        {props.allowEdit && props.onAdd ? (
          <Button size="sm" variant="outline" onClick={props.onAdd}>
            <Plus className="size-3.5" aria-hidden />
            {props.addLabel ?? t('common.create')}
          </Button>
        ) : null}
      </div>
      <QueryBoundary
        query={props.query}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState title={props.emptyTitle} />}
        skeleton={<TableSkeleton rows={3} columns={Math.max(2, props.columns.length)} />}
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                {props.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
                {props.allowEdit && (props.onEdit || props.onDelete) ? (
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.id}>
                  {props.columns.map((column) => (
                    <TableCell key={column.key}>{column.render(item)}</TableCell>
                  ))}
                  {props.allowEdit && (props.onEdit || props.onDelete) ? (
                    <TableCell className="text-right">
                      <span className="inline-flex gap-2">
                        {props.onEdit ? (
                          <Button size="sm" variant="ghost" onClick={() => props.onEdit?.(item)}>
                            {t('common.edit')}
                          </Button>
                        ) : null}
                        {props.onDelete ? (
                          <Button size="sm" variant="ghost" onClick={() => props.onDelete?.(item)}>
                            {t('common.delete')}
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryBoundary>
    </Card>
  );
}

/* ── Emergency contacts ─────────────────────────────────────────────────── */

function EmergencyContactsCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const { list, save, remove } = useProfileResource<EmergencyContact>(employeeId, 'emergency-contacts', true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmergencyContact | null>(null);
  const [toDelete, setToDelete] = useState<EmergencyContact | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('common.required')).max(120),
        relationship: z.string().min(1, t('common.required')).max(40),
        phone: z.string().min(1, t('common.required')).max(16),
        email: z.union([z.literal(''), z.string().email(t('validation.email')).max(120)]),
        isPrimary: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.emergencyContacts.title')}
        description={t('employeeProfile.emergencyContacts.hint')}
        query={list}
        emptyTitle={t('employeeProfile.emergencyContacts.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.emergencyContacts.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          {
            key: 'name',
            label: t('employeeProfile.emergencyContacts.name'),
            render: (item) => (
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {item.name}
                {item.isPrimary ? <Badge tone="brand" className="ml-2">{t('employee.primary')}</Badge> : null}
              </span>
            ),
          },
          { key: 'relationship', label: t('employeeProfile.emergencyContacts.relationship'), render: (item) => item.relationship },
          { key: 'phone', label: t('employeeProfile.emergencyContacts.phone'), render: (item) => item.phone },
          { key: 'email', label: t('employeeProfile.emergencyContacts.email'), render: (item) => item.email ?? '—' },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.emergencyContacts.edit') : t('employeeProfile.emergencyContacts.add')}
        schema={schema}
        defaultValues={{
          name: editing?.name ?? '',
          relationship: editing?.relationship ?? '',
          phone: editing?.phone ?? '',
          email: editing?.email ?? '',
          isPrimary: editing?.isPrimary ?? false,
        }}
        onSubmit={(values) =>
          save.mutateAsync({
            id: editing?.id,
            values: { ...values, email: values.email || undefined },
          })
        }
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('employeeProfile.emergencyContacts.name')} htmlFor="contact-name" error={form.formState.errors.name?.message}>
              <Input id="contact-name" {...form.register('name')} />
            </FormField>
            <FormField
              label={t('employeeProfile.emergencyContacts.relationship')}
              htmlFor="contact-relationship"
              error={form.formState.errors.relationship?.message}
            >
              <Input id="contact-relationship" {...form.register('relationship')} />
            </FormField>
            <FormField label={t('employeeProfile.emergencyContacts.phone')} htmlFor="contact-phone" error={form.formState.errors.phone?.message}>
              <Input id="contact-phone" {...form.register('phone')} />
            </FormField>
            <FormField label={t('employeeProfile.emergencyContacts.email')} htmlFor="contact-email" error={form.formState.errors.email?.message}>
              <Input id="contact-email" type="email" {...form.register('email')} />
            </FormField>
            <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
              {t('employeeProfile.emergencyContacts.isPrimary')}
              <input type="checkbox" checked={form.watch('isPrimary')} onChange={(event) => form.setValue('isPrimary', event.target.checked)} />
            </label>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.emergencyContacts.deleteConfirm')}
        description={toDelete?.name}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/* ── Bank accounts ──────────────────────────────────────────────────────── */

function BankAccountsCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const isSelf = useAuth((state) => state.employeeId) === employeeId;
  const canRead = useAuth((state) => state.can('employees.sensitive.view') || state.can('employees.edit'));
  const readable = canRead || isSelf;
  const { list, save, remove } = useProfileResource<BankAccount>(employeeId, 'bank-accounts', readable);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [toDelete, setToDelete] = useState<BankAccount | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        accountHolder: z.string().min(1, t('common.required')).max(120),
        iban: z.string().min(1, t('common.required')).max(40),
        bic: z.string().max(16).optional(),
        bankName: z.string().max(120).optional(),
        currency: z.string().length(3, t('validation.length', { count: 3 })),
        isPrimary: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  if (!readable) {
    return (
      <Card>
        <LockedSection message={t('employeeProfile.bankAccounts.locked')} />
      </Card>
    );
  }

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.bankAccounts.title')}
        description={t('employeeProfile.bankAccounts.hint')}
        query={list}
        emptyTitle={t('employeeProfile.bankAccounts.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.bankAccounts.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          {
            key: 'accountHolder',
            label: t('employeeProfile.bankAccounts.accountHolder'),
            render: (item) => <span className="font-medium text-slate-900 dark:text-slate-100">{item.accountHolder}</span>,
          },
          {
            key: 'iban',
            label: t('employeeProfile.bankAccounts.iban'),
            render: (item) => (
              <span className="font-mono text-xs" title={t('employeeProfile.bankAccounts.maskedHint')}>
                {maskedIban(item)}
                {item.isPrimary ? <Badge tone="brand" className="ml-2">{t('employee.primary')}</Badge> : null}
              </span>
            ),
          },
          { key: 'bankName', label: t('employeeProfile.bankAccounts.bankName'), render: (item) => item.bankName ?? '—' },
          { key: 'bic', label: t('employeeProfile.bankAccounts.bic'), render: (item) => item.bic ?? '—' },
          { key: 'currency', label: t('employeeProfile.bankAccounts.currency'), render: (item) => item.currency ?? '—' },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.bankAccounts.edit') : t('employeeProfile.bankAccounts.add')}
        description={editing ? t('employeeProfile.bankAccounts.ibanKeepHint') : undefined}
        schema={schema}
        defaultValues={{
          accountHolder: editing?.accountHolder ?? '',
          // Pre-filled with the masked value; it is only sent when the user
          // types a new IBAN over it.
          iban: editing ? maskedIban(editing) : '',
          bic: editing?.bic ?? '',
          bankName: editing?.bankName ?? '',
          currency: editing?.currency ?? 'EUR',
          isPrimary: editing?.isPrimary ?? false,
        }}
        onSubmit={(values) =>
          save.mutateAsync({
            id: editing?.id,
            values: {
              accountHolder: values.accountHolder,
              bic: values.bic || undefined,
              bankName: values.bankName || undefined,
              currency: values.currency.toUpperCase(),
              isPrimary: values.isPrimary,
              // Only sent when the user entered a real IBAN — the masked
              // placeholder means "leave the stored value untouched".
              ...(values.iban && !isMaskedValue(values.iban) ? { iban: values.iban } : {}),
            },
          })
        }
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('employeeProfile.bankAccounts.accountHolder')}
              htmlFor="bank-holder"
              error={form.formState.errors.accountHolder?.message}
            >
              <Input id="bank-holder" {...form.register('accountHolder')} />
            </FormField>
            <FormField
              label={t('employeeProfile.bankAccounts.iban')}
              htmlFor="bank-iban"
              hint={editing ? t('employeeProfile.bankAccounts.ibanKeepHint') : t('employeeProfile.bankAccounts.ibanHint')}
              error={form.formState.errors.iban?.message}
            >
              <Input id="bank-iban" autoComplete="off" className="font-mono" {...form.register('iban')} />
            </FormField>
            <FormField label={t('employeeProfile.bankAccounts.bic')} htmlFor="bank-bic">
              <Input id="bank-bic" {...form.register('bic')} />
            </FormField>
            <FormField label={t('employeeProfile.bankAccounts.bankName')} htmlFor="bank-name">
              <Input id="bank-name" {...form.register('bankName')} />
            </FormField>
            <FormField label={t('employeeProfile.bankAccounts.currency')} htmlFor="bank-currency" error={form.formState.errors.currency?.message}>
              <Input id="bank-currency" maxLength={3} {...form.register('currency')} />
            </FormField>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.watch('isPrimary')} onChange={(event) => form.setValue('isPrimary', event.target.checked)} />
              {t('employeeProfile.bankAccounts.isPrimary')}
            </label>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.bankAccounts.deleteConfirm')}
        description={toDelete ? maskedIban(toDelete) : undefined}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/* ── Education ──────────────────────────────────────────────────────────── */

function EducationCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const { list, save, remove } = useProfileResource<EducationItem>(employeeId, 'education', true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EducationItem | null>(null);
  const [toDelete, setToDelete] = useState<EducationItem | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        institution: z.string().min(1, t('common.required')).max(160),
        degree: z.string().max(120).optional(),
        fieldOfStudy: z.string().max(120).optional(),
        startYear: z.string().optional(),
        endYear: z.string().optional(),
        grade: z.string().max(40).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const year = (value?: string) => (value ? Number(value) : undefined);

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.education.title')}
        query={list}
        emptyTitle={t('employeeProfile.education.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.education.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          {
            key: 'institution',
            label: t('employeeProfile.education.institution'),
            render: (item) => <span className="font-medium text-slate-900 dark:text-slate-100">{item.institution}</span>,
          },
          { key: 'degree', label: t('employeeProfile.education.degree'), render: (item) => item.degree ?? '—' },
          { key: 'fieldOfStudy', label: t('employeeProfile.education.fieldOfStudy'), render: (item) => item.fieldOfStudy ?? '—' },
          {
            key: 'years',
            label: t('employeeProfile.education.startYear'),
            render: (item) => `${item.startYear ?? '—'} – ${item.endYear ?? '—'}`,
          },
          { key: 'grade', label: t('employeeProfile.education.grade'), render: (item) => item.grade ?? '—' },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.education.edit') : t('employeeProfile.education.add')}
        schema={schema}
        defaultValues={{
          institution: editing?.institution ?? '',
          degree: editing?.degree ?? '',
          fieldOfStudy: editing?.fieldOfStudy ?? '',
          startYear: editing?.startYear != null ? String(editing.startYear) : '',
          endYear: editing?.endYear != null ? String(editing.endYear) : '',
          grade: editing?.grade ?? '',
        }}
        onSubmit={(values) =>
          save.mutateAsync({
            id: editing?.id,
            values: {
              institution: values.institution,
              degree: values.degree || undefined,
              fieldOfStudy: values.fieldOfStudy || undefined,
              startYear: year(values.startYear),
              endYear: year(values.endYear),
              grade: values.grade || undefined,
            },
          })
        }
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('employeeProfile.education.institution')}
              htmlFor="edu-institution"
              error={form.formState.errors.institution?.message}
            >
              <Input id="edu-institution" {...form.register('institution')} />
            </FormField>
            <FormField label={t('employeeProfile.education.degree')} htmlFor="edu-degree">
              <Input id="edu-degree" {...form.register('degree')} />
            </FormField>
            <FormField label={t('employeeProfile.education.fieldOfStudy')} htmlFor="edu-field">
              <Input id="edu-field" {...form.register('fieldOfStudy')} />
            </FormField>
            <FormField label={t('employeeProfile.education.grade')} htmlFor="edu-grade">
              <Input id="edu-grade" {...form.register('grade')} />
            </FormField>
            <FormField label={t('employeeProfile.education.startYear')} htmlFor="edu-start">
              <Input id="edu-start" type="number" min={1900} max={2100} {...form.register('startYear')} />
            </FormField>
            <FormField label={t('employeeProfile.education.endYear')} htmlFor="edu-end">
              <Input id="edu-end" type="number" min={1900} max={2100} {...form.register('endYear')} />
            </FormField>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.education.deleteConfirm')}
        description={toDelete?.institution}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/* ── Skills ─────────────────────────────────────────────────────────────── */

function SkillsCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const { list, save, remove } = useProfileResource<SkillItem>(employeeId, 'skills', true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SkillItem | null>(null);
  const [toDelete, setToDelete] = useState<SkillItem | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t('common.required')).max(80),
        category: z.string().max(60).optional(),
        level: z.coerce.number({ message: t('validation.number') }).int().min(1).max(5),
        yearsOfExp: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.skills.title')}
        description={t('employeeProfile.skills.hint')}
        query={list}
        emptyTitle={t('employeeProfile.skills.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.skills.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          {
            key: 'name',
            label: t('employeeProfile.skills.name'),
            render: (item) => <span className="font-medium text-slate-900 dark:text-slate-100">{item.skill.name}</span>,
          },
          { key: 'category', label: t('employeeProfile.skills.category'), render: (item) => item.skill.category ?? '—' },
          {
            key: 'level',
            label: t('employeeProfile.skills.level'),
            render: (item) => <Badge tone={item.level >= 4 ? 'success' : item.level >= 2 ? 'info' : 'neutral'}>{item.level} / 5</Badge>,
          },
          { key: 'years', label: t('employeeProfile.skills.yearsOfExp'), render: (item) => item.yearsOfExp ?? '—' },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.skills.edit') : t('employeeProfile.skills.add')}
        description={editing ? t('employeeProfile.skills.nameLockedHint') : undefined}
        schema={schema}
        defaultValues={{
          name: editing?.skill.name ?? '',
          category: editing?.skill.category ?? '',
          level: editing?.level ?? 3,
          yearsOfExp: editing?.yearsOfExp != null ? String(editing.yearsOfExp) : '',
        }}
        onSubmit={(values) =>
          save.mutateAsync({
            id: editing?.id,
            values: editing
              ? {
                  name: values.name,
                  category: values.category || undefined,
                  level: values.level,
                  yearsOfExp: values.yearsOfExp ? Number(values.yearsOfExp) : undefined,
                }
              : {
                  name: values.name,
                  category: values.category || undefined,
                  level: values.level,
                  yearsOfExp: values.yearsOfExp ? Number(values.yearsOfExp) : undefined,
                },
          })
        }
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('employeeProfile.skills.name')}
                htmlFor="skill-name"
                error={form.formState.errors.name?.message}
                hint={editing ? t('employeeProfile.skills.nameLockedHint') : undefined}
              >
                <Input id="skill-name" readOnly={Boolean(editing)} className={editing ? 'bg-slate-50 dark:bg-slate-800' : undefined} {...form.register('name')} />
              </FormField>
              <FormField label={t('employeeProfile.skills.category')} htmlFor="skill-category">
                <Input
                  id="skill-category"
                  readOnly={Boolean(editing)}
                  className={editing ? 'bg-slate-50 dark:bg-slate-800' : undefined}
                  {...form.register('category')}
                />
              </FormField>
              <FormField label={t('employeeProfile.skills.level')} htmlFor="skill-level" error={form.formState.errors.level?.message}>
                <Input id="skill-level" type="number" min={1} max={5} {...form.register('level', { valueAsNumber: true })} />
              </FormField>
              <FormField label={t('employeeProfile.skills.yearsOfExp')} htmlFor="skill-years">
                <Input id="skill-years" type="number" min={0} {...form.register('yearsOfExp')} />
              </FormField>
            </div>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.skills.deleteConfirm')}
        description={toDelete?.skill.name}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/* ── Languages ──────────────────────────────────────────────────────────── */

function LanguagesCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const { list, save, remove } = useProfileResource<LanguageItem>(employeeId, 'languages', true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LanguageItem | null>(null);
  const [toDelete, setToDelete] = useState<LanguageItem | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        language: z.string().min(1, t('common.required')).max(60),
        level: z.string().min(1, t('common.required')).max(20),
        isNative: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.languages.title')}
        query={list}
        emptyTitle={t('employeeProfile.languages.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.languages.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          {
            key: 'language',
            label: t('employeeProfile.languages.language'),
            render: (item) => (
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {item.language}
                {item.isNative ? <Badge tone="info" className="ml-2">{t('employeeProfile.languages.isNative')}</Badge> : null}
              </span>
            ),
          },
          { key: 'level', label: t('employeeProfile.languages.level'), render: (item) => item.level },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.languages.edit') : t('employeeProfile.languages.add')}
        schema={schema}
        defaultValues={{
          language: editing?.language ?? '',
          level: editing?.level ?? 'B2',
          isNative: editing?.isNative ?? false,
        }}
        onSubmit={(values) => save.mutateAsync({ id: editing?.id, values })}
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('employeeProfile.languages.language')} htmlFor="lang-name" error={form.formState.errors.language?.message}>
              <Input id="lang-name" {...form.register('language')} />
            </FormField>
            <FormField
              label={t('employeeProfile.languages.level')}
              htmlFor="lang-level"
              hint={t('employeeProfile.languages.levelHint')}
              error={form.formState.errors.level?.message}
            >
              <Input id="lang-level" {...form.register('level')} />
            </FormField>
            <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2">
              {t('employeeProfile.languages.isNative')}
              <input type="checkbox" checked={form.watch('isNative')} onChange={(event) => form.setValue('isNative', event.target.checked)} />
            </label>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.languages.deleteConfirm')}
        description={toDelete?.language}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/* ── Notes ──────────────────────────────────────────────────────────────── */

function NotesCard({ employeeId, allowEdit }: { employeeId: string; allowEdit: boolean }) {
  const { t } = useTranslation();
  const isSelf = useAuth((state) => state.employeeId) === employeeId;
  const canRead = useAuth((state) => state.can('employees.sensitive.view') || state.can('employees.edit'));
  const readable = canRead || isSelf;
  const { list, save, remove } = useProfileResource<EmployeeNoteItem>(employeeId, 'notes', readable);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeNoteItem | null>(null);
  const [toDelete, setToDelete] = useState<EmployeeNoteItem | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        body: z.string().min(1, t('common.required')).max(4000),
        visibility: z.string().min(1, t('common.required')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  if (!readable) {
    return (
      <Card>
        <LockedSection message={t('employeeProfile.notes.locked')} />
      </Card>
    );
  }

  return (
    <>
      <ResourceCard
        title={t('employeeProfile.notes.title')}
        query={list}
        emptyTitle={t('employeeProfile.notes.empty')}
        allowEdit={allowEdit}
        addLabel={t('employeeProfile.notes.add')}
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setOpen(true);
        }}
        onDelete={setToDelete}
        columns={[
          { key: 'body', label: t('employeeProfile.notes.body'), render: (item) => <span className="whitespace-pre-wrap">{item.body}</span> },
          {
            key: 'visibility',
            label: t('employeeProfile.notes.visibility'),
            render: (item) => <Badge tone={item.visibility === 'PRIVATE' ? 'neutral' : 'info'}>{t(`employeeProfile.notes.visibilityValue.${item.visibility}`, { defaultValue: item.visibility })}</Badge>,
          },
          { key: 'createdAt', label: t('audit.date'), render: (item) => formatDate(item.createdAt) },
        ]}
      />

      <FormDialog<FormValues>
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setEditing(null);
        }}
        title={editing ? t('employeeProfile.notes.edit') : t('employeeProfile.notes.add')}
        description={editing ? t('employeeProfile.notes.bodyOnlyHint') : undefined}
        schema={schema}
        defaultValues={{ body: editing?.body ?? '', visibility: editing?.visibility ?? 'HR_ONLY' }}
        onSubmit={(values) =>
          save.mutateAsync({
            id: editing?.id,
            values: editing ? { body: values.body } : values,
          })
        }
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {(form) => (
          <>
            <FormField label={t('employeeProfile.notes.body')} htmlFor="note-body" error={form.formState.errors.body?.message}>
              <Textarea id="note-body" rows={4} {...form.register('body')} />
            </FormField>
            {!editing ? (
              <FormField label={t('employeeProfile.notes.visibility')} htmlFor="note-visibility">
                <Select id="note-visibility" {...form.register('visibility')}>
                  {NOTE_VISIBILITIES.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {t(`employeeProfile.notes.visibilityValue.${visibility}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('employeeProfile.notes.deleteConfirm')}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
    </>
  );
}

/**
 * Editable profile sub-resources backed by
 * `GET/POST /employees/:id/profile/:resource` and
 * `PATCH/DELETE /employees/:id/profile/:resource/:itemId`.
 */
export function ProfileSubResources({ employeeId, allowEdit = false }: { employeeId: string; allowEdit?: boolean }) {
  return (
    <div className="space-y-4">
      <EducationCard employeeId={employeeId} allowEdit={allowEdit} />
      <SkillsCard employeeId={employeeId} allowEdit={allowEdit} />
      <LanguagesCard employeeId={employeeId} allowEdit={allowEdit} />
      <EmergencyContactsCard employeeId={employeeId} allowEdit={allowEdit} />
      <BankAccountsCard employeeId={employeeId} allowEdit={allowEdit} />
      <NotesCard employeeId={employeeId} allowEdit={allowEdit} />
    </div>
  );
}
