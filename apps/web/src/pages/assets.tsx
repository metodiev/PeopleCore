import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, formatMoney, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { AssetDashboard, AssetItem, EmployeeListItem, NamedRef } from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { optionalNumber } from '../components/feature/schemas.js';
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

const ASSET_CATEGORIES = ['LAPTOP', 'PHONE', 'MONITOR', 'CAR', 'ACCESS_CARD', 'EQUIPMENT', 'SOFTWARE_LICENSE', 'OTHER'] as const;
const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
const ASSET_STATUSES = ['AVAILABLE', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'] as const;

type AssetAction = 'assign' | 'return' | 'repair' | 'retire';

function AssetDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; asset: AssetItem | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = props.asset;

  const locations = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/locations', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        category: z.string().min(1, t('common.required')),
        name: z.string().min(2, t('common.required')).max(200),
        serialNumber: z.string().max(120).optional(),
        vendor: z.string().max(160).optional(),
        purchaseDate: z.string().optional(),
        purchaseCost: optionalNumber(t, { min: 0 }),
        currency: z.string().length(3, t('validation.length', { count: 3 })),
        warrantyEndDate: z.string().optional(),
        condition: z.string().min(1, t('common.required')),
        status: z.string().min(1, t('common.required')),
        locationId: z.string().optional(),
        notes: z.string().max(2000).optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const normalize = (values: FormValues) => ({
    ...values,
    serialNumber: values.serialNumber || undefined,
    vendor: values.vendor || undefined,
    purchaseDate: values.purchaseDate || undefined,
    purchaseCost: values.purchaseCost,
    currency: values.currency.toUpperCase(),
    warrantyEndDate: values.warrantyEndDate || undefined,
    locationId: values.locationId || undefined,
    notes: values.notes || undefined,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? api.patch<AssetItem>(`/assets/${editing.id}`, normalize(values))
        : api.post<AssetItem>('/assets', normalize(values)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={editing ? t('assets.editAsset') : t('assets.newAsset')}
      schema={schema}
      className="w-[min(96vw,48rem)]"
      defaultValues={{
        category: editing?.category ?? 'LAPTOP',
        name: editing?.name ?? '',
        serialNumber: editing?.serialNumber ?? '',
        vendor: editing?.vendor ?? '',
        purchaseDate: toDateInputValue(editing?.purchaseDate),
        purchaseCost: editing?.purchaseCost != null ? Number(editing.purchaseCost) : undefined,
        currency: editing?.currency ?? 'EUR',
        warrantyEndDate: toDateInputValue(editing?.warrantyEndDate),
        condition: editing?.condition ?? 'NEW',
        status: editing?.status ?? 'AVAILABLE',
        locationId: editing?.location?.id ?? '',
        notes: editing?.notes ?? '',
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('assets.name')} htmlFor="asset-name" error={form.formState.errors.name?.message}>
              <Input id="asset-name" {...form.register('name')} />
            </FormField>
            <FormField label={t('assets.categoryLabel')} htmlFor="asset-category">
              <Select id="asset-category" {...form.register('category')}>
                {ASSET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`assets.category.${category}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('assets.serialNumber')} htmlFor="asset-serial">
              <Input id="asset-serial" {...form.register('serialNumber')} />
            </FormField>
            <FormField label={t('assets.vendor')} htmlFor="asset-vendor">
              <Input id="asset-vendor" {...form.register('vendor')} />
            </FormField>
            <FormField label={t('assets.purchaseDate')} htmlFor="asset-purchase">
              <Input id="asset-purchase" type="date" {...form.register('purchaseDate')} />
            </FormField>
            <FormField label={t('assets.purchaseCost')} htmlFor="asset-cost" error={form.formState.errors.purchaseCost?.message}>
              <Input id="asset-cost" type="number" step="0.01" min={0} {...form.register('purchaseCost', { valueAsNumber: true })} />
            </FormField>
            <FormField label={t('assets.currency')} htmlFor="asset-currency" error={form.formState.errors.currency?.message}>
              <Input id="asset-currency" maxLength={3} {...form.register('currency')} />
            </FormField>
            <FormField label={t('assets.warrantyEndDate')} htmlFor="asset-warranty">
              <Input id="asset-warranty" type="date" {...form.register('warrantyEndDate')} />
            </FormField>
            <FormField label={t('assets.conditionLabel')} htmlFor="asset-condition">
              <Select id="asset-condition" {...form.register('condition')}>
                {ASSET_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {t(`assets.condition.${condition}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('common.status')} htmlFor="asset-status">
              <Select id="asset-status" {...form.register('status')}>
                {ASSET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`assets.status.${status}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('people.location')} htmlFor="asset-location">
              <Select id="asset-location" {...form.register('locationId')}>
                <option value="">{t('common.none')}</option>
                {(locations.data?.data ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label={t('assets.notes')} htmlFor="asset-notes">
            <Textarea id="asset-notes" rows={2} {...form.register('notes')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function AssetActionDialog(props: { asset: AssetItem | null; action: AssetAction | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [notes, setNotes] = useState('');
  const [unassign, setUnassign] = useState(true);

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: Boolean(props.action === 'assign'),
    staleTime: 5 * 60_000,
  });

  const run = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { condition, notes: notes || undefined };
      if (props.action === 'assign') {
        body['employeeId'] = employeeId;
      }
      if (props.action === 'repair' || props.action === 'retire') {
        body['reason'] = notes || undefined;
        body['unassign'] = props.action === 'retire' ? unassign : undefined;
      }
      if (props.action === 'assign') return api.post(`/assets/${props.asset?.id}/assign`, body);
      if (props.action === 'return') return api.post(`/assets/${props.asset?.id}/return`, body);
      if (props.action === 'repair') return api.post(`/assets/${props.asset?.id}/repair`, body);
      return api.post(`/assets/${props.asset?.id}/retire`, body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      setNotes('');
      setEmployeeId('');
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const needsEmployee = props.action === 'assign';
  const disabled = (needsEmployee && !employeeId) || (props.action === 'repair' && notes.trim().length === 0);

  return (
    <Dialog open={Boolean(props.asset && props.action)} onOpenChange={props.onOpenChange}>
      <DialogContent
        title={t(`assets.action.${props.action ?? 'assign'}`)}
        description={props.asset ? `${props.asset.name}${props.asset.serialNumber ? ` · ${props.asset.serialNumber}` : ''}` : undefined}
      >
        <div className="space-y-4">
          {needsEmployee ? (
            <Field label={t('assets.assignee')} htmlFor="asset-employee" error={!employeeId ? t('common.required') : null}>
              <Select id="asset-employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">{t('common.select')}</option>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t('assets.conditionLabel')} htmlFor="asset-action-condition">
            <Select id="asset-action-condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
              {ASSET_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`assets.condition.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={props.action === 'repair' || props.action === 'retire' ? t('leave.reason') : t('assets.notes')}
            htmlFor="asset-action-notes"
            error={props.action === 'repair' && notes.trim().length === 0 ? t('common.required') : null}
          >
            <Textarea id="asset-action-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {props.action === 'retire' ? (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={unassign} onChange={(event) => setUnassign(event.target.checked)} />
              {t('assets.unassignFromEmployee')}
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant={props.action === 'retire' ? 'danger' : 'primary'} disabled={disabled} loading={run.isPending} onClick={() => run.mutate()}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetDetailDialog(props: { assetId: string | null; onOpenChange: (open: boolean) => void; onEdit: (asset: AssetItem) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [action, setAction] = useState<AssetAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({
    queryKey: ['assets', 'detail', props.assetId],
    queryFn: () => api.get<AssetItem>(`/assets/${props.assetId}`),
    enabled: Boolean(props.assetId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/assets/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setConfirmDelete(false);
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const asset = detail.data;
  const canManage = can('assets.manage');

  return (
    <Dialog open={Boolean(props.assetId)} onOpenChange={props.onOpenChange}>
      <DialogContent title={t('assets.detailTitle')} className="w-[min(96vw,50rem)]">
        <QueryBoundary query={detail} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
          {(data) => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(`assets.category.${data.category}`, { defaultValue: data.category })}
                    {data.serialNumber ? ` · ${data.serialNumber}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge tone={statusTone(data.status)}>{t(`assets.status.${data.status}`, { defaultValue: data.status })}</Badge>
                  <Badge tone={statusTone(data.condition)}>{t(`assets.condition.${data.condition}`, { defaultValue: data.condition })}</Badge>
                </div>
              </div>

              <SectionCard title={t('common.details')}>
                <DefinitionList
                  items={[
                    { label: t('assets.vendor'), value: data.vendor ?? '—' },
                    { label: t('assets.purchaseDate'), value: formatDate(data.purchaseDate) },
                    { label: t('assets.purchaseCost'), value: data.purchaseCost != null ? formatMoney(data.purchaseCost, data.currency ?? 'EUR') : '—' },
                    { label: t('assets.warrantyEndDate'), value: formatDate(data.warrantyEndDate) },
                    { label: t('people.location'), value: data.location?.name ?? '—' },
                    { label: t('assets.assignee'), value: data.assignedTo ? `${data.assignedTo.firstName} ${data.assignedTo.lastName}` : '—' },
                    { label: t('assets.assignedAt'), value: formatDate(data.assignedAt) },
                    { label: t('assets.notes'), value: data.notes ?? '—' },
                  ]}
                />
              </SectionCard>

              <SectionCard title={t('assets.history')}>
                {(data.history ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t('assets.noHistory')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('assets.assignee')}</TableHead>
                        <TableHead>{t('assets.assignedAt')}</TableHead>
                        <TableHead>{t('assets.returnedAt')}</TableHead>
                        <TableHead>{t('assets.conditionLabel')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data.history ?? []).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{entry.employee ? `${entry.employee.firstName} ${entry.employee.lastName}` : '—'}</TableCell>
                          <TableCell>{formatDate(entry.assignedAt)}</TableCell>
                          <TableCell>{formatDate(entry.returnedAt)}</TableCell>
                          <TableCell>{t(`assets.condition.${entry.conditionAtReturn ?? entry.conditionAtAssign ?? 'GOOD'}`, { defaultValue: '—' })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>

              {canManage ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => props.onEdit(data)}>
                    {t('common.edit')}
                  </Button>
                  {data.status === 'AVAILABLE' ? (
                    <Button onClick={() => setAction('assign')}>{t('assets.action.assign')}</Button>
                  ) : null}
                  {data.status === 'ASSIGNED' ? (
                    <Button onClick={() => setAction('return')}>{t('assets.action.return')}</Button>
                  ) : null}
                  {data.status !== 'RETIRED' ? (
                    <Button variant="outline" onClick={() => setAction('repair')}>
                      {t('assets.action.repair')}
                    </Button>
                  ) : null}
                  {data.status !== 'RETIRED' ? (
                    <Button variant="danger" onClick={() => setAction('retire')}>
                      {t('assets.action.retire')}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                    {t('common.delete')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </QueryBoundary>
      </DialogContent>

      <AssetActionDialog asset={action ? asset ?? null : null} action={action} onOpenChange={(open) => (!open ? setAction(null) : undefined)} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('assets.deleteConfirm')}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (asset) remove.mutate(asset.id);
        }}
      />
    </Dialog>
  );
}

function InventoryTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [filters, setFilters] = useState({ status: '', category: '', locationId: '' });
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['locations', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/locations', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });

  const list = useQuery({
    queryKey: ['assets', 'list', { search, ...filters, page }],
    queryFn: () =>
      api.get<Paginated<AssetItem>>('/assets', {
        query: {
          search: search || undefined,
          status: filters.status || undefined,
          category: filters.category || undefined,
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
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          value={term}
          onChange={(value) => {
            setTerm(value);
            setPage(1);
          }}
          placeholder={t('assets.searchPlaceholder')}
          className="sm:w-64"
        />
        <Select aria-label={t('common.status')} className="sm:w-44" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {ASSET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`assets.status.${status}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('assets.categoryLabel')} className="sm:w-48" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {ASSET_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`assets.category.${category}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('people.location')} className="sm:w-44" value={filters.locationId} onChange={(event) => update({ locationId: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {(locations.data?.data ?? []).map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
        {can('assets.manage') ? (
          <Button onClick={() => setCreateOpen(true)} className="sm:ml-auto">
            <Plus className="size-4" aria-hidden />
            {t('assets.newAsset')}
          </Button>
        ) : null}
      </FilterBar>

      <Card>
        <QueryBoundary
          query={list}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState icon={Boxes} title={t('assets.noAssets')} description={t('assets.noAssetsHint')} />}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('assets.name')}</TableHead>
                    <TableHead>{t('assets.categoryLabel')}</TableHead>
                    <TableHead>{t('assets.serialNumber')}</TableHead>
                    <TableHead>{t('assets.assignee')}</TableHead>
                    <TableHead>{t('assets.conditionLabel')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((asset) => (
                    <TableRow
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setOpenId(asset.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setOpenId(asset.id);
                      }}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {asset.name}
                        {asset.location ? <span className="block text-xs text-slate-500">{asset.location.name}</span> : null}
                      </TableCell>
                      <TableCell>{t(`assets.category.${asset.category}`, { defaultValue: asset.category })}</TableCell>
                      <TableCell className="font-mono text-xs">{asset.serialNumber ?? '—'}</TableCell>
                      <TableCell>{asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : '—'}</TableCell>
                      <TableCell>{t(`assets.condition.${asset.condition}`, { defaultValue: asset.condition })}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(asset.status)}>{t(`assets.status.${asset.status}`, { defaultValue: asset.status })}</Badge>
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

      <AssetDialog
        open={createOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        asset={editing}
      />

      <AssetDetailDialog
        assetId={openId}
        onOpenChange={(open) => (!open ? setOpenId(null) : undefined)}
        onEdit={(asset) => {
          setOpenId(null);
          setEditing(asset);
        }}
      />
    </div>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const dashboard = useQuery({ queryKey: ['assets', 'dashboard'], queryFn: () => api.get<AssetDashboard>('/assets/dashboard') });

  return (
    <QueryBoundary query={dashboard} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={4} />}>
      {(data) => (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('assets.totalAssets')} value={data.total} icon={<Boxes className="size-5" />} />
            <StatCard label={t('assets.status.ASSIGNED')} value={data.byStatus['ASSIGNED'] ?? 0} />
            <StatCard label={t('assets.status.AVAILABLE')} value={data.available} tone="positive" />
            <StatCard label={t('assets.status.IN_REPAIR')} value={data.byStatus['IN_REPAIR'] ?? 0} tone={data.byStatus['IN_REPAIR'] ? 'warning' : 'default'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <BarPanel
              title={t('assets.byStatus')}
              data={Object.entries(data.byStatus).map(([label, count]) => ({ label: t(`assets.status.${label}`, { defaultValue: label }), count }))}
              xKey="label"
              series={[{ key: 'count', name: t('assets.count'), color: '#6366f1' }]}
              multiColor
            />
            <BarPanel
              title={t('assets.byCategory')}
              data={Object.entries(data.byCategory).map(([label, count]) => ({ label: t(`assets.category.${label}`, { defaultValue: label }), count }))}
              xKey="label"
              series={[{ key: 'count', name: t('assets.count'), color: '#14b8a6' }]}
              multiColor
            />
          </div>
          <Card>
            <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('assets.warrantyExpiring', { days: data.warrantyExpiringWithinDays })}
              </h3>
            </div>
            {data.warrantyExpiring.length === 0 ? (
              <EmptyState title={t('assets.noWarrantyExpiring')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('assets.name')}</TableHead>
                    <TableHead>{t('assets.serialNumber')}</TableHead>
                    <TableHead>{t('assets.assignee')}</TableHead>
                    <TableHead>{t('assets.warrantyEndDate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.warrantyExpiring.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{asset.name}</TableCell>
                      <TableCell className="font-mono text-xs">{asset.serialNumber ?? '—'}</TableCell>
                      <TableCell>{asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : '—'}</TableCell>
                      <TableCell>{formatDate(asset.warrantyEndDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </QueryBoundary>
  );
}

export function AssetsPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'inventory', label: t('assets.inventory') },
    { value: 'overview', label: t('assets.overview'), permission: 'assets.view' },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const activeTab = params.get('tab') ?? 'inventory';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'inventory';

  return (
    <div className="space-y-6">
      <PageHeader title={t('assets.title')} description={t('assets.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="inventory">{current === 'inventory' ? <InventoryTab /> : null}</TabsContent>
        <TabsContent value="overview">{current === 'overview' ? <OverviewTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
