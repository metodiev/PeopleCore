import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { notificationsApi } from '@/api/endpoints';
import type { NotificationItem, Paginated } from '@/api/types';
import { CountBadge } from '@/components/badge';
import { Avatar, ListItem } from '@/components/list-item';
import { ScreenScroll, ScreenHeader } from '@/components/screen';
import { useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import { useNotificationsStore } from '@/store/notifications';

export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const user = useAuth((state) => state.user);
  const tenant = useAuth((state) => state.tenant);
  const unread = useNotificationsStore((state) => state.unread);
  const setUnread = useNotificationsStore((state) => state.setUnread);

  const unreadQuery = useApiQuery<Paginated<NotificationItem>>(
    () => notificationsApi.list({ unreadOnly: true, pageSize: 1 }),
    [],
  );

  useEffect(() => {
    if (unreadQuery.data) setUnread(unreadQuery.data.meta.total);
  }, [setUnread, unreadQuery.data]);

  const items = [
    { key: 'calendar', icon: 'calendar-outline', label: t('nav.calendar'), route: '/calendar', badge: 0 },
    { key: 'documents', icon: 'document-text-outline', label: t('nav.documents'), route: '/documents', badge: 0 },
    { key: 'notifications', icon: 'notifications-outline', label: t('nav.notifications'), route: '/notifications', badge: unread ?? 0 },
    { key: 'profile', icon: 'person-outline', label: t('nav.profile'), route: '/profile', badge: 0 },
    { key: 'team', icon: 'people-outline', label: t('nav.team'), route: '/team', badge: 0 },
    { key: 'settings', icon: 'settings-outline', label: t('nav.settings'), route: '/settings', badge: 0 },
  ] as const satisfies readonly {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    route: string;
    badge: number;
  }[];

  return (
    <ScreenScroll>
      <ScreenHeader title={t('nav.more')} subtitle={tenant?.name ?? t('app.name')} />

      <View
        style={[
          styles.identity,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            padding: theme.spacing(4),
            marginBottom: theme.spacing(4),
          },
        ]}
      >
        <Avatar firstName={user?.firstName} lastName={user?.lastName} size={56} />
        <View style={styles.identityText}>
          <Text style={[styles.identityName, { color: theme.colors.text }]} numberOfLines={1}>
            {fullName(user)}
          </Text>
          <Text style={[styles.identityMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {user?.email ?? '—'}
          </Text>
        </View>
      </View>

      {items.map((item) => (
        <View key={item.key} style={styles.row}>
          <ListItem
            title={item.label}
            leading={
              <View style={[styles.iconBubble, { backgroundColor: theme.colors.brandSoft }]}>
                <Ionicons name={item.icon} size={20} color={theme.colors.brandOnSoft} />
              </View>
            }
            trailing={item.badge > 0 ? <CountBadge count={item.badge} /> : undefined}
            onPress={() => router.push(item.route)}
          />
        </View>
      ))}

      <Text style={[styles.footer, { color: theme.colors.textMuted }]}>
        {t('app.name')} · {t('app.tagline')}
      </Text>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, gap: 2 },
  identityName: { fontSize: 17, fontWeight: '700' },
  identityMeta: { fontSize: 13 },
  row: { marginBottom: 10 },
  iconBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  footer: { fontSize: 12, textAlign: 'center', marginTop: 24 },
});
