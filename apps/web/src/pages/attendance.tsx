import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coffee, LogIn, LogOut, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '../lib/api.js';
import { formatDate, formatMinutes, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  AttendanceEntryItem,
  AttendanceSummary,
  EmployeeListItem,
  MissingPunchRow,
  NamedRef,
} from '../components/feature/api-types.js';
import { CorrectionsTab } from '../components/feature/attendance/corrections-tab.js';
import { QueryBoundary } from '../components/feature/query.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle, StatCard } from '../components/ui/card.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Input, Select } from '../components/ui/input.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

function weekRange(): { from: string; to: string } {
  const today = new Date();
  const day = (today.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - day));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: toDateInputValue(monday), to: toDateInputValue(sunday) };
}

function LiveTimer({ entry }: { entry: AttendanceEntryItem | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!entry?.clockIn) return <p className="text-3xl font-semibold tabular-nums text-slate-400">--:--:--</p>;

  const clockIn = new Date(entry.clockIn).getTime();
  const clockOut = entry.clockOut ? new Date(entry.clockOut).getTime() : now;
  const breakMs = (entry.breakMinutes ?? 0) * 60_000;
  const elapsed = Math.max(0, clockOut - clockIn - breakMs);
  const hours = Math.floor(elapsed / 3_600_000);
  const minutes = Math.floor((elapsed % 3_600_000) / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  const openBreak = (entry.breaks ?? []).some((item) => !item.endedAt);

  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {t('attendance.since', { time: new Date(entry.clockIn).toLocaleTimeString() })}
        {openBreak ? ` · ${t('attendance.onBreak')}` : ''}
      </p>
    </div>
  );
}

function ClockCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const today = useQuery({ queryKey: ['attendance', 'today'], queryFn: () => api.get<AttendanceEntryItem | null>('/attendance/today'), refetchInterval: 60_000 });

  const action = useMutation({
    mutationFn: ({ path }: { path: 'clock-in' | 'clock-out' | 'breaks/start' | 'breaks/end' }) => {
      const body = { source: 'WEB' };
      if (path === 'clock-in') return api.post('/attendance/clock-in', body);
      if (path === 'clock-out') return api.post('/attendance/clock-out', body);
      if (path === 'breaks/start') return api.post('/attendance/breaks/start', body);
      return api.post('/attendance/breaks/end', body);
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  const entry = today.data ?? null;
  const openBreak = (entry?.breaks ?? []).some((item) => !item.endedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('attendance.today')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <QueryBoundary
          query={today}
          isEmpty={() => false}
          skeleton={<TableSkeleton rows={2} columns={2} />}
        >
          {(data) => (
            <>
              <LiveTimer entry={data} />
              <div className="flex flex-wrap gap-2">
                {!data?.clockIn ? (
                  <Button onClick={() => action.mutate({ path: 'clock-in' })} loading={action.isPending}>
                    <LogIn className="size-4" aria-hidden />
                    {t('attendance.clockIn')}
                  </Button>
                ) : null}
                {data?.clockIn && !data.clockOut ? (
                  <Button onClick={() => action.mutate({ path: 'clock-out' })} loading={action.isPending}>
                    <LogOut className="size-4" aria-hidden />
                    {t('attendance.clockOut')}
                  </Button>
                ) : null}
                {data?.clockIn && !data.clockOut ? (
                  openBreak ? (
                    <Button variant="outline" onClick={() => action.mutate({ path: 'breaks/end' })} loading={action.isPending}>
                      <Square className="size-4" aria-hidden />
                      {t('attendance.endBreak')}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => action.mutate({ path: 'breaks/start' })} loading={action.isPending}>
                      <Coffee className="size-4" aria-hidden />
                      {t('attendance.startBreak')}
                    </Button>
                  )
                ) : null}
                {data?.clockOut ? <Badge tone="success">{t('attendance.dayClosed')}</Badge> : null}
              </div>
              {data ? (
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('attendance.worked')}</dt>
                    <dd className="font-medium">{formatMinutes(data.workedMinutes ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('attendance.overtime')}</dt>
                    <dd className="font-medium">{formatMinutes(data.overtimeMinutes)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('attendance.late')}</dt>
                    <dd className="font-medium">{formatMinutes(data.lateMinutes)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-slate-500">{t('common.status')}</dt>
                    <dd>
                      <Badge tone={statusTone(data.status)}>{t(`attendance.status.${data.status}`, { defaultValue: data.status })}</Badge>
                    </dd>
                  </div>
                </dl>
              ) : null}
            </>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function WeeklySummary() {
  const { t } = useTranslation();
  const range = weekRange();
  const summary = useQuery({
    queryKey: ['attendance', 'summary', range.from, range.to],
    queryFn: () => api.get<AttendanceSummary>('/attendance/summary', { query: { from: range.from, to: range.to } }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('attendance.weeklySummary')} · {formatDate(range.from)} – {formatDate(range.to)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={summary} skeleton={<TableSkeleton rows={2} columns={4} />}>
          {(data) => (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('attendance.worked')} value={formatMinutes(data.totals.workedMinutes)} />
              <StatCard label={t('attendance.overtime')} value={formatMinutes(data.totals.overtimeMinutes)} tone={data.totals.overtimeMinutes > 0 ? 'warning' : 'default'} />
              <StatCard label={t('attendance.late')} value={data.totals.lateDays} tone={data.totals.lateDays > 0 ? 'warning' : 'default'} />
              <StatCard label={t('attendance.missingPunches')} value={data.totals.missingPunches} tone={data.totals.missingPunches > 0 ? 'danger' : 'default'} />
            </div>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function MyEntries() {
  const { t } = useTranslation();
  const range = weekRange();
  const entries = useQuery({
    queryKey: ['attendance', 'entries', range.from, range.to],
    queryFn: () => api.get<Paginated<AttendanceEntryItem>>('/attendance', { query: { from: range.from, to: range.to, pageSize: 50 } }),
  });

  return (
    <Card>
      <QueryBoundary query={entries} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('attendance.noEntries')} />}>
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('attendance.date')}</TableHead>
                <TableHead>{t('attendance.clockIn')}</TableHead>
                <TableHead>{t('attendance.clockOut')}</TableHead>
                <TableHead>{t('attendance.worked')}</TableHead>
                <TableHead>{t('attendance.overtime')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell>{entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString() : '—'}</TableCell>
                  <TableCell>{entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString() : '—'}</TableCell>
                  <TableCell>{formatMinutes(entry.workedMinutes ?? 0)}</TableCell>
                  <TableCell>{formatMinutes(entry.overtimeMinutes)}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone(entry.status)}>{t(`attendance.status.${entry.status}`, { defaultValue: entry.status })}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryBoundary>
    </Card>
  );
}

export function AttendancePage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('tab') ?? 'today';

  const tabs = [
    { value: 'today', label: t('attendance.today') },
    { value: 'records', label: t('attendance.records'), permission: 'attendance.view' },
    { value: 'missing', label: t('attendance.missingPunches'), permission: 'attendance.view' },
    { value: 'corrections', label: t('attendance.corrections') },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'today';

  return (
    <div className="space-y-6">
      <PageHeader title={t('attendance.title')} description={t('attendance.subtitle')} />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="today" className="space-y-4">
          {current === 'today' ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <ClockCard />
                <WeeklySummary />
              </div>
              <MyEntries />
            </>
          ) : null}
        </TabsContent>
        <TabsContent value="records">{current === 'records' ? <RecordsTab /> : null}</TabsContent>
        <TabsContent value="missing">{current === 'missing' ? <MissingPunchesTab /> : null}</TabsContent>
        <TabsContent value="corrections">{current === 'corrections' ? <CorrectionsTab /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}

const STATUS_OPTIONS = ['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'REMOTE', 'LEAVE', 'HOLIDAY'] as const;

function RecordsTab() {
  const { t } = useTranslation();
  const defaultRange = weekRange();
  const [filters, setFilters] = useState({ from: defaultRange.from, to: defaultRange.to, employeeId: '', departmentId: '', status: '' });
  const [page, setPage] = useState(1);

  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });
  const departments = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: () => api.get<Paginated<NamedRef>>('/departments', { query: { pageSize: 100 } }),
    staleTime: 5 * 60_000,
  });
  const records = useQuery({
    queryKey: ['attendance', 'records', { ...filters, page }],
    queryFn: () =>
      api.get<Paginated<AttendanceEntryItem>>('/attendance', {
        query: {
          page,
          pageSize: 10,
          from: filters.from || undefined,
          to: filters.to || undefined,
          employeeId: filters.employeeId || undefined,
          departmentId: filters.departmentId || undefined,
          status: filters.status || undefined,
        },
      }),
  });

  const update = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input aria-label={t('common.from')} type="date" className="sm:w-40" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
        <Input aria-label={t('common.to')} type="date" className="sm:w-40" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
        <Select aria-label={t('attendance.employee')} className="sm:w-56" value={filters.employeeId} onChange={(event) => update({ employeeId: event.target.value })}>
          <option value="">{t('attendance.allEmployees')}</option>
          {(employees.data?.data ?? []).map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.firstName} {employee.lastName}
            </option>
          ))}
        </Select>
        <Select aria-label={t('people.department')} className="sm:w-48" value={filters.departmentId} onChange={(event) => update({ departmentId: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {(departments.data?.data ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('common.status')} className="sm:w-40" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">{t('common.all')}</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {t(`attendance.status.${status}`)}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        <QueryBoundary query={records} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('attendance.noEntries')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('attendance.employee')}</TableHead>
                    <TableHead>{t('attendance.date')}</TableHead>
                    <TableHead>{t('attendance.clockIn')}</TableHead>
                    <TableHead>{t('attendance.clockOut')}</TableHead>
                    <TableHead>{t('attendance.worked')}</TableHead>
                    <TableHead>{t('attendance.overtime')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        {entry.employee ? `${entry.employee.firstName} ${entry.employee.lastName}` : '—'}
                        {entry.employee?.department ? <span className="block text-xs text-slate-500">{entry.employee.department.name}</span> : null}
                      </TableCell>
                      <TableCell>{formatDate(entry.date)}</TableCell>
                      <TableCell>{entry.clockIn ? new Date(entry.clockIn).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell>{entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell>{formatMinutes(entry.workedMinutes ?? 0)}</TableCell>
                      <TableCell>{formatMinutes(entry.overtimeMinutes)}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(entry.status)}>{t(`attendance.status.${entry.status}`, { defaultValue: entry.status })}</Badge>
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
    </div>
  );
}

function MissingPunchesTab() {
  const { t } = useTranslation();
  const defaultRange = weekRange();
  const [range, setRange] = useState(defaultRange);
  const [page, setPage] = useState(1);

  const missing = useQuery({
    queryKey: ['attendance', 'missing', range, page],
    queryFn: () => api.get<Paginated<MissingPunchRow>>('/attendance/missing-punches', { query: { from: range.from, to: range.to, page, pageSize: 10 } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label={t('common.from')}
          type="date"
          className="sm:w-40"
          value={range.from}
          onChange={(event) => {
            setRange((current) => ({ ...current, from: event.target.value }));
            setPage(1);
          }}
        />
        <Input
          aria-label={t('common.to')}
          type="date"
          className="sm:w-40"
          value={range.to}
          onChange={(event) => {
            setRange((current) => ({ ...current, to: event.target.value }));
            setPage(1);
          }}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('attendance.missingRangeHint')}</p>
      </div>
      <Card>
        <QueryBoundary query={missing} isEmpty={(data) => data.data.length === 0} empty={<EmptyState title={t('attendance.noMissingPunches')} />}>
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('attendance.employee')}</TableHead>
                    <TableHead>{t('people.department')}</TableHead>
                    <TableHead>{t('attendance.date')}</TableHead>
                    <TableHead>{t('attendance.type')}</TableHead>
                    <TableHead>{t('attendance.clockIn')}</TableHead>
                    <TableHead>{t('attendance.clockOut')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((row) => (
                    <TableRow key={`${row.employeeId}-${row.date}-${row.type}`}>
                      <TableCell>
                        {row.employeeName}
                        <span className="block text-xs text-slate-500">{row.employeeNumber}</span>
                      </TableCell>
                      <TableCell>{row.department?.name ?? '—'}</TableCell>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell>
                        <Badge tone={row.type === 'ABSENT' ? 'danger' : 'warning'}>
                          {t(`attendance.missingType.${row.type}`, { defaultValue: row.type })}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.clockIn ? new Date(row.clockIn).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell>{row.clockOut ? new Date(row.clockOut).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Play className="size-3" aria-hidden />
                          {t('attendance.useCorrections')}
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
    </div>
  );
}
