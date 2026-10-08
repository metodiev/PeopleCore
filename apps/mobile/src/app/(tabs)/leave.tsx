import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { leaveApi } from '@/api/endpoints';
import type { LeaveBalancesResponse, LeaveRequestRow } from '@/api/types';
import type { LeaveRequestStatus } from '@peoplecore/shared';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { LeaveStatusBadge } from '@/components/status';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { formatDateRange, formatDays } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

type Filter = 'ALL' | LeaveRequestStatus;

export default function LeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const canApprove = useAuth((state) => state.isSuperAdmin || state.permissions.includes('leave.approve'));
  const canRequest = useAuth((state) => state.isSuperAdmin || state.permissions.includes('leave.request'));

  const [filter, setFilter] = useState<Filter>('ALL');
  const [message, setMessage] = useState<string | null>(null);
  const { pending, error: actionError, run } = useAction();

  const balancesQuery = useApiQuery<LeaveBalancesResponse>(() => leaveApi.myBalances(), []);
  const requestsQuery = useApiQuery<{ data: LeaveRequestRow[]; meta: { total: number } }>(
    () => leaveApi.requests({ ...(filter === 'ALL' ? {} : { status: filter as LeaveRequestStatus }), pageSize: 50 }),
    [filter],
  );

  const cancelRequest = (row: LeaveRequestRow) => {
    Alert.alert(t('leave.cancelRequest'), t('leave.cancelConfirm'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await run(() => leaveApi.cancel(row.id));
            if (result !== undefined) {
              setMessage(t('leave.requestCancelled'));
              await requestsQuery.refetch();
              await balancesQuery.refetch();
            }
          })();
        },
      },
    ]);
  };

  const balances = balancesQuery.data?.balances ?? [];
  const requests = requestsQuery.data?.data ?? [];

  const header = (
    <View>
      <ScreenHeader
        title={t('leave.title')}
        subtitle={balancesQuery.data ? t('leave.balances') + ` · ${balancesQuery.data.year}` : undefined}
        action={
          canRequest ? (
            <Button
              title={t('leave.newRequest')}
              size="sm"
              fullWidth={false}
              onPress={() => router.push('/leave/new')}
            />
          ) : undefined
        }
      />

      {message ? <InlineMessage text={message} tone="success" /> : null}
      {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

      <Section title={t('leave.balances')}>
        {balancesQuery.loading && !balancesQuery.data ? (
          <LoadingState />
        ) : balancesQuery.error && !balancesQuery.data ? (
          <ErrorState error={balancesQuery.error} onRetry={() => void balancesQuery.refetch()} />
        ) : balances.length === 0 ? (
          <EmptyState title={t('leave.noBalances')} hint={t('common.emptyHint')} />
        ) : (
          <View style={styles.balanceGrid}>
            {balances.map((balance) => (
              <Card key={balance.id} style={styles.balanceCard}>
                <View style={[styles.dot, { backgroundColor: balance.color ?? theme.colors.brand }]} />
                <Text style={[styles.balanceTitle, { color: theme.colors.text }]} numberOfLines={1}>
                  {balance.leaveType}
                </Text>
                <Text style={[styles.balanceValue, { color: theme.colors.text }]}>
                  {formatDays(balance.remaining, language)}
                </Text>
                <Text style={[styles.balanceMeta, { color: theme.colors.textMuted }]}>
                  {t('leave.used')}: {formatDays(balance.used, language)} · {t('leave.pending')}:{' '}
                  {formatDays(balance.pending, language)}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </Section>

      {canApprove ? (
        <Section title={t('leave.approvals')}>
          <Button title={t('dashboard.approvalsShortcut')} variant="secondary" onPress={() => router.push('/leave/approvals')} />
        </Section>
      ) : null}

      <Section title={t('leave.myRequests')}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: t('common.all') },
            { value: 'PENDING', label: t('leave.pending') },
            { value: 'APPROVED', label: t('leave.approve') },
            { value: 'REJECTED', label: t('leave.reject') },
          ]}
        />
      </Section>
    </View>
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={requestsQuery.refreshing || balancesQuery.refreshing}
            onRefresh={() => {
              void requestsQuery.refetch();
              void balancesQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
        ListEmptyComponent={
          requestsQuery.loading ? (
            <LoadingState />
          ) : requestsQuery.error ? (
            <ErrorState error={requestsQuery.error} onRetry={() => void requestsQuery.refetch()} />
          ) : (
            <EmptyState title={t('leave.noRequests')} hint={t('common.emptyHint')} />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <ListItem
              title={item.leaveType?.name ?? t('leave.requestTitle')}
              subtitle={formatDateRange(item.startDate, item.endDate, language)}
              meta={`${formatDays(item.daysRequested, language)} · ${t('leave.requestedAt')}: ${formatDateRange(
                item.createdAt,
                item.createdAt,
                language,
              )}`}
            />
            <View style={styles.itemFooter}>
              <LeaveStatusBadge status={item.status} />
              {item.status === 'PENDING' && canRequest ? (
                <Button
                  title={t('leave.cancelRequest')}
                  variant="danger"
                  size="sm"
                  fullWidth={false}
                  loading={pending}
                  onPress={() => cancelRequest(item)}
                />
              ) : null}
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  balanceCard: { flexGrow: 1, flexBasis: '46%', gap: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  balanceTitle: { fontSize: 13, fontWeight: '600' },
  balanceValue: { fontSize: 20, fontWeight: '700' },
  balanceMeta: { fontSize: 11 },
  listItem: { marginBottom: 10, gap: 6 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
});
