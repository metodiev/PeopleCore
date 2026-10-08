import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from './badge';
import { initials } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export function Avatar({
  firstName,
  lastName,
  size = 40,
}: {
  firstName?: string | null;
  lastName?: string | null;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.brandSoft,
        },
      ]}
    >
      <Text style={[styles.avatarLabel, { color: theme.colors.brandOnSoft, fontSize: size * 0.38 }]}>
        {initials(firstName, lastName)}
      </Text>
    </View>
  );
}

interface ListItemProps {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  badge?: { label: string; tone?: Parameters<typeof Badge>[0]['tone'] } | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  showAvatar?: boolean;
}

/** Standard list row: avatar, title/subtitle/meta, status badge and trailing slot. */
export function ListItem({
  title,
  subtitle,
  meta,
  badge,
  leading,
  trailing,
  onPress,
  showAvatar = false,
}: ListItemProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed && onPress ? theme.colors.surfaceMuted : theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: theme.spacing(3),
        },
      ]}
    >
      {leading ?? (showAvatar ? <Avatar firstName={title.split(' ')[0]} lastName={title.split(' ')[1]} /> : null)}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {badge ? <Badge label={badge.label} tone={badge.tone ?? 'neutral'} /> : null}
        </View>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  subtitle: { fontSize: 13 },
  meta: { fontSize: 12 },
  trailing: { alignItems: 'flex-end' },
});
