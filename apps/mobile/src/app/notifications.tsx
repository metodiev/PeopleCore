import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { notificationsApi } from '@/api/endpoints';
import type { NotificationItem, Paginated } from '@/api/types';
import { Button } from '@/components/button';
import { InlineMessage } from '@/components/inline-message';
import { ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useI18n } from '@/i18n';
import { formatRelative } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useNotificationsStore } from '@/store/notifications';

type Filter = 'ALL' | 'UNREAD';

export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const { pending, error: actionError, run } = useAction();
  const setUnread = useNotificationsStore((state) => state.setUnread);
  const revision = useNotificationsStore((state) => state.revision);

  const [filter, setFilter] = useState<Filter>('ALL');
  const [message, setMessage] = useState<string | null>(null);

  const listQuery = useApiQuery<Paginated<NotificationItem>>(
    () => notificationsApi.list({ unreadOnly: filter === 'UNREAD', pageSize: 50 }),
    [filter],
  );
  const unreadQuery = useApiQuery<{ meta: { total: number } }>(
    () => notificationsApi.list({ unreadOnly: true, pageSize: 1 }),
    [],
  );
  useRefreshOnFocus(listQuery.refetch);

  const unread = unreadQuery.data?.meta.total ?? 0;

  useEffect(() => {
    if (unreadQuery.data) setUnread(unreadQuery.data.meta.total);
  }, [setUnread, unreadQuery.data]);

  // A push arrived while the list is open — reload it.
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (revision === lastRevision.current) return;
    lastRevision.current = revision;
    void listQuery.refetch();
    void unreadQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const markRead = (item: NotificationItem) => {
    if (item.readAt) return;
    void (async () => {
      setMessage(null);
      const result = await run(() => notificationsApi.markRead(item.id));
      if (result === undefined) return;
      await Promise.all([listQuery.refetch(), unreadQuery.refetch()]);
    })();
  };

  const markAllRead = () => {
    void (async () => {
      setMessage(null);
      const result = await run(() => notificationsApi.markAllRead());
      if (result === undefined) return;
      setMessage(t('notifications.markAllRead'));
      await Promise.all([listQuery.refetch(), unreadQuery.refetch()]);
    })();
  };

  const rows = listQuery.data?.data ?? [];

  return (
    <Screen padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={listQuery.refreshing || unreadQuery.refreshing}
            onRefresh={() => {
              void listQuery.refetch();
              void unreadQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title={t('notifications.title')}
              subtitle={unread > 0 ? `${unread}` : undefined}
              action={
                <View style={styles.headerActions}>
                  <Button
                    title={t('notifications.preferences')}
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.push('/notifications/preferences')}
                  />
                  <Button
                    title={t('common.back')}
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    onPress={() => router.back()}
                  />
                </View>
              }
            />

            {message ? <InlineMessage text={message} tone="success" /> : null}
            {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: t('common.all') },
                { value: 'UNREAD', label: t('notifications.unreadOnly') },
              ]}
            />
            <View style={styles.gap} />
          </View>
        }
        ListEmptyComponent={
          listQuery.loading && !listQuery.data ? (
            <LoadingState />
          ) : listQuery.error && !listQuery.data ? (
            <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
          ) : (
            <EmptyState title={t('notifications.noNotifications')} hint={t('common.emptyHint')} />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <ListItem
              title={item.title}
              subtitle={item.body}
              meta={formatRelative(item.createdAt, language)}
              badge={item.readAt ? null : { label: t('notifications.unread'), tone: 'brand' }}
              onPress={() => markRead(item)}
            />
            {item.readAt ? null : (
              <View style={styles.itemAction}>
                <Text style={[styles.itemHint, { color: theme.colors.textMuted }]}>{item.type}</Text>
                <Button
                  title={t('notifications.markRead')}
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={pending}
                  onPress={() => markRead(item)}
                />
              </View>
            )}
          </View>
        )}
        ListFooterComponent={
          unread > 0 ? (
            <Button title={t('notifications.markAllRead')} variant="secondary" loading={pending} onPress={markAllRead} />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gap: { height: 10 },
  row: { marginBottom: 10, gap: 6 },
  itemAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  itemHint: { fontSize: 11 },
});
