import { StyleSheet, Text, View } from 'react-native';
import { toneColors, useTheme, type Tone } from '@/lib/theme';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme();
  const { fg, bg } = toneColors(theme, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderRadius: theme.radius.pill }]}>
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Small numeric count bubble (tab bars, list items, dashboard cards). */
export function CountBadge({ count }: { count: number }) {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.count, { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill }]}>
      <Text style={styles.countLabel}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  label: { fontSize: 12, fontWeight: '600' },
  count: { minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countLabel: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
});
