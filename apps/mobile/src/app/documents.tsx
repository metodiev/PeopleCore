import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { documentsApi } from '@/api/endpoints';
import type { DocumentRow } from '@/api/types';
import { Button } from '@/components/button';
import { InlineMessage } from '@/components/inline-message';
import { ListItem } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { DocumentStatusBadge } from '@/components/status';
import { TextField } from '@/components/text-field';
import { useAction, useApiQuery, useDebounced } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

type Filter = 'ALL' | 'PENDING' | 'EXPIRING';

export default function DocumentsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const canAcknowledge = useAuth((state) => state.isSuperAdmin || state.permissions.includes('documents.acknowledge'));
  const { pending, error: actionError, run } = useAction();

  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search);

  const listQuery = useApiQuery<{ data: DocumentRow[]; meta: { total: number } }>(
    () => documentsApi.list({ search: debouncedSearch.trim() || undefined, pageSize: 50 }),
    [debouncedSearch],
  );
  const expiringQuery = useApiQuery<DocumentRow[]>(
    () => api.get<DocumentRow[]>('/documents/expiring', { query: { days: 30 } }),
    [],
  );

  const documents = listQuery.data?.data ?? [];
  const expiring = expiringQuery.data ?? [];
  const rows =
    filter === 'EXPIRING'
      ? expiring
      : filter === 'PENDING'
        ? documents.filter((document) => !document.acknowledgedAt)
        : documents;
  const activeQuery = filter === 'EXPIRING' ? expiringQuery : listQuery;

  const acknowledge = (document: DocumentRow) => {
    void (async () => {
      setMessage(null);
      const result = await run(() => documentsApi.acknowledge(document.id));
      if (result === undefined) return;
      setMessage(t('documents.acknowledged'));
      await Promise.all([listQuery.refetch(), expiringQuery.refetch()]);
    })();
  };

  const download = (document: DocumentRow) => {
    void (async () => {
      setMessage(null);
      const result = await run(async () => {
        const link = await documentsApi.download(document.id);
        await WebBrowser.openBrowserAsync(link.url);
        return link;
      });
      if (result === undefined) return;
      setMessage(null);
    })();
  };

  const listEmpty = activeQuery.loading ? (
    <LoadingState />
  ) : activeQuery.error && !activeQuery.data ? (
    <ErrorState error={activeQuery.error} onRetry={() => void activeQuery.refetch()} />
  ) : (
    <EmptyState title={t('documents.noDocuments')} hint={t('common.emptyHint')} />
  );

  return (
    <Screen padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={activeQuery.refreshing}
            onRefresh={() => {
              void listQuery.refetch();
              void expiringQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title={t('documents.title')}
              subtitle={`${t('common.total')}: ${listQuery.data?.meta.total ?? 0}`}
              action={
                <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
              }
            />

            {message ? <InlineMessage text={message} tone="success" /> : null}
            {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}
            {expiringQuery.error && !expiringQuery.data ? (
              <InlineMessage text={errorMessage(expiringQuery.error)} />
            ) : null}

            <TextField
              label={t('common.search')}
              value={search}
              onChangeText={setSearch}
              placeholder={t('documents.title')}
            />
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: t('documents.all') },
                { value: 'PENDING', label: t('documents.pending') },
                { value: 'EXPIRING', label: t('documents.expiring') },
              ]}
            />
            <View style={styles.gap} />
          </View>
        }
        ListEmptyComponent={listEmpty}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <ListItem
              title={item.name}
              subtitle={item.category?.name ?? item.description ?? null}
              meta={`${t('documents.issued')}: ${formatDate(item.issuedAt, language)} · ${t('documents.expires')}: ${formatDate(
                item.expiresAt,
                language,
              )}`}
              onPress={() => download(item)}
            />
            <View style={styles.actions}>
              <DocumentStatusBadge status={item.status} />
              {item.acknowledgedAt ? (
                <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                  {t('documents.acknowledgedOn', { date: formatDate(item.acknowledgedAt, language) })}
                </Text>
              ) : canAcknowledge ? (
                <Button
                  title={t('documents.acknowledge')}
                  size="sm"
                  fullWidth={false}
                  loading={pending}
                  onPress={() => acknowledge(item)}
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
  gap: { height: 10 },
  row: { marginBottom: 12, gap: 6 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 4,
  },
  meta: { fontSize: 12 },
});
