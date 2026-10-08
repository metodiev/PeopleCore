import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Download, Plus, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDateTime } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  NamedRef,
  ReportCatalogEntry,
  ReportExportResult,
  ReportResult,
  ReportRunItem,
  SavedReportItem,
} from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { DefinitionList, FilterBar, SectionCard } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { ConfirmDialog } from '../components/ui/dialog.js';
import { EmptyState } from '../components/ui/feedback.js';
import { Input, Select } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'] as const;
const SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'] as const;

function downloadText(filename: string, contentType: string, body: string): void {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function CatalogTab() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const [type, setType] = useState('');
  const [filters, setFilters] = useState({ from: '', to: '', departmentId: '', locationId: '' });
  const [page, setPage] = useState(1);

  const catalog = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api.get<{ types: ReportCatalogEntry[] }>('/reports/catalog'),
  });
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

  const selected = catalog.data?.types.find((entry) => entry.type === type) ?? null;

  const result = useQuery({
    queryKey: ['reports', 'run', type, filters, page],
    queryFn: () =>
      api.get<ReportResult>(`/reports/${type}`, {
        query: {
          from: filters.from || undefined,
          to: filters.to || undefined,
          departmentId: filters.departmentId || undefined,
          locationId: filters.locationId || undefined,
          page,
          pageSize: 25,
        },
      }),
    enabled: Boolean(type),
  });

  const exportReport = useMutation({
    mutationFn: async (format: (typeof EXPORT_FORMATS)[number]) => {
      if (format === 'csv') {
        const content = await api.get<string>(`/reports/${type}`, {
          query: {
            from: filters.from || undefined,
            to: filters.to || undefined,
            departmentId: filters.departmentId || undefined,
            locationId: filters.locationId || undefined,
            format: 'csv',
          },
        });
        return { filename: `${type.toLowerCase()}.csv`, contentType: 'text/csv; charset=utf-8', body: content, rowCount: -1 };
      }
      const payload = await api.post<ReportExportResult>('/reports/export', {
        type,
        format,
        from: filters.from || undefined,
        to: filters.to || undefined,
        departmentId: filters.departmentId || undefined,
        locationId: filters.locationId || undefined,
      });
      return {
        filename: `${type.toLowerCase()}.json`,
        contentType: 'application/json',
        body: JSON.stringify(payload, null, 2),
        rowCount: payload.rowCount,
      };
    },
    onSuccess: (payload) => {
      downloadText(payload.filename, payload.contentType, payload.body);
      toast.success(payload.rowCount < 0 ? t('reports.downloaded') : t('reports.exported', { count: payload.rowCount }));
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t('reports.catalog')}</h3>
        </div>
        <QueryBoundary query={catalog} isEmpty={(data) => data.types.length === 0} empty={<EmptyState title={t('reports.noTypes')} />}>
          {(data) => (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.types.map((entry) => (
                <li key={entry.type}>
                  <button
                    type="button"
                    onClick={() => {
                      setType(entry.type);
                      setPage(1);
                    }}
                    className={`w-full px-5 py-3 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      entry.type === type ? 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="block font-medium">{entry.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{entry.description}</span>
                    {entry.salary ? <Badge tone="warning" className="mt-1">{t('reports.salaryData')}</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Card>

      <div className="space-y-4">
        <FilterBar>
          <Input aria-label={t('common.from')} type="date" className="sm:w-40" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
          <Input aria-label={t('common.to')} type="date" className="sm:w-40" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
          <Select aria-label={t('people.department')} className="sm:w-48" value={filters.departmentId} onChange={(event) => update({ departmentId: event.target.value })}>
            <option value="">{t('common.all')}</option>
            {(departments.data?.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
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
          {type ? (
            <span className="flex flex-wrap gap-2 sm:ml-auto">
              {EXPORT_FORMATS.map((format) => (
                <Button
                  key={format}
                  size="sm"
                  variant="outline"
                  loading={exportReport.isPending && exportReport.variables === format}
                  onClick={() => exportReport.mutate(format)}
                >
                  <Download className="size-3.5" aria-hidden />
                  {format.toUpperCase()}
                </Button>
              ))}
            </span>
          ) : null}
        </FilterBar>

        {!type ? (
          <Card>
            <EmptyState icon={BarChart3} title={t('reports.pickReport')} description={t('reports.pickReportHint')} />
          </Card>
        ) : (
          <Card>
            <QueryBoundary query={result} isEmpty={(data) => data.rows.length === 0} empty={<EmptyState title={t('reports.noData')} />}>
              {(data) => (
                <>
                  {selected ? (
                    <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{selected.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{selected.description}</p>
                    </div>
                  ) : null}
                  {data.summary && Object.keys(data.summary).length > 0 ? (
                    <SectionCard title={t('reports.summary')}>
                      <DefinitionList
                        className="sm:grid-cols-3"
                        items={Object.entries(data.summary).map(([key, value]) => ({ label: key, value: String(value) }))}
                      />
                    </SectionCard>
                  ) : null}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {data.columns.map((column) => (
                          <TableHead key={column.key}>{column.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row, index) => (
                        <TableRow key={index}>
                          {data.columns.map((column) => (
                            <TableCell key={column.key}>{row[column.key] ?? '—'}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {data.meta ? (
                    <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPageChange={setPage} />
                  ) : null}
                </>
              )}
            </QueryBoundary>
          </Card>
        )}
      </div>
    </div>
  );
}

function SavedTab() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const describeError = useApiErrorText();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SavedReportItem | null>(null);
  const [lastResult, setLastResult] = useState<{ name: string; result: ReportResult } | null>(null);

  const catalog = useQuery({ queryKey: ['reports', 'catalog'], queryFn: () => api.get<{ types: ReportCatalogEntry[] }>('/reports/catalog') });
  const list = useQuery({
    queryKey: ['reports', 'saved', page],
    queryFn: () => api.get<Paginated<SavedReportItem>>('/reports/saved', { query: { page, pageSize: 10 } }),
  });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(160),
        type: z.string().min(1, t('common.required')),
        format: z.string().min(1, t('common.required')),
        scheduleFrequency: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/reports/saved', {
        name: values.name,
        type: values.type,
        format: values.format,
        scheduleFrequency: values.scheduleFrequency || undefined,
        filters: {
          ...(values.from ? { from: values.from } : {}),
          ...(values.to ? { to: values.to } : {}),
        },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] }),
  });

  const run = useMutation({
    mutationFn: (report: SavedReportItem) => api.post<ReportResult>(`/reports/saved/${report.id}/run`, {}),
    onSuccess: (result, report) => {
      setLastResult({ name: report.name, result });
      toast.success(t('reports.ran'));
      void queryClient.invalidateQueries({ queryKey: ['reports', 'runs'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/saved/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <div className="space-y-4">
      {can('reports.manage') ? (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('reports.newSavedReport')}
          </Button>
        </div>
      ) : null}

      <Card>
        <QueryBoundary query={list} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('reports.noSaved')} description={t('reports.noSavedHint')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.name')}</TableHead>
                    <TableHead>{t('reports.type')}</TableHead>
                    <TableHead>{t('reports.format')}</TableHead>
                    <TableHead>{t('reports.schedule')}</TableHead>
                    <TableHead>{t('reports.lastRunAt')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">{report.name}</TableCell>
                      <TableCell>{report.type}</TableCell>
                      <TableCell>{report.format}</TableCell>
                      <TableCell>{report.scheduleFrequency ?? '—'}</TableCell>
                      <TableCell>{formatDateTime(report.lastRunAt)}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex gap-2">
                          <Button size="sm" variant="outline" loading={run.isPending && run.variables?.id === report.id} onClick={() => run.mutate(report)}>
                            <Play className="size-3.5" aria-hidden />
                            {t('reports.run')}
                          </Button>
                          {can('reports.manage') ? (
                            <Button size="sm" variant="ghost" onClick={() => setToDelete(report)}>
                              {t('common.delete')}
                            </Button>
                          ) : null}
                        </span>
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

      {lastResult ? (
        <Card>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{lastResult.name}</h3>
            <Button size="sm" variant="ghost" onClick={() => setLastResult(null)}>
              {t('common.close')}
            </Button>
          </div>
          {lastResult.result.rows.length === 0 ? (
            <EmptyState title={t('reports.noData')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {lastResult.result.columns.map((column) => (
                    <TableHead key={column.key}>{column.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastResult.result.rows.slice(0, 25).map((row, index) => (
                  <TableRow key={index}>
                    {lastResult.result.columns.map((column) => (
                      <TableCell key={column.key}>{row[column.key] ?? '—'}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      <FormDialog<FormValues>
        open={open}
        onOpenChange={setOpen}
        title={t('reports.newSavedReport')}
        schema={schema}
        defaultValues={{ name: '', type: 'EMPLOYEES', format: 'CSV', scheduleFrequency: '', from: '', to: '' }}
        onSubmit={(values) => create.mutateAsync(values)}
        submitLabel={t('common.create')}
      >
        {(form) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('reports.name')} htmlFor="saved-name" error={form.formState.errors.name?.message}>
                <Input id="saved-name" {...form.register('name')} />
              </FormField>
              <FormField label={t('reports.type')} htmlFor="saved-type" error={form.formState.errors.type?.message}>
                <Select id="saved-type" {...form.register('type')}>
                  {(catalog.data?.types ?? []).map((entry) => (
                    <option key={entry.type} value={entry.type}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('reports.format')} htmlFor="saved-format">
                <Select id="saved-format" {...form.register('format')}>
                  {EXPORT_FORMATS.map((format) => (
                    <option key={format} value={format.toUpperCase()}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('reports.schedule')} htmlFor="saved-schedule" hint={t('reports.scheduleHint')}>
                <Select id="saved-schedule" {...form.register('scheduleFrequency')}>
                  <option value="">{t('reports.noSchedule')}</option>
                  {SCHEDULE_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {t(`reports.frequency.${frequency}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('common.from')} htmlFor="saved-from">
                <Input id="saved-from" type="date" {...form.register('from')} />
              </FormField>
              <FormField label={t('common.to')} htmlFor="saved-to">
                <Input id="saved-to" type="date" {...form.register('to')} />
              </FormField>
            </div>
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(value) => (!value ? setToDelete(null) : undefined)}
        title={t('reports.deleteSaved')}
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

function RunsTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const runs = useQuery({
    queryKey: ['reports', 'runs', page],
    queryFn: () => api.get<Paginated<ReportRunItem>>('/reports/runs', { query: { page, pageSize: 10 } }),
  });

  return (
    <Card>
      <QueryBoundary query={runs} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('reports.noRuns')} />}>
        {(data) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.type')}</TableHead>
                  <TableHead>{t('reports.reference')}</TableHead>
                  <TableHead>{t('reports.format')}</TableHead>
                  <TableHead>{t('reports.rows')}</TableHead>
                  <TableHead>{t('reports.startedAt')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((runItem) => (
                  <TableRow key={runItem.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{runItem.type}</TableCell>
                    <TableCell>{runItem.savedReport?.name ?? '—'}</TableCell>
                    <TableCell>{runItem.format}</TableCell>
                    <TableCell className="tabular-nums">{runItem.rowCount ?? '—'}</TableCell>
                    <TableCell>{formatDateTime(runItem.createdAt)}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(runItem.status)}>{t(`reports.runStatus.${runItem.status}`, { defaultValue: runItem.status })}</Badge>
                      {runItem.error ? <span className="block text-xs text-rose-600">{runItem.error}</span> : null}
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
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();

  const tabs = [
    { value: 'catalog', label: t('reports.catalog'), permission: 'reports.view' },
    { value: 'saved', label: t('reports.saved'), permission: 'reports.view' },
    { value: 'runs', label: t('reports.runs'), permission: 'reports.view' },
  ].filter((tab) => can(tab.permission));

  const activeTab = params.get('tab') ?? 'catalog';
  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : tabs[0]?.value ?? 'catalog';

  return (
    <div className="space-y-6">
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="catalog">{current === 'catalog' ? <CatalogTab /> : null}</TabsContent>
        <TabsContent value="saved">{current === 'saved' ? <SavedTab /> : null}</TabsContent>
        <TabsContent value="runs">{current === 'runs' ? <RunsTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
