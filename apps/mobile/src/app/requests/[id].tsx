import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { hrRequestsApi } from '@/api/endpoints';
import type { HrRequestRow } from '@/api/types';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Avatar } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { RequestStatusBadge, useStatusLabels } from '@/components/status';
import { TextField } from '@/components/text-field';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { formatDateTime, formatRelative, fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function HrRequestDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t, language } = useI18n();
  const labels = useStatusLabels();
  const { pending, error: actionError, run } = useAction();

  const query = useApiQuery<HrRequestRow | null>(
    () => (id ? hrRequestsApi.detail(id) : Promise.resolve(null)),
    [id],
  );

  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const sendComment = () => {
    const body = comment.trim();
    if (!id || !body) return;
    void (async () => {
      setMessage(null);
      const result = await run(() => hrRequestsApi.addComment(id, body));
      if (result === undefined) return;
      setComment('');
      setMessage(t('requests.commentSent'));
      await query.refetch();
    })();
  };

  const request = query.data ?? null;

  if (query.loading && !request) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (query.error && !request) {
    return (
      <Screen>
        <ScreenHeader
          title={t('requests.detail')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  if (!request) {
    return (
      <Screen>
        <ScreenHeader
          title={t('requests.detail')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />
        <EmptyState title={t('requests.noRequests')} hint={t('common.emptyHint')} />
      </Screen>
    );
  }

  const comments = request.comments ?? [];

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={query.refreshing} onRefresh={() => void query.refetch()} tintColor={theme.colors.brand} />
        }
      >
        <ScreenHeader
          title={t('requests.detail')}
          subtitle={request.subject}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />

        {message ? <InlineMessage text={message} tone="success" /> : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        <Section title={request.subject}>
          <Card>
            <View style={styles.badges}>
              <RequestStatusBadge status={request.status} />
              <Badge label={labels.requestType(request.type)} tone="info" />
              <Badge label={labels.requestPriority(request.priority)} tone={labels.priorityTone(request.priority)} />
            </View>
            <Text style={[styles.description, { color: theme.colors.text }]}>{request.description}</Text>
            <View>
              <KeyValue label={t('leave.employee')} value={fullName(request.employee)} />
              <KeyValue label={t('leave.requestedAt')} value={formatDateTime(request.createdAt, language)} />
              <KeyValue label={t('requests.dueDate')} value={request.dueDate ? formatDateTime(request.dueDate, language) : null} />
              {request.resolvedAt ? (
                <KeyValue label={labels.requestStatus('RESOLVED')} value={formatDateTime(request.resolvedAt, language)} />
              ) : null}
            </View>
          </Card>
        </Section>

        <Section title={t('requests.comments')}>
          {comments.length === 0 ? (
            <EmptyState title={t('requests.noComments')} hint={t('common.emptyHint')} />
          ) : (
            comments.map((entry) => (
              <View
                key={entry.id}
                style={[
                  styles.comment,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                    borderRadius: theme.radius.lg,
                    padding: theme.spacing(3),
                  },
                ]}
              >
                <View style={styles.commentHeader}>
                  <Avatar firstName={entry.author?.firstName} lastName={entry.author?.lastName} size={32} />
                  <View style={styles.commentText}>
                    <Text style={[styles.commentAuthor, { color: theme.colors.text }]} numberOfLines={1}>
                      {entry.author ? fullName(entry.author) : t('leave.employee')}
                    </Text>
                    <Text style={[styles.commentMeta, { color: theme.colors.textMuted }]}>
                      {formatRelative(entry.createdAt, language)}
                    </Text>
                  </View>
                  {entry.isInternal ? <Badge label={t('requests.internalNote')} tone="warning" /> : null}
                </View>
                <Text style={[styles.commentBody, { color: theme.colors.text }]}>{entry.body}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title={t('requests.addComment')}>
          <Card>
            <TextField
              label={t('requests.comments')}
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={3}
              placeholder={t('requests.addComment')}
            />
            <Button
              title={t('requests.sendComment')}
              onPress={sendComment}
              loading={pending}
              disabled={pending || comment.trim().length === 0}
            />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  description: { fontSize: 14, lineHeight: 20 },
  comment: { borderWidth: 1, gap: 8, marginBottom: 10 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commentText: { flex: 1, gap: 2 },
  commentAuthor: { fontSize: 14, fontWeight: '600' },
  commentMeta: { fontSize: 12 },
  commentBody: { fontSize: 14 },
});
