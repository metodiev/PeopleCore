import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { leaveApi } from '@/api/endpoints';
import type { LeaveRequestRow } from '@/api/types';
import { Avatar } from '@/components/list-item';
import { Button } from '@/components/button';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { LeaveStatusBadge } from '@/components/status';
import { TextField } from '@/components/text-field';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { formatDateRange, formatDays, fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function LeaveApprovalsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const { pending, error: actionError, run } = useAction();

  const query = useApiQuery<{ data: LeaveRequestRow[]; meta: { total: number } }>(
    () => leaveApi.pendingApprovals({ pageSize: 50 }),
    [],
  );

  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const decide = (row: LeaveRequestRow, approve: boolean) => {
    const comment = comments[row.id]?.trim();
    if (!approve && !comment) {
      Alert.alert(t('leave.reject'), t('leave.rejectReason'));
      return;
    }
    const action = () => (approve ? leaveApi.approve(row.id, comment) : leaveApi.reject(row.id, comment));
    void (async () => {
      const result = await run(action);
      if (result !== undefined) {
        setMessage(approve ? t('leave.approve') : t('leave.reject'));
        await query.refetch();
      }
    })();
  };

  const approvals = query.data?.data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        data={approvals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={query.refreshing} onRefresh={() => void query.refetch()} tintColor={theme.colors.brand} />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader title={t('leave.approvals')} subtitle={t('dashboard.pendingApprovals')} />
            {message ? <InlineMessage text={message} tone="success" /> : null}
            {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}
          </View>
        }
        ListEmptyComponent={
          query.loading ? (
            <LoadingState />
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <EmptyState title={t('leave.noApprovals')} hint={t('common.emptyHint')} />
          )
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing(3),
              },
            ]}
          >
            <View style={styles.header}>
              <Avatar firstName={item.employee?.firstName} lastName={item.employee?.lastName} />
              <View style={styles.headerText}>
                <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>
                  {fullName(item.employee)}
                </Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                  {item.leaveType?.name} · {formatDateRange(item.startDate, item.endDate, language)} ·{' '}
                  {formatDays(item.daysRequested, language)}
                </Text>
              </View>
              <LeaveStatusBadge status={item.status} />
            </View>

            {item.reason ? (
              <Text style={[styles.reason, { color: theme.colors.textMuted }]} numberOfLines={3}>
                {item.reason}
              </Text>
            ) : null}

            <TextField
              label={t('leave.comment')}
              value={comments[item.id] ?? ''}
              onChangeText={(value) => setComments((state) => ({ ...state, [item.id]: value }))}
              placeholder={t('leave.decisionComment')}
            />

            <View style={styles.actions}>
              <Button
                title={t('leave.approve')}
                onPress={() => decide(item, true)}
                loading={pending}
                style={styles.flex}
              />
              <Button
                title={t('leave.reject')}
                variant="danger"
                onPress={() => decide(item, false)}
                loading={pending}
                style={styles.flex}
              />
            </View>
          </View>
        )}
        ListFooterComponent={
          <Button title={t('common.back')} variant="ghost" onPress={() => router.back()} />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, gap: 10, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  reason: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
