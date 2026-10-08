import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { IntegrationCatalogEntry, IntegrationConnectionStatus } from '../components/feature/api-types.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { SectionCard } from '../components/feature/widgets.js';
import { Badge, statusTone } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, StatCard } from '../components/ui/card.js';
import { ConfirmDialog } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { PageHeader } from '../components/ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';

export function IntegrationsPage() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [disconnectProvider, setDisconnectProvider] = useState<string | null>(null);
  const canManage = can('integrations.manage');

  const catalog = useQuery({
    queryKey: ['integrations', 'catalog'],
    queryFn: () => api.get<IntegrationCatalogEntry[]>('/integrations'),
  });
  const status = useQuery({
    queryKey: ['integrations', 'status'],
    queryFn: () => api.get<{ connections: IntegrationConnectionStatus[] }>('/integrations/status'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['integrations'] });

  const connect = useMutation({
    mutationFn: (provider: string) => api.post<{ url: string; provider: string }>(`/integrations/${provider}/connect`),
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error) => toast.error(describeError(error)),
  });

  const sync = useMutation({
    mutationFn: (provider: string) => api.post<{ queued: boolean; provider: string }>(`/integrations/${provider}/sync`),
    onSuccess: () => {
      toast.success(t('integrations.syncQueued'));
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const disconnect = useMutation({
    mutationFn: (provider: string) => api.delete(`/integrations/${provider}`),
    onSuccess: () => {
      toast.success(t('integrations.disconnected'));
      setDisconnectProvider(null);
      invalidate();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const connections = status.data?.connections ?? [];
  const connectedCount = connections.filter((connection) => connection.status === 'CONNECTED').length;

  return (
    <div className="space-y-6">
      <PageHeader title={t('integrations.title')} description={t('integrations.subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('integrations.availableProviders')} value={(catalog.data ?? []).filter((entry) => entry.available).length} icon={<Plug className="size-5" />} />
        <StatCard
          label={t('integrations.connected')}
          value={connectedCount}
          tone={connectedCount > 0 ? 'positive' : 'default'}
        />
        <StatCard label={t('integrations.mappedCalendars')} value={connections.reduce((sum, entry) => sum + entry.mappedCalendars, 0)} />
        <StatCard label={t('integrations.mappedEvents')} value={connections.reduce((sum, entry) => sum + entry.mappedEvents, 0)} />
      </div>

      <QueryBoundary
        query={catalog}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={Plug} title={t('integrations.noProviders')} />}
      >
        {(entries) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {entries.map((entry) => {
              const connection = entry.connection;
              const connected = connection?.status === 'CONNECTED';
              return (
                <Card key={entry.provider} className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{entry.name}</h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{entry.description}</p>
                    </div>
                    <Badge tone={connected ? 'success' : entry.available ? 'neutral' : 'danger'}>
                      {connected
                        ? t('integrations.connected')
                        : entry.available
                          ? t('integrations.available')
                          : t('integrations.unavailable')}
                    </Badge>
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">{t('integrations.category')}</dt>
                      <dd className="text-slate-800 dark:text-slate-200">{t(`integrations.categoryValue.${entry.category}`, { defaultValue: entry.category })}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">{t('integrations.account')}</dt>
                      <dd className="truncate text-slate-800 dark:text-slate-200">{connection?.connectedAccount ?? '—'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">{t('integrations.lastSyncAt')}</dt>
                      <dd className="text-slate-800 dark:text-slate-200">{formatDateTime(connection?.lastSyncAt)}</dd>
                    </div>
                  </dl>

                  {entry.reason ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{entry.reason}</p> : null}
                  {connection?.lastSyncError ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                      {connection.lastSyncError}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2 pt-2">
                    {!connected ? (
                      <Button
                        size="sm"
                        disabled={!canManage || !entry.available}
                        loading={connect.isPending && connect.variables === entry.provider}
                        onClick={() => connect.mutate(entry.provider)}
                      >
                        <Plug className="size-3.5" aria-hidden />
                        {t('integrations.connect')}
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          loading={sync.isPending && sync.variables === entry.provider}
                          onClick={() => sync.mutate(entry.provider)}
                        >
                          <RefreshCw className="size-3.5" aria-hidden />
                          {t('integrations.syncNow')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => setDisconnectProvider(entry.provider)}>
                          <Unplug className="size-3.5" aria-hidden />
                          {t('integrations.disconnect')}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </QueryBoundary>

      <SectionCard title={t('integrations.connections')} description={t('integrations.connectionsHint')}>
        <QueryBoundary
          query={status}
          isEmpty={() => connections.length === 0}
          empty={<EmptyState icon={Plug} title={t('integrations.noConnections')} description={t('integrations.noConnectionsHint')} />}
          skeleton={<TableSkeleton rows={3} columns={4} />}
        >
          {() => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('integrations.provider')}</TableHead>
                  <TableHead>{t('integrations.account')}</TableHead>
                  <TableHead>{t('integrations.mappedCalendars')}</TableHead>
                  <TableHead>{t('integrations.mappedEvents')}</TableHead>
                  <TableHead>{t('integrations.lastSyncAt')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{connection.provider}</TableCell>
                    <TableCell>{connection.connectedAccount ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{connection.mappedCalendars}</TableCell>
                    <TableCell className="tabular-nums">{connection.mappedEvents}</TableCell>
                    <TableCell>{formatDateTime(connection.lastSyncAt)}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(connection.status)}>{t(`integrations.statusValue.${connection.status}`, { defaultValue: connection.status })}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryBoundary>
      </SectionCard>

      <ConfirmDialog
        open={Boolean(disconnectProvider)}
        onOpenChange={(open) => (!open ? setDisconnectProvider(null) : undefined)}
        title={t('integrations.disconnectConfirm')}
        description={disconnectProvider ?? undefined}
        destructive
        loading={disconnect.isPending}
        confirmLabel={t('integrations.disconnect')}
        onConfirm={() => {
          if (disconnectProvider) disconnect.mutate(disconnectProvider);
        }}
      />
    </div>
  );
}
