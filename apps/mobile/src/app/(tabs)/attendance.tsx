import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { attendanceApi } from '@/api/endpoints';
import type { AttendanceCorrection, AttendanceEntry } from '@/api/types';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { AttendanceStatusBadge, CorrectionStatusBadge } from '@/components/status';
import { useApiQuery, useAction } from '@/hooks/use-api';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDate, formatMinutes, formatTime, todayKey } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

/** Corrections hold either `HH:MM` or a full ISO timestamp. */
function formatPunch(value: string | null | undefined): string {
  if (!value) return '—';
  return /^\d{1,2}:\d{2}$/.test(value) ? value : formatTime(value);
}

export default function AttendanceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const canClock = useAuth((state) => state.isSuperAdmin || state.permissions.includes('attendance.clock'));
  const canView = useAuth((state) => state.isSuperAdmin || state.permissions.includes('attendance.view'));
  const { pending, error: actionError, run } = useAction();
  const [message, setMessage] = useState<string | null>(null);

  const todayQuery = useApiQuery<AttendanceEntry | null>(() => attendanceApi.today(), []);
  const entriesQuery = useApiQuery<{ data: AttendanceEntry[] }>(
    () => (canView ? attendanceApi.entries({ pageSize: 10 }) : Promise.resolve({ data: [] as AttendanceEntry[] })),
    [canView],
  );
  const correctionsQuery = useApiQuery<{ data: AttendanceCorrection[] }>(
    () =>
      canView
        ? attendanceApi.corrections({ pageSize: 10 })
        : Promise.resolve({ data: [] as AttendanceCorrection[] }),
    [canView],
  );
  useRefreshOnFocus(correctionsQuery.refetch);

  const entry = todayQuery.data ?? null;
  const openBreak = entry?.breaks.find((item) => item.endedAt === null) ?? null;
  const working = Boolean(entry?.clockIn) && !entry?.clockOut;
  const onBreak = openBreak !== null;

  const punch = (action: () => Promise<AttendanceEntry>, doneKey: MessageKey) => {
    void (async () => {
      setMessage(null);
      const result = await run(action);
      if (result === undefined) return;
      setMessage(t(doneKey));
      await Promise.all([todayQuery.refetch(), entriesQuery.refetch()]);
    })();
  };

  const refresh = () => {
    void todayQuery.refetch();
    if (!canView) return;
    void entriesQuery.refetch();
    void correctionsQuery.refetch();
  };

  const entries = entriesQuery.data?.data ?? [];
  const corrections = correctionsQuery.data?.data ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={todayQuery.refreshing || entriesQuery.refreshing || correctionsQuery.refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.brand}
          />
        }
      >
        <ScreenHeader title={t('attendance.title')} subtitle={formatDate(todayKey(), language)} />

        {message ? <InlineMessage text={message} tone="success" /> : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        <Section title={t('attendance.today')}>
          {todayQuery.loading && !todayQuery.data ? (
            <LoadingState />
          ) : todayQuery.error && !todayQuery.data ? (
            <ErrorState error={todayQuery.error} onRetry={() => void todayQuery.refetch()} />
          ) : entry ? (
            <Card style={styles.card}>
              <View style={styles.statusRow}>
                <View style={styles.statusText}>
                  <AttendanceStatusBadge status={entry.status} />
                  <Text style={[styles.hint, { color: theme.colors.textMuted }]}>
                    {entry.clockOut
                      ? t('dashboard.clockedOutAt', { time: formatTime(entry.clockOut) })
                      : onBreak
                        ? t('attendance.breakInProgress')
                        : working
                          ? t('attendance.workInProgress')
                          : t('dashboard.notClockedIn')}
                  </Text>
                </View>
                {entry.clockIn && !entry.clockOut ? (
                  <Text style={[styles.live, { color: theme.colors.brand }]}>
                    {formatTime(entry.clockIn)}
                  </Text>
                ) : null}
              </View>

              {canClock ? (
                <View style={styles.actions}>
                  {!entry.clockIn ? (
                    <Button
                      style={styles.flex}
                      title={t('attendance.clockIn')}
                      loading={pending}
                      onPress={() => punch(() => attendanceApi.clockIn(), 'attendance.clockedIn')}
                    />
                  ) : null}
                  {working && !onBreak ? (
                    <Button
                      style={styles.flex}
                      variant="secondary"
                      title={t('attendance.breakStart')}
                      loading={pending}
                      onPress={() => punch(() => attendanceApi.startBreak(), 'attendance.breakStarted')}
                    />
                  ) : null}
                  {working && onBreak ? (
                    <Button
                      style={styles.flex}
                      variant="secondary"
                      title={t('attendance.breakEnd')}
                      loading={pending}
                      onPress={() => punch(() => attendanceApi.endBreak(), 'attendance.breakEnded')}
                    />
                  ) : null}
                  {working ? (
                    <Button
                      style={styles.flex}
                      variant="danger"
                      title={t('attendance.clockOut')}
                      loading={pending}
                      onPress={() => punch(() => attendanceApi.clockOut(), 'attendance.clockedOut')}
                    />
                  ) : null}
                </View>
              ) : null}

              <View style={styles.summary}>
                <KeyValue label={t('attendance.clockIn')} value={formatTime(entry.clockIn)} />
                <KeyValue label={t('attendance.clockOut')} value={formatTime(entry.clockOut)} />
                <KeyValue label={t('attendance.worked')} value={formatMinutes(entry.workedMinutes, language)} />
                <KeyValue label={t('attendance.breaks')} value={formatMinutes(entry.breakMinutes ?? 0, language)} />
                {entry.overtimeMinutes ? (
                  <KeyValue label={t('attendance.overtime')} value={formatMinutes(entry.overtimeMinutes, language)} />
                ) : null}
              </View>
            </Card>
          ) : (
            <Card style={styles.card}>
              <EmptyState title={t('attendance.noEntry')} hint={t('common.emptyHint')} />
              {canClock ? (
                <Button
                  title={t('attendance.clockIn')}
                  loading={pending}
                  onPress={() => punch(() => attendanceApi.clockIn(), 'attendance.clockedIn')}
                />
              ) : null}
            </Card>
          )}
        </Section>

        {canView ? (
          <Section title={t('attendance.recentEntries')}>
            {entriesQuery.loading && !entriesQuery.data ? (
              <LoadingState />
            ) : entriesQuery.error && !entriesQuery.data ? (
              <ErrorState error={entriesQuery.error} onRetry={() => void entriesQuery.refetch()} />
            ) : entries.length === 0 ? (
              <EmptyState title={t('attendance.noEntries')} hint={t('common.emptyHint')} />
            ) : (
              entries.map((item) => (
                <View key={item.id} style={styles.row}>
                  <ListItem
                    title={formatDate(item.date, language)}
                    subtitle={`${formatTime(item.clockIn)} – ${formatTime(item.clockOut)}`}
                    meta={formatMinutes(item.workedMinutes, language)}
                    trailing={<AttendanceStatusBadge status={item.status} />}
                  />
                </View>
              ))
            )}
          </Section>
        ) : null}

        <Section
          title={t('attendance.myCorrections')}
          action={
            canClock ? (
              <Button
                title={t('attendance.correction')}
                size="sm"
                fullWidth={false}
                onPress={() => router.push('/attendance/correction')}
              />
            ) : undefined
          }
        >
          {!canView ? (
            <EmptyState title={t('attendance.noCorrections')} hint={t('common.emptyHint')} />
          ) : correctionsQuery.loading && !correctionsQuery.data ? (
            <LoadingState />
          ) : correctionsQuery.error && !correctionsQuery.data ? (
            <ErrorState error={correctionsQuery.error} onRetry={() => void correctionsQuery.refetch()} />
          ) : corrections.length === 0 ? (
            <EmptyState title={t('attendance.noCorrections')} hint={t('common.emptyHint')} />
          ) : (
            corrections.map((item) => (
              <View key={item.id} style={styles.row}>
                <ListItem
                  title={formatDate(item.date, language)}
                  subtitle={item.reason}
                  meta={`${formatPunch(item.requestedClockIn)} – ${formatPunch(item.requestedClockOut)}`}
                  trailing={<CorrectionStatusBadge status={item.status} />}
                />
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusText: { gap: 6, flexShrink: 1 },
  hint: { fontSize: 13 },
  live: { fontSize: 24, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flexGrow: 1, flexBasis: '40%' },
  summary: { gap: 0 },
  row: { marginBottom: 10 },
});
