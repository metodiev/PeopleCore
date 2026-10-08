import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, Download, FileText, Mail, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, formatMinutes } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  DocumentDownload,
  DocumentItem,
  EmployeeProfile,
  LeaveBalanceYear,
  AttendanceEntryItem,
  LeaveRequestItem,
} from '../components/feature/api-types.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { ProfileSubResources } from '../components/feature/employee/profile-sub-resources.js';
import { NotificationPreferencesPanel } from '../components/feature/settings/notification-preferences.js';
import { DefinitionList, ProgressBar, SectionCard } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, StatCard } from '../components/ui/card.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Select } from '../components/ui/input.js';
import { Avatar, PageHeader } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';

interface MyDashboard {
  attendanceToday?: AttendanceEntryItem | null;
  weekWorkedMinutes?: number;
  weekOvertimeMinutes?: number;
  weekLateCount?: number;
  balances?: Array<{ leaveType: string; remaining: number }>;
  upcomingLeave?: LeaveRequestItem[];
  pendingRequests?: number;
}

export function ProfilePage() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const user = useAuth((state) => state.user);
  const can = useAuth((state) => state.can);
  const [year, setYear] = useState(new Date().getFullYear());

  const profile = useQuery({ queryKey: ['employees', 'me'], queryFn: () => api.get<EmployeeProfile>('/employees/me') });
  const dashboard = useQuery({ queryKey: ['dashboard', 'me'], queryFn: () => api.get<MyDashboard>('/dashboard/me') });
  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me', year],
    queryFn: () => api.get<LeaveBalanceYear>('/leave/balances/me', { query: { year } }),
  });
  const documents = useQuery({
    queryKey: ['documents', 'mine'],
    queryFn: () => api.get<Paginated<DocumentItem>>('/documents', { query: { pageSize: 5, sortBy: 'createdAt', sortDir: 'desc' } }),
  });

  const download = useMutation({
    mutationFn: (id: string) => api.get<DocumentDownload>(`/documents/${id}/download`),
    onSuccess: (payload) => window.open(payload.url, '_blank', 'noopener'),
    onError: (error) => toast.error(describeError(error)),
  });

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />

      <QueryBoundary query={profile} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={4} />}>
        {(data) => (
          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Avatar firstName={data.firstName} lastName={data.lastName} src={data.photoUrl} className="size-16 text-lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  {data.firstName} {data.lastName}
                  {data.preferredName ? <span className="text-slate-400"> ({data.preferredName})</span> : null}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {data.position?.title ?? '—'} · {data.department?.name ?? '—'} · {t('people.employeeNumber')}: {data.employeeNumber}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(data.status)}>{t(`people.status.${data.status}`, { defaultValue: data.status })}</Badge>
                  <Badge tone="neutral">{t(`people.employmentType.${data.employmentType}`, { defaultValue: data.employmentType })}</Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <Mail className="size-3.5" aria-hidden />
                    {data.workEmail}
                  </span>
                  {data.phone ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      <Phone className="size-3.5" aria-hidden />
                      {data.phone}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/people/${data.id}`} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {t('profile.openEmployeeFile')}
                </Link>
              </div>
            </div>
          </Card>
        )}
      </QueryBoundary>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <QueryBoundary query={dashboard} isEmpty={() => false} skeleton={<TableSkeleton rows={2} columns={2} />}>
          {(data) => (
            <>
              <StatCard label={t('dashboard.hoursWorked')} value={formatMinutes(data.weekWorkedMinutes ?? 0)} icon={<Clock className="size-5" />} />
              <StatCard label={t('dashboard.upcomingLeave')} value={(data.upcomingLeave ?? []).length} icon={<CalendarDays className="size-5" />} />
              <StatCard label={t('dashboard.pendingRequests')} value={data.pendingRequests ?? 0} tone={(data.pendingRequests ?? 0) > 0 ? 'warning' : 'default'} icon={<FileText className="size-5" />} />
              <StatCard label={t('profile.weekOvertime')} value={formatMinutes(data.weekOvertimeMinutes ?? 0)} tone={(data.weekOvertimeMinutes ?? 0) > 0 ? 'warning' : 'default'} />
            </>
          )}
        </QueryBoundary>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <QueryBoundary query={profile} isEmpty={() => false} skeleton={<TableSkeleton rows={5} columns={2} />}>
          {(data) => (
            <SectionCard title={t('profile.personal')} description={t('profile.personalHint')}>
              <DefinitionList
                items={[
                  { label: t('profile.birthDate'), value: formatDate(data.birthDate) },
                  { label: t('profile.gender'), value: data.gender ? t(`people.gender.${data.gender}`, { defaultValue: data.gender }) : '—' },
                  { label: t('profile.city'), value: data.city ?? '—' },
                  { label: t('profile.country'), value: data.country ?? '—' },
                  { label: t('profile.personalEmail'), value: data.personalEmail ?? '—' },
                  { label: t('profile.address'), value: data.address ?? '—' },
                ]}
              />
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('profile.requestChangeHint')}</p>
              <Link to="/requests?tab=mine" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                {t('profile.requestChange')}
              </Link>
            </SectionCard>
          )}
        </QueryBoundary>

        <SectionCard
          title={t('leave.balances')}
          action={
            <Select aria-label={t('profile.year')} className="w-28" value={String(year)} onChange={(event) => setYear(Number(event.target.value))}>
              {[currentYear - 1, currentYear, currentYear + 1].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          }
        >
          <QueryBoundary
            query={balances}
            isEmpty={(data) => data.balances.length === 0}
            empty={<EmptyState icon={CalendarDays} title={t('leave.noBalances')} />}
            skeleton={<TableSkeleton rows={3} columns={2} />}
          >
            {(data) => (
              <div className="space-y-4">
                {data.balances.map((balance) => (
                  <div key={balance.leaveTypeId}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{balance.leaveType}</span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">
                        {balance.remaining} / {balance.available} {t('leave.days')}
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={balance.used + balance.pending} max={Math.max(1, balance.available)} />
                    </div>
                  </div>
                ))}
                <Link
                  to="/leave?tab=request"
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {t('leave.request')}
                </Link>
              </div>
            )}
          </QueryBoundary>
        </SectionCard>
      </div>

      <SectionCard title={t('employeeProfile.title')} description={t('employeeProfile.selfHint')}>
        <QueryBoundary query={profile} isEmpty={() => false} skeleton={<TableSkeleton rows={4} columns={2} />}>
          {(data) => <ProfileSubResources employeeId={data.id} allowEdit={can('employees.edit')} />}
        </QueryBoundary>
      </SectionCard>

      <SectionCard
        title={t('profile.myDocuments')}
        action={
          <Link to="/documents" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('profile.allDocuments')}
          </Link>
        }
      >
        <QueryBoundary
          query={documents}
          isEmpty={(data) => data.data.length === 0}
          empty={<EmptyState icon={FileText} title={t('documents.noDocuments')} />}
          skeleton={<TableSkeleton rows={3} columns={3} />}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('documents.name')}</TableHead>
                  <TableHead>{t('documents.category')}</TableHead>
                  <TableHead>{t('documents.expiresAt')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{document.name}</TableCell>
                    <TableCell>{document.category?.name ?? '—'}</TableCell>
                    <TableCell>{formatDate(document.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" loading={download.isPending && download.variables === document.id} onClick={() => download.mutate(document.id)}>
                        <Download className="size-3.5" aria-hidden />
                        {t('documents.download')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </SectionCard>

      <SectionCard title={t('notifications.preferences')} description={t('notifications.preferencesHint')}>
        <NotificationPreferencesPanel />
      </SectionCard>

      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <UserRound className="size-4" aria-hidden />
          {t('profile.account')}
        </h3>
        <CardContent className="mt-2 p-0">
          <DefinitionList
            items={[
              { label: t('auth.email'), value: user?.email ?? '—' },
              { label: t('profile.mfaEnabled'), value: user?.mfaEnabled ? t('common.yes') : t('common.no') },
              { label: t('profile.emailVerified'), value: user?.emailVerified ? t('common.yes') : t('common.no') },
              { label: t('profile.locale'), value: user?.locale ?? '—' },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
