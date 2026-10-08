import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { attendanceApi, fetchDashboard } from '@/api/endpoints';
import type { DashboardView } from '@/api/types';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useI18n } from '@/i18n';
import { formatDateRange, formatDays, formatMinutes, formatTime, todayKey } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useAuth } from '@/store/auth';
import { useNotificationsStore } from '@/store/notifications';

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const user = useAuth((state) => state.user);
  const canApprove = useAuth((state) => state.isSuperAdmin || state.permissions.includes('leave.approve'));
  const setUnread = useNotificationsStore((state) => state.setUnread);
  const revision = useNotificationsStore((state) => state.revision);
  const { pending, error: actionError, run } = useAction();

  const query = useApiQuery<DashboardView>(() => fetchDashboard({ canApprove }), [canApprove, revision]);
  const todayQuery = useApiQuery(() => attendanceApi.today(), [revision]);
  const data = query.data;
  const todayEntry = todayQuery.data;

  useEffect(() => {
    if (data) setUnread(data.unreadNotifications);
  }, [data, setUnread]);

  const attendance = data?.attendance ?? null;
  const clockIn = todayEntry?.clockIn ?? attendance?.clockIn ?? null;
  const clockOut = todayEntry?.clockOut ?? attendance?.clockOut ?? null;
  const workedMinutes = todayEntry?.workedMinutes ?? attendance?.workedMinutes ?? 0;
  const breakRunning = Boolean(todayEntry?.breaks?.some((row) => row.endedAt === null));

  const punch = async (action: () => Promise<unknown>) => {
    const result = await run(action);
    if (result !== undefined) {
      await Promise.all([query.refetch(), todayQuery.refetch()]);
    }
  };

  const header = (
    <ScreenHeader
      title={t('dashboard.title')}
      subtitle={user ? t('dashboard.greeting', { name: user.firstName }) : undefined}
    />
  );

  if (query.loading && !data) {
    return (
      <Screen padded={false}>
        {header}
        <LoadingState />
      </Screen>
    );
  }

  if (query.error && !data) {
    return (
      <Screen padded={false}>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  if (!data) return null;

  const clockedIn = Boolean(clockIn);
  const clockedOut = Boolean(clockOut);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing || todayQuery.refreshing}
            onRefresh={() => {
              void query.refetch();
              void todayQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        {header}

        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        <Section title={t('dashboard.myDay')}>
          <Card>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
              {formatDateRange(todayKey(), todayKey(), language)}
            </Text>
            <Text style={[styles.muted, { color: theme.colors.textMuted }]}>
              {clockIn
                ? clockedOut
                  ? t('dashboard.clockedOutAt', { time: formatTime(clockOut) })
                  : t('dashboard.clockedInAt', { time: formatTime(clockIn) })
                : t('dashboard.notClockedIn')}
            </Text>
            <Text style={[styles.muted, { color: theme.colors.textMuted }]}>
              {t('dashboard.workedToday')}: {formatMinutes(workedMinutes, language)}
            </Text>

            <View style={styles.buttonRow}>
              {!clockedIn || clockedOut ? (
                <Button
                  title={t('dashboard.clockIn')}
                  onPress={() => void punch(() => attendanceApi.clockIn('MOBILE'))}
                  loading={pending}
                  style={styles.flexButton}
                />
              ) : (
                <Button
                  title={t('dashboard.clockOut')}
                  variant="secondary"
                  onPress={() => void punch(() => attendanceApi.clockOut('MOBILE'))}
                  loading={pending}
                  style={styles.flexButton}
                />
              )}
              {clockedIn && !clockedOut ? (
                breakRunning ? (
                  <Button
                    title={t('dashboard.breakEnd')}
                    variant="secondary"
                    onPress={() => void punch(() => attendanceApi.endBreak())}
                    loading={pending}
                    style={styles.flexButton}
                  />
                ) : (
                  <Button
                    title={t('dashboard.breakStart')}
                    variant="secondary"
                    onPress={() => void punch(() => attendanceApi.startBreak())}
                    loading={pending}
                    style={styles.flexButton}
                  />
                )
              ) : null}
            </View>
          </Card>
        </Section>

        {canApprove && data.pendingApprovals !== null ? (
          <Section title={t('dashboard.pendingApprovals')}>
            <ListItem
              title={String(data.pendingApprovals)}
              subtitle={t('dashboard.approvalsShortcut')}
              leading={
                <View style={[styles.iconBubble, { backgroundColor: theme.colors.brandSoft }]}>
                  <Ionicons name="checkmark-done-outline" color={theme.colors.brandOnSoft} size={20} />
                </View>
              }
              onPress={() => router.push('/leave/approvals')}
            />
          </Section>
        ) : null}

        <Section title={t('nav.dashboard')}>
          <View style={styles.statsRow}>
            <StatCard label={t('dashboard.remainingLeave')} value={formatDays(data.leave.remainingDays, language)} />
            <StatCard label={t('dashboard.pendingRequests')} value={String(data.pendingRequests.total)} />
            <StatCard label={t('dashboard.unreadNotifications')} value={String(data.unreadNotifications)} />
          </View>
        </Section>

        <Section
          title={t('dashboard.upcomingLeave')}
          action={
            <Text style={{ color: theme.colors.brand, fontSize: 13 }} onPress={() => router.push('/(tabs)/leave')}>
              {t('common.seeAll')}
            </Text>
          }
        >
          {data.upcomingLeave.length === 0 ? (
            <EmptyState title={t('dashboard.noUpcomingLeave')} hint={t('leave.noRequests')} />
          ) : (
            data.upcomingLeave.slice(0, 3).map((request) => (
              <ListItem
                key={request.id}
                title={request.leaveType}
                subtitle={formatDateRange(request.startDate, request.endDate, language)}
                meta={formatDays(request.days, language)}
                onPress={() => router.push('/(tabs)/leave')}
              />
            ))
          )}
        </Section>

        <Section
          title={t('dashboard.upcomingEvents')}
          action={
            <Text style={{ color: theme.colors.brand, fontSize: 13 }} onPress={() => router.push('/calendar')}>
              {t('common.seeAll')}
            </Text>
          }
        >
          {data.calendar.today.length === 0 && data.calendar.upcoming.length === 0 ? (
            <EmptyState title={t('dashboard.noUpcomingEvents')} hint={t('calendar.noEvents')} />
          ) : (
            [...data.calendar.today, ...data.calendar.upcoming].slice(0, 3).map((event) => (
              <ListItem
                key={event.id}
                title={event.title}
                subtitle={formatDateRange(event.startAt, event.endAt, language)}
                meta={event.location ?? undefined}
                onPress={() => router.push('/calendar')}
              />
            ))
          )}
        </Section>

        {data.expiringDocuments.length > 0 ? (
          <Section title={t('documents.title')}>
            {data.expiringDocuments.map((document) => (
              <ListItem
                key={document.id}
                title={document.name}
                subtitle={document.category ?? undefined}
                meta={
                  document.daysLeft === null || !document.expiresAt
                    ? undefined
                    : `${t('documents.expires')}: ${formatDateRange(document.expiresAt, document.expiresAt, language)}`
                }
                onPress={() => router.push('/documents')}
              />
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing(3),
        },
      ]}
    >
      <Text style={[styles.statValue, { color: theme.colors.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.colors.textMuted }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 16, fontWeight: '700' },
  muted: { fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  flexButton: { flex: 1 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, borderWidth: 1, gap: 4, minHeight: 84, justifyContent: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  iconBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
