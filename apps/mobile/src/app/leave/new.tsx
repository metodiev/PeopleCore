import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { leaveApi } from '@/api/endpoints';
import type { LeaveType } from '@/api/types';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { SwitchRow } from '@/components/switch-row';
import { DateField, SelectField, TextField, type SelectOption } from '@/components/text-field';
import { LoadingState } from '@/components/states';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { todayKey } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function NewLeaveRequestScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { pending, error: actionError, run } = useAction();

  const typesQuery = useApiQuery<LeaveType[]>(() => leaveApi.types(), []);

  const [leaveTypeId, setLeaveTypeId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(todayKey());
  const [startHalfDay, setStartHalfDay] = useState(false);
  const [endHalfDay, setEndHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ type?: string; start?: string; end?: string }>({});
  const [submitted, setSubmitted] = useState(false);

  const options: SelectOption<string>[] = (typesQuery.data ?? []).map((type) => ({
    value: type.id,
    label: type.name,
  }));

  const submit = async () => {
    const nextErrors: typeof errors = {};
    if (!leaveTypeId) nextErrors.type = t('common.required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) nextErrors.start = t('common.required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) nextErrors.end = t('common.required');
    else if (startDate && endDate && endDate < startDate) nextErrors.end = t('leave.endDate');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !leaveTypeId) return;

    setSubmitted(false);
    const result = await run(() =>
      leaveApi.create({
        leaveTypeId,
        startDate,
        endDate,
        startHalfDay,
        endHalfDay,
        reason: reason.trim() || undefined,
      }),
    );
    if (result !== undefined) {
      setSubmitted(true);
      router.back();
    }
  };

  if (typesQuery.loading && !typesQuery.data) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={t('leave.requestTitle')} />

        {typesQuery.error && !typesQuery.data ? (
          <InlineMessage text={errorMessage(typesQuery.error)} />
        ) : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}
        {submitted ? <InlineMessage text={t('leave.requestSubmitted')} tone="success" /> : null}

        <Section title={t('leave.requestTitle')}>
          <Card>
            <SelectField<string>
              label={t('leave.leaveType')}
              value={leaveTypeId}
              options={options}
              onChange={setLeaveTypeId}
              error={errors.type ?? null}
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <DateField
                  label={t('leave.startDate')}
                  value={startDate}
                  onChange={(value) => {
                    setStartDate(value);
                    if (endDate < value) setEndDate(value);
                  }}
                  error={errors.start ?? null}
                />
              </View>
              <View style={styles.flex}>
                <DateField label={t('leave.endDate')} value={endDate} onChange={setEndDate} error={errors.end ?? null} minimumDate={startDate} />
              </View>
            </View>
            <SwitchRow label={t('leave.halfDayStart')} value={startHalfDay} onChange={setStartHalfDay} />
            <SwitchRow label={t('leave.halfDayEnd')} value={endHalfDay} onChange={setEndHalfDay} />
            <View style={styles.spacer} />
            <TextField
              label={`${t('leave.reason')} (${t('common.optional')})`}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
            />
            <Button title={t('leave.submitRequest')} onPress={submit} loading={pending} disabled={pending} />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => router.back()} disabled={pending} />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  spacer: { height: 4 },
});
