import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api/client';
import { teamApi } from '@/api/endpoints';
import type { Employee360, EmployeeSummary, Paginated } from '@/api/types';
import { Avatar, ListItem } from '@/components/list-item';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useStatusLabels } from '@/components/status';
import { TextField } from '@/components/text-field';
import { useApiQuery, useDebounced } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { formatDate, formatDays, formatMinutes, fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

interface AttendanceToday {
  date: string;
  present: number;
  late: number;
  absent: number;
  remote: number;
  onLeave: number;
  holiday: number;
  halfDay: number;
  notClockedIn: number;
  total: number;
}

interface ManagerLeave {
  id: string;
  employee: { id: string; name: string; photoUrl?: string | null };
  leaveType: string;
  color?: string | null;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
}

interface ManagerDashboard {
  teamSize: number;
  attendanceToday: AttendanceToday;
  teamLeave: ManagerLeave[];
  pendingApprovals: {
    leave: { count: number };
    expenses: { count: number };
    corrections: { count: number };
  };
  pendingApprovalsTotal: number;
  upcomingBirthdays: Array<{ employeeId: string; name: string; birthDate: string; daysUntil: number }>;
}

export default function TeamScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const labels = useStatusLabels();
  const canViewDashboard = useAuth((state) => state.isSuperAdmin || state.permissions.includes('dashboard.view'));
  const canViewDirectory = useAuth((state) => state.isSuperAdmin || state.permissions.includes('employees.view'));

  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);

  const dashboardQuery = useApiQuery<ManagerDashboard | null>(
    () => (canViewDashboard ? api.get<ManagerDashboard>('/dashboard/manager') : Promise.resolve(null)),
    [canViewDashboard],
  );
  const directoryQuery = useApiQuery<Paginated<EmployeeSummary> | null>(
    () =>
      canViewDirectory
        ? teamApi.employees({ search: debouncedSearch.trim() || undefined, pageSize: 50 })
        : Promise.resolve(null),
    [canViewDirectory, debouncedSearch],
  );
  const detailQuery = useApiQuery<Employee360 | null>(
    () => (expandedId ? teamApi.employee360(expandedId) : Promise.resolve(null)),
    [expandedId],
  );

  const dashboard = dashboardQuery.data ?? null;
  const attendance = dashboard?.attendanceToday ?? null;
  const members = directoryQuery.data?.data ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={dashboardQuery.refreshing || directoryQuery.refreshing}
            onRefresh={() => {
              if (canViewDashboard) void dashboardQuery.refetch();
              if (canViewDirectory) void directoryQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        <ScreenHeader
          title={t('team.title')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />

        {canViewDashboard ? (
          <>
            <Section title={t('team.attendanceToday')}>
              {dashboardQuery.loading && !dashboard ? (
                <LoadingState />
              ) : dashboardQuery.error && !dashboard ? (
                <ErrorState error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} />
              ) : attendance ? (
                <Card>
                  <View style={styles.countGrid}>
                    {(
                      [
                        ['PRESENT', attendance.present],
                        ['LATE', attendance.late],
                        ['ABSENT', attendance.absent],
                        ['REMOTE', attendance.remote],
                        ['LEAVE', attendance.onLeave],
                        ['HOLIDAY', attendance.holiday],
                        ['HALF_DAY', attendance.halfDay],
                      ] as const
                    ).map(([status, count]) => (
                      <View key={status} style={styles.countCell}>
                        <Text style={[styles.countValue, { color: theme.colors.text }]}>{count}</Text>
                        <Text style={[styles.countLabel, { color: theme.colors.textMuted }]} numberOfLines={1}>
                          {labels.attendanceStatus(status)}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.countCell}>
                      <Text style={[styles.countValue, { color: theme.colors.text }]}>{attendance.notClockedIn}</Text>
                      <Text style={[styles.countLabel, { color: theme.colors.textMuted }]} numberOfLines={1}>
                        {t('team.notClockedIn')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                    {t('common.total')}: {attendance.total} · {formatDate(attendance.date, language)}
                  </Text>
                </Card>
              ) : (
                <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
              )}
            </Section>

            <Section title={t('dashboard.pendingApprovals')}>
              <Card>
                <KeyValue label={t('leave.approvals')} value={dashboard?.pendingApprovals.leave.count ?? 0} />
                <KeyValue label={t('attendance.correction')} value={dashboard?.pendingApprovals.corrections.count ?? 0} />
                <KeyValue label={t('team.expenses')} value={dashboard?.pendingApprovals.expenses.count ?? 0} />
                <KeyValue label={t('common.total')} value={dashboard?.pendingApprovalsTotal ?? 0} />
              </Card>
              <Button title={t('dashboard.approvalsShortcut')} variant="secondary" onPress={() => router.push('/leave/approvals')} />
            </Section>

            <Section title={t('team.teamLeave')}>
              {dashboard && dashboard.teamLeave.length > 0 ? (
                dashboard.teamLeave.slice(0, 8).map((entry) => (
                  <View key={entry.id} style={styles.row}>
                    <ListItem
                      title={entry.employee.name}
                      subtitle={`${entry.leaveType} · ${formatDate(entry.startDate, language)} – ${formatDate(entry.endDate, language)}`}
                      meta={formatDays(entry.days, language)}
                      leading={<Avatar firstName={entry.employee.name.split(' ')[0]} lastName={entry.employee.name.split(' ')[1]} />}
                    />
                  </View>
                ))
              ) : (
                <EmptyState title={t('dashboard.noUpcomingLeave')} hint={t('common.emptyHint')} />
              )}
            </Section>

            {dashboard && dashboard.upcomingBirthdays.length > 0 ? (
              <Section title={t('team.birthdays')}>
                <Card>
                  {dashboard.upcomingBirthdays.slice(0, 8).map((entry) => (
                    <View key={entry.employeeId} style={styles.rowBetween}>
                      <Text style={[styles.rowLabel, { color: theme.colors.text }]} numberOfLines={1}>
                        {entry.name}
                      </Text>
                      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                        {formatDate(entry.birthDate, language)}
                      </Text>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        ) : null}

        {canViewDirectory ? (
          <Section title={t('team.directory')}>
            <TextField label={t('common.search')} value={search} onChangeText={setSearch} placeholder={t('team.searchHint')} />
            {directoryQuery.loading && !directoryQuery.data ? (
              <LoadingState />
            ) : directoryQuery.error && !directoryQuery.data ? (
              <ErrorState error={directoryQuery.error} onRetry={() => void directoryQuery.refetch()} />
            ) : members.length === 0 ? (
              <EmptyState title={t('team.noMembers')} hint={t('common.emptyHint')} />
            ) : (
              members.map((member) => (
                <View key={member.id} style={styles.row}>
                  <ListItem
                    showAvatar
                    title={fullName(member)}
                    subtitle={[member.position?.title, member.department?.name].filter(Boolean).join(' · ') || null}
                    meta={member.employeeNumber ?? member.workEmail ?? null}
                    onPress={() => setExpandedId(expandedId === member.id ? null : member.id)}
                  />
                  {expandedId === member.id ? (
                    <EmployeeDetail
                      loading={detailQuery.loading}
                      error={detailQuery.error}
                      data={detailQuery.data}
                      onRetry={() => void detailQuery.refetch()}
                    />
                  ) : null}
                </View>
              ))
            )}
          </Section>
        ) : null}

        {!canViewDashboard && !canViewDirectory ? (
          <EmptyState title={t('team.noMembers')} hint={t('common.emptyHint')} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EmployeeDetail({
  loading,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  data: Employee360 | null;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const { t, language } = useI18n();
  const labels = useStatusLabels();

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;

  const organization = data.organization;
  const leave = data.leave;
  const attendance = data.attendance;

  return (
    <Card style={styles.detail}>
      <Text style={[styles.detailName, { color: theme.colors.text }]} numberOfLines={1}>
        {fullName(data.profile)}
      </Text>
      <View>
        <KeyValue label={t('team.employeeNumber')} value={data.profile.employeeNumber} />
        <KeyValue label={t('team.hireDate')} value={formatDate(data.profile.hireDate, language)} />
        <KeyValue label={t('team.department')} value={organization.department?.name} />
        <KeyValue label={t('team.position')} value={organization.position?.title} />
        <KeyValue label={t('team.location')} value={organization.location?.name} />
        <KeyValue label={t('team.manager')} value={organization.manager ? fullName(organization.manager) : null} />
      </View>

      {leave ? (
        <View style={styles.detailBlock}>
          <Text style={[styles.detailTitle, { color: theme.colors.textMuted }]}>{t('team.leavePane')}</Text>
          {leave.balances.length === 0 ? (
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{t('team.noLeaveBalances')}</Text>
          ) : (
            leave.balances.slice(0, 5).map((balance) => (
              <View key={balance.leaveTypeId} style={styles.rowBetween}>
                <Text style={[styles.rowLabel, { color: theme.colors.text }]} numberOfLines={1}>
                  {balance.leaveType}
                </Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                  {formatDays(balance.remaining, language)}
                </Text>
              </View>
            ))
          )}
          {leave.requests.length > 0 ? (
            <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={2}>
              {t('team.recentLeave')}: {leave.requests[0] ? labels.leaveStatus(leave.requests[0].status) : ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      {attendance ? (
        <View style={styles.detailBlock}>
          <Text style={[styles.detailTitle, { color: theme.colors.textMuted }]}>{t('team.attendancePane')}</Text>
          {attendance.entries && attendance.entries.length > 0 ? (
            attendance.entries.slice(0, 3).map((entry) => (
              <View key={entry.id} style={styles.rowBetween}>
                <Text style={[styles.rowLabel, { color: theme.colors.text }]} numberOfLines={1}>
                  {formatDate(entry.date, language)}
                </Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                  {formatMinutes(entry.workedMinutes, language)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{t('team.noAttendance')}</Text>
          )}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  countCell: { flexGrow: 1, flexBasis: '28%', alignItems: 'center', gap: 2 },
  countValue: { fontSize: 20, fontWeight: '700' },
  countLabel: { fontSize: 11 },
  meta: { fontSize: 12 },
  row: { marginBottom: 10 },
  detail: { gap: 10 },
  detailName: { fontSize: 16, fontWeight: '700' },
  detailBlock: { gap: 4 },
  detailTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: 14, flexShrink: 1 },
});
