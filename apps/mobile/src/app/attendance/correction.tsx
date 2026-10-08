import type { AttendanceStatus } from '@peoplecore/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { attendanceApi } from '@/api/endpoints';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { useStatusLabels } from '@/components/status';
import { DateField, SelectField, TextField, type SelectOption } from '@/components/text-field';
import { useAction } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { addDaysKey, todayKey } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const CORRECTABLE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'HALF_DAY', 'REMOTE'];
const TIME_PATTERN = /^\d{1,2}:\d{2}$/;

export default function AttendanceCorrectionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const labels = useStatusLabels();
  const { pending, error: actionError, run } = useAction();

  const [date, setDate] = useState(addDaysKey(todayKey(), -1));
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ date?: string; reason?: string; punch?: string }>({});
  const [submitted, setSubmitted] = useState(false);

  const statusOptions: SelectOption<AttendanceStatus>[] = CORRECTABLE_STATUSES.map((value) => ({
    value,
    label: labels.attendanceStatus(value),
  }));

  const submit = async () => {
    const nextErrors: typeof errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) nextErrors.date = t('common.required');
    if (!reason.trim()) nextErrors.reason = t('common.required');

    const requestedClockIn = clockIn.trim();
    const requestedClockOut = clockOut.trim();
    if (!requestedClockIn && !requestedClockOut && !status) {
      nextErrors.punch = t('attendance.correctionPunchRequired');
    } else if (
      (requestedClockIn && !TIME_PATTERN.test(requestedClockIn)) ||
      (requestedClockOut && !TIME_PATTERN.test(requestedClockOut))
    ) {
      nextErrors.punch = t('attendance.timeFormatHint');
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await run(() =>
      attendanceApi.createCorrection({
        date,
        requestedClockIn: requestedClockIn || undefined,
        requestedClockOut: requestedClockOut || undefined,
        requestedStatus: status ?? undefined,
        reason: reason.trim(),
      }),
    );
    if (result !== undefined) {
      setSubmitted(true);
      router.back();
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={t('attendance.correctionTitle')} subtitle={t('attendance.correction')} />

        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}
        {submitted ? <InlineMessage text={t('attendance.correctionSubmitted')} tone="success" /> : null}

        <Section title={t('attendance.correction')}>
          <Card>
            <DateField
              label={t('attendance.correctionDate')}
              value={date}
              onChange={setDate}
              error={errors.date ?? null}
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <TextField
                  label={t('attendance.requestedClockIn')}
                  value={clockIn}
                  onChangeText={setClockIn}
                  placeholder="09:00"
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  error={errors.punch ?? null}
                  hint={t('attendance.timeFormatHint')}
                />
              </View>
              <View style={styles.flex}>
                <TextField
                  label={t('attendance.requestedClockOut')}
                  value={clockOut}
                  onChangeText={setClockOut}
                  placeholder="17:30"
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <SelectField<AttendanceStatus>
              label={`${t('attendance.requestedStatus')} (${t('common.optional')})`}
              value={status}
              options={statusOptions}
              onChange={setStatus}
            />
            <TextField
              label={t('attendance.correctionReason')}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              error={errors.reason ?? null}
            />
            <Button title={t('attendance.submitCorrection')} onPress={submit} loading={pending} disabled={pending} />
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
});
