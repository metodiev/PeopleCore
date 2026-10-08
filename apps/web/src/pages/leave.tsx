import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type Paginated } from '../lib/api.js';
import { formatDate } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { LeaveBalanceItem, LeaveRequestItem } from '../components/feature/api-types.js';
import { LeaveApprovalsTab } from '../components/feature/leave/approvals-tab.js';
import { LeaveCalendarTab } from '../components/feature/leave/calendar-tab.js';
import { RequestLeaveDialog, type LeaveRequestValues } from '../components/feature/leave/request-dialog.js';
import { LeaveSettingsTabs } from '../components/feature/leave/settings-tabs.js';
import { QueryBoundary } from '../components/feature/query.js';
import { ProgressBar } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { ConfirmDialog } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { PageHeader, Pagination } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';

interface BalanceResponse {
  year: number;
  balances: LeaveBalanceItem[];
}

function BalanceCards({ balances, year }: { balances: LeaveBalanceItem[]; year: number }) {
  const { t } = useTranslation();
  if (balances.length === 0) {
    return <EmptyState title={t('leave.noBalances')} description={t('leave.noBalancesHint', { year })} />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {balances.map((balance) => (
        <Card key={balance.leaveTypeId} className="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: balance.color ?? '#64748b' }} aria-hidden />
              {balance.leaveType}
            </p>
            <Badge tone="brand">{t('leave.remainingDays', { count: balance.remaining })}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('leave.available')}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{balance.available}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('leave.used')}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{balance.used}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('leave.pending')}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{balance.pending}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t('leave.accrued')}</dt>
              <dd className="mt-1 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{balance.accrued}</dd>
            </div>
          </dl>
          <div className="mt-3 space-y-1">
            <ProgressBar value={balance.used + balance.pending} max={Math.max(1, balance.available)} tone={balance.remaining < 0 ? 'danger' : 'brand'} />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('leave.usageHint', { used: balance.used + balance.pending, available: balance.available })}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MyRequestsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const employeeId = useAuth((state) => state.employeeId);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toCancel, setToCancel] = useState<LeaveRequestItem | null>(null);

  const requests = useQuery({
    queryKey: ['leave', 'requests', 'me', employeeId, page],
    queryFn: () =>
      api.get<Paginated<LeaveRequestItem>>('/leave/requests', {
        query: { employeeId: employeeId ?? undefined, page, pageSize: 10 },
      }),
    enabled: Boolean(employeeId),
  });

  const create = useMutation({
    mutationFn: (values: LeaveRequestValues) => api.post('/leave/requests', { ...values, employeeId: employeeId ?? undefined }),
    onSuccess: () => {
      toast.success(t('leave.requestSubmitted'));
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/leave/requests/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success(t('leave.requestCancelled'));
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      setToCancel(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)} disabled={!employeeId}>
          <Plus className="size-4" aria-hidden />
          {t('leave.newRequest')}
        </Button>
      </div>
      <Card>
        <QueryBoundary
          query={requests}
          isEmpty={(data) => data.data.length === 0}
          empty={
            <EmptyState
              title={t('leave.noRequests')}
              description={t('leave.noRequestsHint')}
              action={<Button onClick={() => setDialogOpen(true)}>{t('leave.newRequest')}</Button>}
            />
          }
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('leave.leaveType')}</TableHead>
                    <TableHead>{t('leave.period')}</TableHead>
                    <TableHead>{t('leave.days')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('leave.requestedOn')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>{request.leaveType?.name}</TableCell>
                      <TableCell>
                        {formatDate(request.startDate)} – {formatDate(request.endDate)}
                        {request.startHalfDay || request.endHalfDay ? <span className="ml-1 text-xs text-slate-500">½</span> : null}
                      </TableCell>
                      <TableCell>{request.daysRequested}</TableCell>
                      <TableCell>
                        <Badge tone={statusTone(request.status)}>{t(`leave.status.${request.status}`, { defaultValue: request.status })}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {['PENDING', 'APPROVED'].includes(request.status) ? (
                          <Button size="sm" variant="outline" onClick={() => setToCancel(request)}>
                            {t('leave.cancelRequest')}
                          </Button>
                        ) : (
                          '—'
                        )}
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

      <RequestLeaveDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={(values) => create.mutateAsync(values)} />
      <ConfirmDialog
        open={toCancel !== null}
        onOpenChange={(open) => (open ? undefined : setToCancel(null))}
        title={t('leave.cancelRequest')}
        description={toCancel ? `${toCancel.leaveType?.name ?? ''} · ${formatDate(toCancel.startDate)} – ${formatDate(toCancel.endDate)}` : undefined}
        confirmLabel={t('leave.cancelRequest')}
        destructive
        loading={cancel.isPending}
        onConfirm={() => (toCancel ? cancel.mutate(toCancel.id) : undefined)}
      />
    </div>
  );
}

export function LeavePage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [params, setParams] = useSearchParams();
  const year = new Date().getUTCFullYear();
  const activeTab = params.get('tab') ?? 'balances';

  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me', year],
    queryFn: () => api.get<BalanceResponse>('/leave/balances/me', { query: { year } }),
  });

  const tabs = [
    { value: 'balances', label: t('leave.myBalances'), render: () => (
      <QueryBoundary query={balances} skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><TableSkeleton rows={3} columns={2} /><TableSkeleton rows={3} columns={2} /><TableSkeleton rows={3} columns={2} /></div>}>
        {(data) => <BalanceCards balances={data.balances ?? []} year={data.year ?? year} />}
      </QueryBoundary>
    ) },
    { value: 'requests', label: t('leave.myRequests'), render: () => <MyRequestsTab /> },
    { value: 'approvals', label: t('leave.approvals'), permission: 'leave.approve', render: () => <LeaveApprovalsTab /> },
    { value: 'team', label: t('leave.teamCalendar'), permission: 'calendar.view', render: () => <LeaveCalendarTab /> },
    { value: 'settings', label: t('leave.settings'), permission: 'leave.manage', render: () => <LeaveSettingsTabs /> },
  ].filter((tab) => !tab.permission || can(tab.permission));

  const current = tabs.some((tab) => tab.value === activeTab) ? activeTab : 'balances';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('leave.title')}
        description={t('leave.subtitle')}
        actions={
          <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <CalendarDays className="size-4" aria-hidden />
            {year}
          </span>
        }
      />
      <Tabs value={current} onValueChange={(value) => setParams({ tab: value }, { replace: true })} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {current === tab.value ? tab.render() : null}
          </TabsContent>
        ))}
      </Tabs>
      {!can('leave.self.view') ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('common.noPermission')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-500 dark:text-slate-400">{t('leave.noSelfAccess')}</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
