import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { leaveApi } from '@/api/endpoints';
import type { EmployeeSummary, LeaveBalancesResponse } from '@/api/types';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Avatar } from '@/components/list-item';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDate, formatDays, fullName } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

const RESOURCES = ['emergency-contacts', 'bank-accounts', 'education', 'skills', 'languages', 'notes'] as const;
type ProfileResource = (typeof RESOURCES)[number];

const SENSITIVE_RESOURCES: readonly ProfileResource[] = ['bank-accounts', 'notes'];

const RESOURCE_LABELS: Record<ProfileResource, MessageKey> = {
  'emergency-contacts': 'profile.resources.emergencyContacts',
  'bank-accounts': 'profile.resources.bankAccounts',
  education: 'profile.resources.education',
  skills: 'profile.resources.skills',
  languages: 'profile.resources.languages',
  notes: 'profile.resources.notes',
};

const CREATE_FIELDS: Record<ProfileResource, { key: string; label: MessageKey; required?: boolean }[]> = {
  'emergency-contacts': [
    { key: 'name', label: 'profile.fields.name', required: true },
    { key: 'relationship', label: 'profile.fields.relationship', required: true },
    { key: 'phone', label: 'profile.fields.phone', required: true },
  ],
  'bank-accounts': [{ key: 'accountHolder', label: 'profile.fields.name', required: true }],
  education: [
    { key: 'institution', label: 'profile.fields.institution', required: true },
    { key: 'degree', label: 'profile.fields.degree' },
    { key: 'fieldOfStudy', label: 'profile.fields.fieldOfStudy' },
  ],
  skills: [
    { key: 'name', label: 'profile.fields.skill', required: true },
    { key: 'level', label: 'profile.fields.level', required: true },
  ],
  languages: [
    { key: 'language', label: 'profile.fields.language', required: true },
    { key: 'level', label: 'profile.fields.level', required: true },
  ],
  notes: [{ key: 'body', label: 'profile.fields.note', required: true }],
};

const CREATE_DEFAULTS: Partial<Record<ProfileResource, Record<string, string>>> = {
  skills: { level: '3' },
  languages: { level: 'B2' },
};

type ProfileItem = Record<string, unknown>;

interface EmployeeRecord extends EmployeeSummary {
  phone?: string | null;
  birthDate?: string | null;
  user?: { id: string; email: string } | null;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function nested(value: unknown, key: string): string {
  return typeof value === 'object' && value !== null ? text((value as Record<string, unknown>)[key]) : '';
}

function itemSummary(resource: ProfileResource, item: ProfileItem): { title: string; subtitle: string } {
  switch (resource) {
    case 'emergency-contacts':
      return {
        title: text(item['name']),
        subtitle: [text(item['relationship']), text(item['phone'])].filter(Boolean).join(' · '),
      };
    case 'bank-accounts':
      return {
        title: text(item['bankName']) || text(item['accountHolder']),
        subtitle: text(item['ibanMasked']) || text(item['iban']),
      };
    case 'education':
      return {
        title: text(item['institution']),
        subtitle: [text(item['degree']), text(item['fieldOfStudy'])].filter(Boolean).join(' · '),
      };
    case 'skills':
      return {
        title: nested(item['skill'], 'name') || text(item['name']),
        subtitle: [nested(item['skill'], 'category') || text(item['category']), text(item['level'])]
          .filter(Boolean)
          .join(' · '),
      };
    case 'languages':
      return { title: text(item['language']), subtitle: text(item['level']) };
    default:
      return { title: text(item['visibility']), subtitle: text(item['body']) };
  }
}

async function loadResources(employeeId: string, resources: readonly ProfileResource[]): Promise<Partial<Record<ProfileResource, ProfileItem[]>>> {
  const pairs = await Promise.all(
    resources.map(async (resource) => {
      try {
        const items = await api.get<ProfileItem[]>(`/employees/${employeeId}/profile/${resource}`);
        return [resource, items] as const;
      } catch {
        return [resource, [] as ProfileItem[]] as const;
      }
    }),
  );
  return Object.fromEntries(pairs) as Partial<Record<ProfileResource, ProfileItem[]>>;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const employeeId = useAuth((state) => state.employeeId);
  const canSelfView = useAuth((state) => state.isSuperAdmin || state.permissions.includes('employees.self.view'));
  const canViewProfiles = useAuth((state) => state.isSuperAdmin || state.permissions.includes('employees.view'));
  const canEdit = useAuth((state) => state.isSuperAdmin || state.permissions.includes('employees.edit'));
  const canSeeSensitive = useAuth(
    (state) => state.isSuperAdmin || state.permissions.includes('employees.sensitive.view'),
  );
  const mfaEnabled = useAuth((state) => state.user?.mfaEnabled ?? false);
  const { pending, error: actionError, run } = useAction();

  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProfileResource | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const visibleResources = RESOURCES.filter(
    (resource) => !SENSITIVE_RESOURCES.includes(resource) || canSeeSensitive || canEdit,
  );

  const employeeQuery = useApiQuery<EmployeeRecord | null>(
    () => (canSelfView ? api.get<EmployeeRecord | null>('/employees/me') : Promise.resolve(null)),
    [canSelfView],
  );
  const balancesQuery = useApiQuery<LeaveBalancesResponse>(() => leaveApi.myBalances(), []);
  const resourcesQuery = useApiQuery<Partial<Record<ProfileResource, ProfileItem[]>>>(
    () => (canViewProfiles && employeeId ? loadResources(employeeId, visibleResources) : Promise.resolve({})),
    [canViewProfiles, employeeId],
  );

  const employee = employeeQuery.data ?? null;
  const balances = balancesQuery.data?.balances ?? [];

  const startAdding = (resource: ProfileResource) => {
    setAdding(resource);
    setFormValues(CREATE_DEFAULTS[resource] ?? {});
    setFormErrors({});
  };

  const submitItem = () => {
    if (!employeeId || !adding) return;
    const fields = CREATE_FIELDS[adding];
    const errors: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = (formValues[field.key] ?? '').trim();
      if (!value) {
        if (field.required) errors[field.key] = t('common.required');
        continue;
      }
      if (field.key === 'level' && adding === 'skills') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
          errors[field.key] = t('profile.levelHint');
          continue;
        }
        payload[field.key] = parsed;
        continue;
      }
      payload[field.key] = value;
    }
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    void (async () => {
      setMessage(null);
      const result = await run(() => api.post(`/employees/${employeeId}/profile/${adding}`, payload));
      if (result === undefined) return;
      setMessage(t('common.saved'));
      setAdding(null);
      await resourcesQuery.refetch();
    })();
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={employeeQuery.refreshing || balancesQuery.refreshing}
            onRefresh={() => {
              void employeeQuery.refetch();
              void balancesQuery.refetch();
              if (canViewProfiles) void resourcesQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        <ScreenHeader
          title={t('profile.title')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />

        {message ? <InlineMessage text={message} tone="success" /> : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        <Section title={t('profile.account')}>
          {employeeQuery.loading && !employeeQuery.data ? (
            <LoadingState />
          ) : employeeQuery.error && !employeeQuery.data ? (
            <ErrorState error={employeeQuery.error} onRetry={() => void employeeQuery.refetch()} />
          ) : employee ? (
            <Card>
              <View style={styles.identity}>
                <Avatar firstName={employee.firstName} lastName={employee.lastName} size={56} />
                <View style={styles.identityText}>
                  <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>
                    {fullName(employee)}
                  </Text>
                  <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                    {employee.position?.title ?? '—'}
                  </Text>
                </View>
              </View>
              <View>
                <KeyValue label={t('team.employeeNumber')} value={employee.employeeNumber} />
                <KeyValue label={t('team.department')} value={employee.department?.name} />
                <KeyValue label={t('team.location')} value={employee.location?.name} />
                <KeyValue label={t('team.manager')} value={employee.manager ? fullName(employee.manager) : null} />
                <KeyValue label={t('team.hireDate')} value={formatDate(employee.hireDate, language)} />
                <KeyValue label={t('profile.company')} value={employee.workEmail ?? employee.user?.email ?? null} />
              </View>
            </Card>
          ) : (
            <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
          )}
        </Section>

        <Section title={t('leave.balances')}>
          {balancesQuery.loading && !balancesQuery.data ? (
            <LoadingState />
          ) : balancesQuery.error && !balancesQuery.data ? (
            <ErrorState error={balancesQuery.error} onRetry={() => void balancesQuery.refetch()} />
          ) : balances.length === 0 ? (
            <EmptyState title={t('leave.noBalances')} hint={t('common.emptyHint')} />
          ) : (
            <Card>
              {balances.map((balance) => (
                <View key={balance.id} style={styles.balanceRow}>
                  <View style={[styles.dot, { backgroundColor: balance.color ?? theme.colors.brand }]} />
                  <Text style={[styles.balanceName, { color: theme.colors.text }]} numberOfLines={1}>
                    {balance.leaveType}
                  </Text>
                  <Text style={[styles.balanceValue, { color: theme.colors.text }]}>
                    {formatDays(balance.remaining, language)}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </Section>

        {canViewProfiles ? (
          <Section title={t('team.profile')}>
            {resourcesQuery.loading && !resourcesQuery.data ? (
              <LoadingState />
            ) : resourcesQuery.error && !resourcesQuery.data ? (
              <ErrorState error={resourcesQuery.error} onRetry={() => void resourcesQuery.refetch()} />
            ) : (
              visibleResources.map((resource) => {
                const items = resourcesQuery.data?.[resource] ?? [];
                return (
                  <Card key={resource} style={styles.resourceCard}>
                    <View style={styles.resourceHeader}>
                      <Text style={[styles.resourceTitle, { color: theme.colors.text }]}>
                        {t(RESOURCE_LABELS[resource])}
                      </Text>
                      {canEdit ? (
                        <Button
                          title={t('common.create')}
                          size="sm"
                          variant="secondary"
                          fullWidth={false}
                          onPress={() => startAdding(resource)}
                        />
                      ) : null}
                    </View>

                    {items.length === 0 ? (
                      <Text style={[styles.meta, { color: theme.colors.textMuted }]}>{t('common.empty')}</Text>
                    ) : (
                      items.map((item, index) => {
                        const summary = itemSummary(resource, item);
                        return (
                          <View key={text(item['id']) || index} style={styles.itemRow}>
                            <Text style={[styles.itemTitle, { color: theme.colors.text }]} numberOfLines={1}>
                              {summary.title || '—'}
                            </Text>
                            {summary.subtitle ? (
                              <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                                {summary.subtitle}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })
                    )}

                    {adding === resource ? (
                      <View style={styles.form}>
                        {CREATE_FIELDS[resource].map((field) => (
                          <TextField
                            key={field.key}
                            label={t(field.label)}
                            value={formValues[field.key] ?? ''}
                            onChangeText={(value) => setFormValues((state) => ({ ...state, [field.key]: value }))}
                            error={formErrors[field.key] ?? null}
                          />
                        ))}
                        <Button title={t('common.save')} onPress={submitItem} loading={pending} disabled={pending} />
                        <Button
                          title={t('common.cancel')}
                          variant="ghost"
                          onPress={() => setAdding(null)}
                          disabled={pending}
                        />
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </Section>
        ) : (
          <Section title={t('team.profile')}>
            <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
          </Section>
        )}

        <Section title={t('profile.security')}>
          <Card>
            <View style={styles.securityRow}>
              <View style={styles.identityText}>
                <Text style={[styles.itemTitle, { color: theme.colors.text }]}>{t('profile.mfa')}</Text>
                <Text style={[styles.meta, { color: theme.colors.textMuted }]}>
                  {mfaEnabled ? t('profile.mfaEnabled') : t('profile.mfaDisabled')}
                </Text>
              </View>
              <Badge label={mfaEnabled ? t('profile.mfaEnabled') : t('profile.mfaDisabled')} tone={mfaEnabled ? 'success' : 'neutral'} />
            </View>
            <Button title={t('profile.mfa')} variant="secondary" onPress={() => router.push('/profile/mfa')} />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, gap: 2 },
  name: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 12 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  balanceName: { flex: 1, fontSize: 14 },
  balanceValue: { fontSize: 15, fontWeight: '700' },
  resourceCard: { marginBottom: 12 },
  resourceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  resourceTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  itemRow: { paddingVertical: 6, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: '500' },
  form: { gap: 4, marginTop: 8 },
  securityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
