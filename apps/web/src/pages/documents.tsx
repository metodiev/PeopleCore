import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Plus, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  DocumentCategoryItem,
  DocumentDownload,
  DocumentItem,
  EmployeeListItem,
} from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { DefinitionList, FilterBar, SearchInput, useDebouncedValue } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { ConfirmDialog, Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const DOCUMENT_STATUSES = ['ACTIVE', 'ARCHIVED', 'EXPIRED'] as const;
const CONFIDENTIALITIES = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function UploadDocumentDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const categories = useQuery({
    queryKey: ['documents', 'categories'],
    queryFn: () => api.get<DocumentCategoryItem[]>('/documents/categories'),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(200),
        description: z.string().max(2000).optional(),
        categoryId: z.string().optional(),
        employeeId: z.string().optional(),
        confidentiality: z.string().min(1, t('common.required')),
        issuedAt: z.string().optional(),
        expiresAt: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const upload = useMutation({
    mutationFn: (values: FormValues) => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error(t('documents.fileRequired'));
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', values.name);
      if (values.description) formData.append('description', values.description);
      if (values.categoryId) formData.append('categoryId', values.categoryId);
      if (values.employeeId) formData.append('employeeId', values.employeeId);
      formData.append('confidentiality', values.confidentiality);
      if (values.issuedAt) formData.append('issuedAt', values.issuedAt);
      if (values.expiresAt) formData.append('expiresAt', values.expiresAt);
      return api.upload<DocumentItem>('/documents', formData);
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('documents.upload')}
      description={t('documents.uploadHint')}
      schema={schema}
      className="w-[min(96vw,44rem)]"
      defaultValues={{
        name: '',
        description: '',
        categoryId: '',
        employeeId: '',
        confidentiality: 'INTERNAL',
        issuedAt: toDateInputValue(new Date()),
        expiresAt: '',
      }}
      onSubmit={(values) => upload.mutateAsync(values)}
      submitLabel={t('documents.upload')}
    >
      {(form) => (
        <>
          <FormField label={t('documents.file')} htmlFor="doc-file">
            <input
              id="doc-file"
              ref={fileRef}
              type="file"
              required
              className="block w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('documents.name')} htmlFor="doc-name" error={form.formState.errors.name?.message}>
              <Input id="doc-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('documents.category')} htmlFor="doc-category">
              <Select id="doc-category" {...form.register('categoryId')}>
                <option value="">{t('common.none')}</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('documents.employee')} htmlFor="doc-employee">
              <Select id="doc-employee" {...form.register('employeeId')}>
                <option value="">{t('documents.companyWide')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('documents.confidentiality')} htmlFor="doc-confidentiality">
              <Select id="doc-confidentiality" {...form.register('confidentiality')}>
                {CONFIDENTIALITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`documents.confidentialityValue.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('documents.issuedAt')} htmlFor="doc-issued">
              <Input id="doc-issued" type="date" {...form.register('issuedAt')} />
            </FormField>
            <FormField label={t('documents.expiresAt')} htmlFor="doc-expires">
              <Input id="doc-expires" type="date" {...form.register('expiresAt')} />
            </FormField>
          </div>
          <FormField label={t('documents.description')} htmlFor="doc-description">
            <Textarea id="doc-description" rows={2} {...form.register('description')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function EditDocumentDialog(props: { document: DocumentItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ['documents', 'categories'],
    queryFn: () => api.get<DocumentCategoryItem[]>('/documents/categories'),
    enabled: Boolean(props.document),
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(200),
        description: z.string().max(2000).optional(),
        categoryId: z.string().optional(),
        confidentiality: z.string().min(1, t('common.required')),
        issuedAt: z.string().optional(),
        expiresAt: z.string().optional(),
        status: z.string().min(1, t('common.required')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      api.patch<DocumentItem>(`/documents/${props.document?.id}`, {
        ...values,
        description: values.description || undefined,
        categoryId: values.categoryId || undefined,
        issuedAt: values.issuedAt || undefined,
        expiresAt: values.expiresAt || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  return (
    <FormDialog<FormValues>
      open={Boolean(props.document)}
      onOpenChange={props.onOpenChange}
      title={t('documents.edit')}
      schema={schema}
      defaultValues={{
        name: props.document?.name ?? '',
        description: props.document?.description ?? '',
        categoryId: props.document?.category?.id ?? '',
        confidentiality: props.document?.confidentiality ?? 'INTERNAL',
        issuedAt: toDateInputValue(props.document?.issuedAt),
        expiresAt: toDateInputValue(props.document?.expiresAt),
        status: props.document?.status ?? 'ACTIVE',
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('documents.name')} htmlFor="edit-doc-name" error={form.formState.errors.name?.message}>
              <Input id="edit-doc-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('documents.category')} htmlFor="edit-doc-category">
              <Select id="edit-doc-category" {...form.register('categoryId')}>
                <option value="">{t('common.none')}</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('documents.confidentiality')} htmlFor="edit-doc-confidentiality">
              <Select id="edit-doc-confidentiality" {...form.register('confidentiality')}>
                {CONFIDENTIALITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`documents.confidentialityValue.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('common.status')} htmlFor="edit-doc-status">
              <Select id="edit-doc-status" {...form.register('status')}>
                {DOCUMENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`documents.statusValue.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('documents.issuedAt')} htmlFor="edit-doc-issued">
              <Input id="edit-doc-issued" type="date" {...form.register('issuedAt')} />
            </FormField>
            <FormField label={t('documents.expiresAt')} htmlFor="edit-doc-expires">
              <Input id="edit-doc-expires" type="date" {...form.register('expiresAt')} />
            </FormField>
          </div>
          <FormField label={t('documents.description')} htmlFor="edit-doc-description">
            <Textarea id="edit-doc-description" rows={2} {...form.register('description')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function DocumentDetailDialog(props: { documentId: string | null; onOpenChange: (open: boolean) => void; onEdit: (document: DocumentItem) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const versionRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({
    queryKey: ['documents', 'detail', props.documentId],
    queryFn: () => api.get<DocumentItem>(`/documents/${props.documentId}`),
    enabled: Boolean(props.documentId),
  });

  const download = useMutation({
    mutationFn: (id: string) => api.get<DocumentDownload>(`/documents/${id}/download`),
    onSuccess: (payload) => window.open(payload.url, '_blank', 'noopener'),
    onError: (error) => toast.error(describeError(error)),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/documents/${id}/acknowledge`, {}),
    onSuccess: () => {
      toast.success(t('documents.acknowledged'));
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const addVersion = useMutation({
    mutationFn: (id: string) => {
      const file = versionRef.current?.files?.[0];
      if (!file) throw new Error(t('documents.fileRequired'));
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<DocumentItem>(`/documents/${id}/versions`, formData);
    },
    onSuccess: () => {
      if (versionRef.current) versionRef.current.value = '';
      toast.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setConfirmDelete(false);
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Dialog open={Boolean(props.documentId)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('documents.detailTitle')} className="w-[min(96vw,48rem)]">
        <QueryBoundary query={detail} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
          {(data) => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {data.category?.name ?? '—'}
                    {data.employee ? ` · ${data.employee.firstName} ${data.employee.lastName}` : ` · ${t('documents.companyWide')}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(data.status)}>{t(`documents.statusValue.${data.status}`, { defaultValue: data.status })}</Badge>
                  <Badge tone="neutral">{t(`documents.confidentialityValue.${data.confidentiality}`, { defaultValue: data.confidentiality })}</Badge>
                </div>
              </div>

              <DefinitionList
                items={[
                  { label: t('documents.issuedAt'), value: formatDate(data.issuedAt) },
                  { label: t('documents.expiresAt'), value: formatDate(data.expiresAt) },
                  { label: t('documents.versions'), value: data.versions },
                  { label: t('documents.acknowledgments'), value: data.acknowledgments },
                  { label: t('documents.uploadedAt'), value: formatDate(data.createdAt) },
                  {
                    label: t('documents.file'),
                    value: data.currentVersion
                      ? `${data.currentVersion.fileName} · ${formatBytes(data.currentVersion.sizeBytes)}`
                      : '—',
                  },
                ]}
              />
              {data.description ? (
                <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{data.description}</p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {can('documents.view') ? (
                  <Button variant="outline" loading={download.isPending} onClick={() => download.mutate(data.id)}>
                    <Download className="size-4" aria-hidden />
                    {t('documents.download')}
                  </Button>
                ) : null}
                {can('documents.acknowledge') ? (
                  <Button variant="outline" loading={acknowledge.isPending} onClick={() => acknowledge.mutate(data.id)}>
                    {t('documents.acknowledge')}
                  </Button>
                ) : null}
                {can('documents.manage') ? (
                  <>
                    <Button variant="outline" onClick={() => props.onEdit(data)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                      {t('common.delete')}
                    </Button>
                  </>
                ) : null}
              </div>

              {can('documents.upload') ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('documents.newVersion')}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input ref={versionRef} type="file" className="text-sm" aria-label={t('documents.newVersion')} />
                    <Button size="sm" loading={addVersion.isPending} onClick={() => addVersion.mutate(data.id)}>
                      <Upload className="size-3.5" aria-hidden />
                      {t('documents.uploadVersion')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </QueryBoundary>
      </DialogContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('documents.deleteConfirm')}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (props.documentId) remove.mutate(props.documentId);
        }}
      />
    </Dialog>
  );
}

function DocumentsTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', categoryId: '', employeeId: '' });
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['documents', 'categories'],
    queryFn: () => api.get<DocumentCategoryItem[]>('/documents/categories'),
    staleTime: 5 * 60_000,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: can('documents.manage'),
    staleTime: 5 * 60_000,
  });

  const list = useQuery({
    queryKey: ['documents', 'list', { search, ...filters, page }],
    queryFn: () =>
      api.get<Paginated<DocumentItem>>('/documents', {
        query: {
          search: search || undefined,
          status: filters.status || undefined,
          categoryId: filters.categoryId || undefined,
          employeeId: filters.employeeId || undefined,
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
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          value={term}
          onChange={(value) => {
            setTerm(value);
            setPage(1);
          }}
          placeholder={t('documents.searchPlaceholder')}
          className="sm:w-64"
        />
        <Select aria-label={t('common.status')} className="sm:w-40" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {DOCUMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`documents.statusValue.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('documents.category')} className="sm:w-48" value={filters.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        {can('documents.manage') ? (
          <Select aria-label={t('documents.employee')} className="sm:w-52" value={filters.employeeId} onChange={(event) => update({ employeeId: event.target.value })}>
            <option value="">{t('documents.allEmployees')}</option>
            {(employees.data?.data ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </Select>
        ) : null}
        {can('documents.upload') ? (
          <Button className="sm:ml-auto" onClick={() => setUploadOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('documents.upload')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState icon={FileText} title={t('documents.noDocuments')} description={t('documents.noDocumentsHint')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('documents.name')}</TableHead>
                    <TableHead>{t('documents.category')}</TableHead>
                    <TableHead>{t('documents.employee')}</TableHead>
                    <TableHead>{t('documents.expiresAt')}</TableHead>
                    <TableHead>{t('documents.versions')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((document) => (
                    <TableRow
                      key={document.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setOpenId(document.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setOpenId(document.id);
                      }}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {document.name}
                        {document.currentVersion ? (
                          <span className="block text-xs text-slate-500">{document.currentVersion.fileName}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{document.category?.name ?? '—'}</TableCell>
                      <TableCell>
                        {document.employee ? `${document.employee.firstName} ${document.employee.lastName}` : t('documents.companyWide')}
                      </TableCell>
                      <TableCell>{formatDate(document.expiresAt)}</TableCell>
                      <TableCell className="tabular-nums">
                        {document.versions} / {document.acknowledgments}
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusTone(document.status)}>{t(`documents.statusValue.${document.status}`, { defaultValue: document.status })}</Badge>
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

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <EditDocumentDialog
        document={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DocumentDetailDialog
        documentId={openId}
        onOpenChange={(open) => (!open ? setOpenId(null) : undefined)}
        onEdit={(document) => {
          setOpenId(null);
          setEditing(document);
        }}
      />
    </div>
  );
}

function ExpiringTab() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const expiring = useQuery({
    queryKey: ['documents', 'expiring', days],
    queryFn: () => api.get<DocumentItem[]>('/documents/expiring', { query: { days } }),
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <Select aria-label={t('documents.expiringWindow')} className="sm:w-52" value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
          {[7, 30, 60, 90].map((value) => (
            <option key={value} value={value}>
              {t('documents.expiringWithin', { days: value })}
            </option>
          ))}
        </Select>
      </FilterBar>
      <Card>
        <QueryBoundary
          query={expiring}
          isEmpty={(data) => data.length === 0}
          empty={<EmptyState icon={FileText} title={t('documents.noExpiring')} description={t('documents.noExpiringHint')} />}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('documents.name')}</TableHead>
                  <TableHead>{t('documents.employee')}</TableHead>
                  <TableHead>{t('documents.category')}</TableHead>
                  <TableHead>{t('documents.expiresAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{document.name}</TableCell>
                    <TableCell>
                      {document.employee ? `${document.employee.firstName} ${document.employee.lastName}` : t('documents.companyWide')}
                    </TableCell>
                    <TableCell>{document.category?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone('EXPIRING')}>{formatDate(document.expiresAt)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </Card>
    </div>
  );
}

function CategoriesTab() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ['documents', 'categories'],
    queryFn: () => api.get<DocumentCategoryItem[]>('/documents/categories'),
  });

  const schema = useMemo(
    () =>
      z.object({
        key: z.string().min(2, t('common.required')).max(40),
        name: z.string().min(2, t('common.required')).max(120),
        requiresAcknowledgement: z.boolean(),
        requiresExpiry: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post('/documents/categories', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['documents', 'categories'] }),
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('documents.categories')}</h3>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('common.create')}
        </Button>
      </div>
      <QueryBoundary query={list} isEmpty={(data) => data.length === 0} empty={<EmptyState title={t('documents.noCategories')} />}>
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('documents.name')}</TableHead>
                <TableHead>{t('documents.key')}</TableHead>
                <TableHead>{t('documents.requiresAcknowledgement')}</TableHead>
                <TableHead>{t('documents.requiresExpiry')}</TableHead>
                <TableHead>{t('documents.retentionDays')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">{category.name}</TableCell>
                  <TableCell className="font-mono text-xs">{category.key}</TableCell>
                  <TableCell>{category.requiresAcknowledgement ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>{category.requiresExpiry ? t('common.yes') : t('common.no')}</TableCell>
                  <TableCell>{category.defaultRetentionDays ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryBoundary>

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('documents.newCategory')}
        schema={schema}
        defaultValues={{ key: '', name: '', requiresAcknowledgement: false, requiresExpiry: false }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('documents.key')} htmlFor="doc-cat-key" error={form.formState.errors.key?.message}>
                <Input id="doc-cat-key" placeholder="CONTRACT" {...form.register('key')} />
              </FormField>
              <FormField label={t('documents.name')} htmlFor="doc-cat-name" error={form.formState.errors.name?.message}>
                <Input id="doc-cat-name" {...form.register('name')} />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('documents.requiresAcknowledgement')}
                <input
                  type="checkbox"
                  checked={form.watch('requiresAcknowledgement')}
                  onChange={(event) => form.setValue('requiresAcknowledgement', event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('documents.requiresExpiry')}
                <input type="checkbox" checked={form.watch('requiresExpiry')} onChange={(event) => form.setValue('requiresExpiry', event.target.checked)} />
              </label>
            </div>
          </>
        )}
      </FormDialog>
    </Card>
  );
}

export function DocumentsPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'all', label: t('documents.allDocuments') },
    { value: 'expiring', label: t('documents.expiring'), permission: 'documents.view' },
    { value: 'categories', label: t('documents.categories'), permission: 'documents.manage' },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const activeTab = params.get('tab') ?? 'all';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'all';

  return (
    <div className="space-y-6">
      <PageHeader title={t('documents.title')} description={t('documents.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="all">{current === 'all' ? <DocumentsTab /> : null}</TabsContent>
        <TabsContent value="expiring">{current === 'expiring' ? <ExpiringTab /> : null}</TabsContent>
        <TabsContent value="categories">{current === 'categories' ? <CategoriesTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
