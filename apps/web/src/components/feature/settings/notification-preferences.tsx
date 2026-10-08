import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../../lib/api.js';
import { useAuth } from '../../../store/auth.js';
import type { NotificationPreferenceView } from '../api-types.js';
import { QueryBoundary, useApiErrorText } from '../query.js';
import { Card, CardContent } from '../../ui/card.js';
import { EmptyState, TableSkeleton } from '../../ui/feedback.js';
import { Button } from '../../ui/button.js';
import { Switch } from '../../ui/misc.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.js';

const CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS'] as const;

/**
 * Self-service notification matrix (event type × channel). Mandatory events
 * are locked on: the API rejects disabling them.
 */
export function NotificationPreferencesPanel() {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const can = useAuth((state) => state.can);
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const preferences = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<NotificationPreferenceView[]>('/notifications/preferences'),
  });

  useEffect(() => {
    if (!preferences.data) return;
    const next: Record<string, boolean> = {};
    for (const preference of preferences.data) {
      for (const channel of preference.channels) {
        next[`${preference.eventType}:${channel.channel}`] = channel.enabled;
      }
    }
    setDraft(next);
  }, [preferences.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<NotificationPreferenceView[]>('/notifications/preferences', {
        preferences: Object.entries(draft).map(([key, enabled]) => {
          const [eventType, channel] = key.split(':');
          return { eventType, channel, enabled };
        }),
      }),
    onSuccess: () => toast.success(t('common.saved')),
    onError: (error) => toast.error(describeError(error)),
  });

  const readOnly = !can('notifications.self.manage');

  return (
    <Card>
      <QueryBoundary
        query={preferences}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState title={t('notifications.noPreferences')} />}
        skeleton={<TableSkeleton rows={5} columns={5} />}
      >
        {(data) => (
          <>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('notifications.event')}</TableHead>
                    {CHANNELS.map((channel) => (
                      <TableHead key={channel}>{t(`notifications.channel.${channel}`)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((preference) => (
                    <TableRow key={preference.eventType}>
                      <TableCell>
                        <span className="block text-sm text-slate-800 dark:text-slate-100">{preference.label}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{preference.eventType}</span>
                        {preference.mandatory ? (
                          <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">{t('notifications.mandatory')}</span>
                        ) : null}
                      </TableCell>
                      {CHANNELS.map((channel) => {
                        const key = `${preference.eventType}:${channel}`;
                        const enabled = preference.mandatory ? true : draft[key] ?? true;
                        return (
                          <TableCell key={channel}>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => {
                                if (preference.mandatory) return;
                                setDraft((current) => ({ ...current, [key]: checked }));
                              }}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
            <div className="flex justify-end border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <Button disabled={readOnly || preferences.isFetching} loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </QueryBoundary>
    </Card>
  );
}
