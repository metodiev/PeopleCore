import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from './button';
import { useI18n } from '@/i18n';
import { errorMessage } from '@/api/client';
import { useTheme } from '@/lib/theme';

export function LoadingState({ label }: { label?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.colors.brand} />
      <Text style={[styles.text, { color: theme.colors.textMuted }]}>{label ?? t('common.loading')}</Text>
    </View>
  );
}

export function EmptyState({ title, hint }: { title?: string; hint?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing(6),
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>{title ?? t('common.empty')}</Text>
      <Text style={[styles.text, { color: theme.colors.textMuted }]}>{hint ?? t('common.emptyHint')}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const message = errorMessage(error);
  const isNetwork = typeof error === 'object' && error !== null && (error as { status?: number }).status === 0;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing(6),
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.colors.danger }]}>{t('common.error')}</Text>
      <Text style={[styles.text, { color: theme.colors.textMuted }]}>
        {isNetwork ? t('common.networkError') : message}
      </Text>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  card: { borderWidth: 1, alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  text: { fontSize: 14, textAlign: 'center' },
});
