import type { HRRequestStatus } from '@peoplecore/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { hrRequestsApi } from '@/api/endpoints';
import type { HrRequestRow, Paginated } from '@/api/types';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { InlineMessage } from '@/components/inline-message';
import { Avatar, ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { RequestStatusBadge, useStatusLabels } from '@/components/status';
import { TextField } from '@/components/text-field';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useI18n } from '@/i18n';
import { formatRelative, fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

type Tab = 'mine' | 'inbox';
type StatusFilter = 'ALL' | HRRequestStatus;

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_EMPLOYEE', 'RESOLVED', 'CLOSED'];

function emptyPage(): Paginated<HrRequestRow> {
  return { data: [], meta: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
}

export default function RequestsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const labels = useStatusLabels();
  const canCreate = useAuth((state) => state.isSuperAdmin || state.permissions.includes('requests.create'));
  const canManage = useAuth((state) => state.isSuperAdmin || state.permissions.includes('requests.manage'));
  const { pending, error: actionError, run } = useAction();

  const [tab, setTab] = useState<Tab>('mine');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mineQuery = useApiQuery<Paginated<HrRequestRow>>(
    () => hrRequestsApi.list({ ...(status === 'ALL' ? {} : { status }), pageSize: 50 }),
    [status],
  );
  const inboxQuery = useApiQuery<Paginated<HrRequestRow>>(
    () =>
      canManage
        ? api.get<Paginated<HrRequestRow>>('/requests/inbox', {
            query: { ...(status === 'ALL' ? {} : { status }), pageSize: 50 },
          })
        : Promise.resolve(emptyPage()),
    [canManage, status],
  );
  useRefreshOnFocus(mineQuery.refetch);

  const activeTab: Tab = canManage ? tab : 'mine';
  const query = activeTab === 'inbox' ? inboxQuery : mineQuery;
  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;

  const updateStatus = (row: HrRequestRow, next: HRRequestStatus) => {
    void (async () => {
      setMessage(null);
      const result = await run(() =>
        api.post<HrRequestRow>(`/requests/${row.id}/status`, {
          status: next,
          resolution: resolutions[row.id]?.trim() || undefined,
        }),
      );
      if (result === undefined) return;
      setMessage(t('requests.statusUpdated'));
      setExpandedId(null);
      await inboxQuery.refetch();
    })();
  };

  const statusOptions = STATUS_FILTERS.map((value) => ({
    value,
    label: value === 'ALL' ? t('common.all') : labels.requestStatus(value),
  }));

  return (
    <Screen padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={query.refreshing} onRefresh={() => void query.refetch()} tintColor={theme.colors.brand} />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title={t('requests.title')}
              subtitle={`${t('common.total')}: ${total}`}
              action={
                canCreate ? (
                  <Button
                    title={t('requests.newRequest')}
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push('/requests/new')}
                  />
                ) : undefined
              }
            />

            {message ? <InlineMessage text={message} tone="success" /> : null}
            {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

            {canManage ? (
              <>
                <Segmented<Tab>
                  value={activeTab}
                  onChange={setTab}
                  options={[
                    { value: 'mine', label: t('requests.myRequests') },
                    { value: 'inbox', label: t('requests.inbox') },
                  ]}
                />
                <View style={styles.gap} />
              </>
            ) : null}

            <Segmented<StatusFilter> value={status} onChange={setStatus} options={statusOptions} />
            <View style={styles.gap} />
          </View>
        }
        ListEmptyComponent={
          query.loading ? (
            <LoadingState />
          ) : query.error && !query.data ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <EmptyState
              title={activeTab === 'inbox' ? t('requests.noInbox') : t('requests.noRequests')}
              hint={t('common.emptyHint')}
            />
          )
        }
        renderItem={({ item }) =>
          activeTab === 'inbox' ? (
            <InboxCard
              item={item}
              expanded={expandedId === item.id}
              resolution={resolutions[item.id] ?? ''}
              pending={pending}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onResolutionChange={(value) => setResolutions((state) => ({ ...state, [item.id]: value }))}
              onStatus={(next) => updateStatus(item, next)}
            />
          ) : (
            <View style={styles.listRow}>
              <ListItem
                title={item.subject}
                subtitle={item.description}
                meta={`${labels.requestType(item.type)} · ${formatRelative(item.createdAt, language)}`}
                badge={{ label: labels.requestStatus(item.status), tone: labels.requestTone(item.status) }}
                onPress={() => router.push(`/requests/${item.id}`)}
              />
            </View>
          )
        }
        ListFooterComponent={
          total > rows.length ? (
            <Text style={[styles.footerHint, { color: theme.colors.textMuted }]}>
              {`${rows.length} ${t('common.of')} ${total} ${t('common.rows')}`}
            </Text>
          ) : null
        }
      />
    </Screen>
  );
}

function InboxCard({
  item,
  expanded,
  resolution,
  pending,
  onToggle,
  onResolutionChange,
  onStatus,
}: {
  item: HrRequestRow;
  expanded: boolean;
  resolution: string;
  pending: boolean;
  onToggle: () => void;
  onResolutionChange: (value: string) => void;
  onStatus: (status: HRRequestStatus) => void;
}) {
  const theme = useTheme();
  const { t, language } = useI18n();
  const labels = useStatusLabels();

  return (
    <Pressable
      onPress={onToggle}
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
      <View style={styles.cardHeader}>
        <Avatar firstName={item.employee?.firstName} lastName={item.employee?.lastName} />
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {item.subject}
          </Text>
          <Text style={[styles.cardMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {fullName(item.employee)} · {labels.requestType(item.type)} · {formatRelative(item.createdAt, language)}
          </Text>
        </View>
        <RequestStatusBadge status={item.status} />
      </View>

      {expanded ? (
        <View style={styles.cardBody}>
          <Text style={[styles.cardDescription, { color: theme.colors.textMuted }]}>{item.description}</Text>
          <View style={styles.badges}>
            <Badge label={labels.requestPriority(item.priority)} tone={labels.priorityTone(item.priority)} />
            {item._count ? (
              <Badge label={`${t('requests.comments')}: ${item._count.comments}`} tone="neutral" />
            ) : null}
          </View>
          <TextField label={t('requests.resolution')} value={resolution} onChangeText={onResolutionChange} multiline numberOfLines={3} />
          <View style={styles.cardActions}>
            <Button
              style={styles.flex}
              size="sm"
              variant="secondary"
              title={t('requests.waitEmployee')}
              disabled={pending || item.status === 'WAITING_EMPLOYEE'}
              onPress={() => onStatus('WAITING_EMPLOYEE')}
            />
            <Button
              style={styles.flex}
              size="sm"
              title={t('requests.resolve')}
              disabled={pending || item.status === 'RESOLVED'}
              onPress={() => onStatus('RESOLVED')}
            />
            <Button
              style={styles.flex}
              size="sm"
              variant="ghost"
              title={t('requests.closeRequest')}
              disabled={pending || item.status === 'CLOSED'}
              onPress={() => onStatus('CLOSED')}
            />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { height: 10 },
  listRow: { marginBottom: 10 },
  card: { borderWidth: 1, gap: 10, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardMeta: { fontSize: 12 },
  cardBody: { gap: 10 },
  cardDescription: { fontSize: 13 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flex: { flexGrow: 1, flexBasis: '30%' },
  footerHint: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
