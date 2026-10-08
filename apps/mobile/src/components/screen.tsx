import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

interface ScreenProps {
  children: ReactNode;
  /** Adds horizontal + vertical padding when the content is not a list. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Vertically centres content (used by auth screens). */
  centered?: boolean;
}

/** Safe-area aware screen wrapper used by every route. */
export function Screen({ children, padded = true, style, centered = false }: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <View
        style={[
          styles.content,
          padded && { padding: theme.spacing(4) },
          centered && styles.centered,
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

/** Scrollable screen wrapper with keyboard-friendly behaviour. */
export function ScreenScroll({ children, style, padded = true }: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[padded && { padding: theme.spacing(4) }, styles.scrollContent, style]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Page heading with optional trailing action. */
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { marginBottom: theme.spacing(3) }]}>
      <View style={styles.headerText}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1 },
  centered: { justifyContent: 'center' },
  scrollContent: { flexGrow: 1, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
});
