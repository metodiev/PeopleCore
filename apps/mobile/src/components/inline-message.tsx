import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type Tone } from '@/lib/theme';

/** Inline feedback banner for mutation errors and success messages. */
export function InlineMessage({ text, tone = 'danger' }: { text: string; tone?: Tone }) {
  const theme = useTheme();
  const palette: Record<Tone, { fg: string; bg: string }> = {
    neutral: { fg: theme.colors.textMuted, bg: theme.colors.neutralSoft },
    brand: { fg: theme.colors.brandOnSoft, bg: theme.colors.brandSoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
  };
  const colors = palette[tone];
  return (
    <View style={[styles.container, { backgroundColor: colors.bg, borderRadius: theme.radius.md }]}>
      <Text style={[styles.text, { color: colors.fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, marginBottom: 12 },
  text: { fontSize: 13, fontWeight: '500' },
});
