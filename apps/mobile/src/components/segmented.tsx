import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/lib/theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Horizontal segmented filter used for status filters. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.chip,
              {
                borderColor: active ? theme.colors.brand : theme.colors.border,
                backgroundColor: active ? theme.colors.brand : theme.colors.surface,
                borderRadius: theme.radius.pill,
              },
            ]}
          >
            <Text style={[styles.label, { color: active ? '#ffffff' : theme.colors.textMuted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  label: { fontSize: 13, fontWeight: '600' },
});
