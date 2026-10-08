import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Cake, CalendarDays, Clock, FileText, Timer, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatDate, formatMinutes } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type {
  AttendanceEntryItem,
  CalendarEventItem,
  EmployeeListItem,
  ExpiringItem,
  LeaveBalanceItem,
  LeaveRequestItem,
} from '../components/feature/api-types.js';
import { AreaPanel, BarPanel } from '../components/feature/charts.js';
import { QueryBoundary } from '../components/feature/query.js';
import { PageSection } from '../components/feature/page-section.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle, StatCard } from '../components/ui/card.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { PageHeader } from '../components/ui/misc.js';

interface DashboardMe {
  attendanceToday?: AttendanceEntryItem | null;
  weekWorkedMinutes?: number;
  weekOvertimeMinutes?: number;
  weekLateCount?: number;
  balances?: LeaveBalanceItem[];
  upcomingLeave?: LeaveRequestItem[];
  upcomingEvents?: CalendarEventItem[];
  pendingRequests?: number;
}

interface DashboardManager {
  pendingLeaveApprovals?: number;
  pendingExpenseApprovals?: number;
  pendingCorrections?: number;
  teamSize?: number;
  todayAttendance?: { present?: number; absent?: number; remote?: number; onLeave?: number };
  teamOnLeave?: LeaveRequestItem[];
  teamMembers?: EmployeeListItem[];
}

interface DashboardHr {
  headcount?: { total?: number; active?: number; probation?: number; onLeave?: number; newHires30d?: number };
  headcountByDepartment?: Array<{ department: string; count: number }>;
  attendanceTrend?: Array<{ label: string; present: number; late?: number; absent?: number; leave?: number }>;
  leaveTrend?: Array<{ label: string; days?: number; requests?: number }>;
  upcomingBirthdays?: Array<{ id: string; firstName: string; lastName: string; date: string }>;
  expiringContracts?: ExpiringItem[];
  openRequests?: number;
}

interface DashboardAdmin {
  users?: number;
  employees?: number;
  departments?: number;
  locations?: number;
  teams?: number;
  pendingInvites?: number;
}

const num = (value: number | undefined | null): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const can = useAuth((state) => state.can);

  const showManager = can('leave.approve');
  const showHr = can('employees.edit') || can('leave.manage');
  const showAdmin = can('settings.manage');

  const me = useQuery({ queryKey: ['dashboard', 'me'], queryFn: () => api.get<DashboardMe>('/dashboard/me') });
  const manager = useQuery({
    queryKey: ['dashboard', 'manager'],
    queryFn: () => api.get<DashboardManager>('/dashboard/manager'),
    enabled: showManager,
  });
  const hr = useQuery({
    queryKey: ['dashboard', 'hr'],
    queryFn: () => api.get<DashboardHr>('/dashboard/hr'),
    enabled: showHr,
  });
  const admin = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => api.get<DashboardAdmin>('/dashboard/admin'),
    enabled: showAdmin,
  });

  const remainingLeave = (me.data?.balances ?? []).reduce((sum, balance) => sum + num(balance.remaining), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: user?.firstName ?? '' })}
        actions={
          <Link to="/attendance" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('dashboard.goToAttendance')}
          </Link>
        }
      />

      <QueryBoundary
        query={me}
        skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <TableSkeleton key={index} rows={2} columns={2} />)}</div>}
      >
        {(data) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('dashboard.hoursWorked')}
              value={formatMinutes(data.weekWorkedMinutes ?? 0)}
              hint={t('dashboard.overtimeHint', { value: formatMinutes(data.weekOvertimeMinutes ?? 0) })}
              icon={<Clock className="size-5" />}
            />
            <StatCard
              label={t('dashboard.remainingLeave')}
              value={remainingLeave.toFixed(1)}
              hint={t('dashboard.daysUnit')}
              icon={<CalendarDays className="size-5" />}
            />
            <StatCard
              label={t('dashboard.upcomingLeave')}
              value={num(data.upcomingLeave?.length)}
              icon={<CalendarDays className="size-5" />}
            />
            <StatCard
              label={t('dashboard.pendingRequests')}
              value={num(data.pendingRequests)}
              tone={num(data.pendingRequests) > 0 ? 'warning' : 'default'}
              icon={<FileText className="size-5" />}
            />
          </div>
        )}
      </QueryBoundary>

      <div className="grid gap-4 lg:grid-cols-2">
        <QueryBoundary query={me} skeleton={<TableSkeleton rows={3} columns={2} />}>
          {(data) => (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{t('dashboard.todaySchedule')}</CardTitle>
                <Link to="/attendance" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
                  {t('dashboard.open')}
                </Link>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data.attendanceToday ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase text-slate-500">{t('attendance.clockIn')}</p>
                      <p className="font-medium">{data.attendanceToday.clockIn ? new Date(data.attendanceToday.clockIn).toLocaleTimeString() : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-slate-500">{t('attendance.clockOut')}</p>
                      <p className="font-medium">{data.attendanceToday.clockOut ? new Date(data.attendanceToday.clockOut).toLocaleTimeString() : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-slate-500">{t('attendance.worked')}</p>
                      <p className="font-medium">{formatMinutes(data.attendanceToday.workedMinutes ?? 0)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400">{t('dashboard.noAttendanceToday')}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link to="/leave?tab=request" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
                    {t('leave.request')}
                  </Link>
                  <Link to="/documents" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
                    {t('nav.documents')}
                  </Link>
                  <Link to="/requests" className="text-sm text-brand-600 hover:underline dark:text-brand-400">
                    {t('nav.requests')}
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </QueryBoundary>

        <QueryBoundary
          query={me}
          skeleton={<TableSkeleton rows={3} columns={1} />}
          isEmpty={(data) => (data.upcomingEvents ?? []).length === 0}
          empty={<EmptyState title={t('dashboard.noUpcomingEvents')} />}
        >
          {(data) => (
            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.upcomingEvents')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {(data.upcomingEvents ?? []).map((event) => (
                    <li key={event.id} className="flex items-start gap-3 text-sm">
                      <CalendarDays className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{event.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(event.startAt)} · {event.allDay ? t('calendar.allDay') : new Date(event.startAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </QueryBoundary>
      </div>

      {showManager ? (
        <PageSection title={t('dashboard.teamOverview')}>
          <QueryBoundary
            query={manager}
            skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <TableSkeleton key={index} rows={2} columns={2} />)}</div>}
          >
            {(data) => (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label={t('dashboard.teamMembers')} value={num(data.teamSize)} icon={<Users className="size-5" />} />
                  <StatCard
                    label={t('dashboard.pendingLeaveApprovals')}
                    value={num(data.pendingLeaveApprovals)}
                    tone={num(data.pendingLeaveApprovals) > 0 ? 'warning' : 'default'}
                    hint={t('dashboard.todayAttendanceHint', {
                      present: num(data.todayAttendance?.present),
                      absent: num(data.todayAttendance?.absent),
                      leave: num(data.todayAttendance?.onLeave),
                    })}
                  />
                  <StatCard label={t('dashboard.pendingExpenseApprovals')} value={num(data.pendingExpenseApprovals)} tone={num(data.pendingExpenseApprovals) > 0 ? 'warning' : 'default'} />
                  <StatCard label={t('dashboard.pendingCorrections')} value={num(data.pendingCorrections)} icon={<Timer className="size-5" />} />
                </div>
                <ApprovalShortcuts
                  leave={num(data.pendingLeaveApprovals) > 0}
                  expenses={num(data.pendingExpenseApprovals) > 0}
                  corrections={num(data.pendingCorrections) > 0}
                />
                {(data.teamOnLeave ?? []).length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('dashboard.upcomingAbsences')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                        {(data.teamOnLeave ?? []).map((request) => (
                          <li key={request.id} className="flex items-center justify-between gap-3 py-2">
                            <span>
                              {request.employee?.firstName} {request.employee?.lastName} · {request.leaveType?.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatDate(request.startDate)} – {formatDate(request.endDate)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            )}
          </QueryBoundary>
        </PageSection>
      ) : null}

      {showHr ? (
        <PageSection title={t('dashboard.hrOverview')}>
          <QueryBoundary query={hr} skeleton={<TableSkeleton rows={6} columns={3} />}>
            {(data) => (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label={t('dashboard.totalEmployees')} value={num(data.headcount?.total)} />
                  <StatCard label={t('dashboard.activeEmployees')} value={num(data.headcount?.active)} tone="positive" />
                  <StatCard label={t('dashboard.newHires')} value={num(data.headcount?.newHires30d)} hint={t('dashboard.last30Days')} />
                  <StatCard label={t('dashboard.openRequests')} value={num(data.openRequests)} tone={num(data.openRequests) > 0 ? 'warning' : 'default'} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <BarPanel
                    title={t('dashboard.headcountByDepartment')}
                    data={(data.headcountByDepartment ?? []).map((row) => ({ department: row.department, count: num(row.count) }))}
                    xKey="department"
                    series={[{ key: 'count', name: t('dashboard.headcount'), color: '#6366f1' }]}
                    multiColor
                  />
                  <AreaPanel
                    title={t('dashboard.attendanceTrend')}
                    data={(data.attendanceTrend ?? []).map((row) => ({
                      label: row.label,
                      present: num(row.present),
                      late: num(row.late),
                      absent: num(row.absent),
                      leave: num(row.leave),
                    }))}
                    xKey="label"
                    series={[
                      { key: 'present', name: t('attendance.status.PRESENT'), color: '#10b981' },
                      { key: 'late', name: t('attendance.status.LATE'), color: '#f59e0b' },
                      { key: 'absent', name: t('attendance.status.ABSENT'), color: '#ef4444' },
                    ]}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="flex-row items-center gap-2">
                      <Cake className="size-4 text-brand-600" aria-hidden />
                      <CardTitle>{t('dashboard.birthdays')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(data.upcomingBirthdays ?? []).length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.noBirthdays')}</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                          {(data.upcomingBirthdays ?? []).map((person) => (
                            <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                              <Link to={`/people/${person.id}`} className="hover:underline">
                                {person.firstName} {person.lastName}
                              </Link>
                              <span className="text-xs text-slate-500">{formatDate(person.date)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="flex-row items-center gap-2">
                      <AlertTriangle className="size-4 text-amber-500" aria-hidden />
                      <CardTitle>{t('dashboard.expiringContracts')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <QueryBoundary
                        query={hr}
                        isEmpty={(value) => (value.expiringContracts ?? []).length === 0}
                        empty={<p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.nothingExpiring')}</p>}
                      >
                        {(value) => (
                          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                            {(value.expiringContracts ?? []).slice(0, 8).map((item) => (
                              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                                <Link to={item.employee ? `/people/${item.employee.id}` : '/people'} className="hover:underline">
                                  {item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : item.name ?? item.title}
                                </Link>
                                <Badge tone={statusTone('EXPIRING')}>{formatDate(item.endDate ?? item.expiresAt ?? null)}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </QueryBoundary>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </QueryBoundary>
        </PageSection>
      ) : null}

      {showAdmin ? (
        <PageSection title={t('dashboard.adminOverview')}>
          <QueryBoundary
            query={admin}
            skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <TableSkeleton key={index} rows={2} columns={2} />)}</div>}
          >
            {(data) => (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label={t('settings.users')} value={num(data.users)} />
                <StatCard label={t('dashboard.totalEmployees')} value={num(data.employees)} />
                <StatCard label={t('dashboard.departments')} value={num(data.departments)} />
                <StatCard label={t('people.location')} value={num(data.locations)} hint={t('dashboard.pendingInvites', { count: num(data.pendingInvites) })} />
              </div>
            )}
          </QueryBoundary>
        </PageSection>
      ) : null}
    </div>
  );
}

function ApprovalShortcuts({ leave, expenses, corrections }: { leave: boolean; expenses: boolean; corrections: boolean }) {
  const { t } = useTranslation();
  const items = [
    { show: leave, to: '/leave?tab=approvals', label: t('nav.leave'), icon: CalendarDays },
    { show: expenses, to: '/expenses?tab=approvals', label: t('nav.expenses'), icon: FileText },
    { show: corrections, to: '/attendance?tab=corrections', label: t('attendance.corrections'), icon: Timer },
  ].filter((item) => item.show);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <item.icon className="size-4" aria-hidden />
          {t('dashboard.reviewIn', { module: item.label })}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
