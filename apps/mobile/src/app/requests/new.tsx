import type { HRRequestPriority, HRRequestType } from '@peoplecore/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { errorMessage } from '@/api/client';
import { hrRequestsApi } from '@/api/endpoints';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { useStatusLabels } from '@/components/status';
import { DateField, SelectField, TextField, type SelectOption } from '@/components/text-field';
import { useAction } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { useTheme } from '@/lib/theme';

const TYPES: HRRequestType[] = ['HR', 'CERTIFICATE', 'DOCUMENT', 'PAYROLL', 'EQUIPMENT', 'REMOTE_WORK', 'IT', 'OTHER'];
const PRIORITIES: HRRequestPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export default function NewHrRequestScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const labels = useStatusLabels();
  const { pending, error: actionError, run } = useAction();

  const [type, setType] = useState<HRRequestType | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<HRRequestPriority>('NORMAL');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<{ type?: string; subject?: string; description?: string }>({});
  const [submitted, setSubmitted] = useState(false);

  const typeOptions: SelectOption<HRRequestType>[] = TYPES.map((value) => ({
    value,
    label: labels.requestType(value),
  }));
  const priorityOptions: SelectOption<HRRequestPriority>[] = PRIORITIES.map((value) => ({
    value,
    label: labels.requestPriority(value),
  }));

  const submit = async () => {
    const nextErrors: typeof errors = {};
    if (!type) nextErrors.type = t('common.required');
    if (subject.trim().length < 3) nextErrors.subject = t('requests.minLength');
    if (description.trim().length < 3) nextErrors.description = t('requests.minLength');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !type) return;

    const result = await run(() =>
      hrRequestsApi.create({
        type,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : undefined,
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
        <ScreenHeader title={t('requests.newRequest')} subtitle={t('requests.title')} />

        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}
        {submitted ? <InlineMessage text={t('requests.requestCreated')} tone="success" /> : null}

        <Section title={t('requests.detail')}>
          <Card>
            <SelectField<HRRequestType>
              label={t('requests.requestType')}
              value={type}
              options={typeOptions}
              onChange={setType}
              error={errors.type ?? null}
            />
            <TextField
              label={t('requests.subject')}
              value={subject}
              onChangeText={setSubject}
              error={errors.subject ?? null}
            />
            <TextField
              label={t('requests.description')}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              error={errors.description ?? null}
            />
            <SelectField<HRRequestPriority>
              label={t('requests.priority')}
              value={priority}
              options={priorityOptions}
              onChange={setPriority}
            />
            <DateField label={`${t('requests.dueDate')} (${t('common.optional')})`} value={dueDate} onChange={setDueDate} />
            <Button title={t('requests.submit')} onPress={submit} loading={pending} disabled={pending} />
            <Button title={t('common.cancel')} variant="ghost" onPress={() => router.back()} disabled={pending} />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}
