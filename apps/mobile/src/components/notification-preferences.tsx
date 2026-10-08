import type { NotificationChannel, NotificationEvent } from '@peoplecore/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { notificationsApi } from '@/api/endpoints';
import type { NotificationPreferenceView } from '@/api/types';
import { Badge } from './badge';
import { Button } from './button';
import { Card } from './card';
import { InlineMessage } from './inline-message';
import { ErrorState, LoadingState } from './states';
import { SwitchRow } from './switch-row';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { useTheme } from '@/lib/theme';

/**
 * Event × channel preference matrix (`GET`/`PUT /notifications/preferences`).
 * Mandatory security events stay enabled and cannot be switched off.
 */
export function NotificationPreferences() {
  const theme = useTheme();
  const { t } = useI18n();
  const query = useApiQuery<NotificationPreferenceView[]>(() => notificationsApi.preferences(), []);
  const { pending, error: actionError, run } = useAction();
  const [draft, setDraft] = useState<NotificationPreferenceView[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const toggle = (eventType: NotificationEvent, channel: NotificationChannel, enabled: boolean) => {
    setDraft((state) =>
      state.map((row) =>
        row.eventType === eventType
          ? { ...row, channels: row.channels.map((entry) => (entry.channel === channel ? { ...entry, enabled } : entry)) }
          : row,
      ),
    );
  };

  const save = () => {
    void (async () => {
      setMessage(null);
      const preferences = draft.flatMap((row) =>
        row.channels.map((entry) => ({
          eventType: row.eventType,
          channel: entry.channel,
          enabled: entry.enabled,
        })),
      );
      const result = await run(() => notificationsApi.updatePreferences(preferences));
      if (result === undefined) return;
      setMessage(t('notifications.preferencesSaved'));
      await query.refetch();
    })();
  };

  if (query.loading && !query.data) return <LoadingState />;
  if (query.error && !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  return (
    <View>
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('notifications.preferencesHint')}</Text>
      {message ? <InlineMessage text={message} tone="success" /> : null}
      {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

      {draft.map((row) => (
        <Card key={row.eventType} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={2}>
              {row.label}
            </Text>
            {row.mandatory ? <Badge label={t('notifications.mandatory')} tone="warning" /> : null}
          </View>
          {row.channels.map((entry) => (
            <SwitchRow
              key={entry.channel}
              label={t(`notifications.channels.${entry.channel}`)}
              value={entry.enabled}
              disabled={row.mandatory}
              onChange={(value) => toggle(row.eventType, entry.channel, value)}
            />
          ))}
          {row.mandatory ? (
            <Text style={[styles.mandatoryHint, { color: theme.colors.textMuted }]}>
              {t('notifications.preferencesHint')}
            </Text>
          ) : null}
        </Card>
      ))}

      <Button title={t('common.save')} onPress={save} loading={pending} disabled={pending || draft.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, marginBottom: 12 },
  card: { marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  mandatoryHint: { fontSize: 11 },
});
