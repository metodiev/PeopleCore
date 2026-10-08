import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Button } from './button';
import { useI18n } from '@/i18n';
import { addDaysKey, todayKey } from '@/lib/format';
import { useTheme } from '@/lib/theme';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  numberOfLines?: number;
  error?: string | null;
  hint?: string | null;
  editable?: boolean;
  autoComplete?: 'email' | 'password' | 'off';
  textContentType?: 'emailAddress' | 'password' | 'none';
  style?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType,
  autoCapitalize = 'sentences',
  multiline = false,
  numberOfLines = 4,
  error,
  hint,
  editable = true,
  autoComplete = 'off',
  textContentType = 'none',
  style,
}: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : undefined}
        editable={editable}
        autoComplete={autoComplete}
        textContentType={textContentType}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            color: theme.colors.text,
            borderRadius: theme.radius.md,
            minHeight: multiline ? 96 : 46,
          },
          !editable && { opacity: 0.6 },
        ]}
      />
      {error ? <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text> : null}
      {!error && hint ? <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/** Date input with quick picks — values are `YYYY-MM-DD`, matching the API. */
export function DateField({
  label,
  value,
  onChange,
  error,
  minimumDate,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  minimumDate?: string;
}) {
  const theme = useTheme();
  const [quick, setQuick] = useState<string[]>([]);

  useEffect(() => {
    const today = todayKey();
    const options = [today, addDaysKey(today, 1), addDaysKey(today, 7)];
    setQuick(minimumDate ? options.filter((option) => option >= minimumDate) : options);
  }, [minimumDate]);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            color: theme.colors.text,
            borderRadius: theme.radius.md,
          },
        ]}
      />
      <View style={styles.quickRow}>
        {quick.map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.quickChip,
              {
                borderColor: option === value ? theme.colors.brand : theme.colors.border,
                backgroundColor: option === value ? theme.colors.brandSoft : theme.colors.surface,
                borderRadius: theme.radius.pill,
              },
            ]}
          >
            <Text style={[styles.quickLabel, { color: option === value ? theme.colors.brandOnSoft : theme.colors.textMuted }]}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** Modal option picker used for enums (leave type, HR request type, priority…). */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          styles.input,
          styles.selectRow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radius.md,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        <Text
          style={[styles.selectValue, { color: selected ? theme.colors.text : theme.colors.textMuted }]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder ?? t('common.none')}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>▾</Text>
      </Pressable>
      {error ? <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{label}</Text>
            <ScrollView style={styles.modalList}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    {
                      borderBottomColor: theme.colors.border,
                      backgroundColor: option.value === value ? theme.colors.brandSoft : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.optionLabel, { color: theme.colors.text }]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button title={t('common.close')} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  error: { fontSize: 12 },
  hint: { fontSize: 12 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  quickLabel: { fontSize: 12 },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectValue: { flex: 1, fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end' },
  modalSheet: { borderTopWidth: 1, padding: 16, maxHeight: '70%', gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalList: { maxHeight: 360 },
  option: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  optionLabel: { fontSize: 15 },
});
