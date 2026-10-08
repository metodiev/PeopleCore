import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { authApi } from '@/api/endpoints';
import type { MfaSetupResponse } from '@/api/types';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useAction } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function MfaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const mfaEnabled = useAuth((state) => state.user?.mfaEnabled ?? false);
  const { pending, error: actionError, run } = useAction();

  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const startSetup = () => {
    void (async () => {
      setMessage(null);
      setRecoveryCodes([]);
      const result = await run(() => authApi.mfaSetup());
      if (result === undefined) return;
      setSetup(result);
    })();
  };

  const enable = () => {
    void (async () => {
      setMessage(null);
      const result = await run(() => authApi.mfaEnable(code.trim()));
      if (result === undefined) return;
      setRecoveryCodes(result.recoveryCodes);
      setMessage(t('mfa.enabled'));
      setSetup(null);
      setCode('');
      await useAuth.getState().loadSession();
    })();
  };

  const disable = () => {
    void (async () => {
      setMessage(null);
      const result = await run(() => authApi.mfaDisable(disableCode.trim()));
      if (result === undefined) return;
      setMessage(t('mfa.disabled'));
      setDisableCode('');
      setRecoveryCodes([]);
      await useAuth.getState().loadSession();
    })();
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title={t('profile.mfa')}
          subtitle={mfaEnabled ? t('profile.mfaEnabled') : t('profile.mfaDisabled')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />

        {message ? <InlineMessage text={message} tone="success" /> : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        {mfaEnabled ? (
          <Section title={t('profile.disableMfaTitle')}>
            <Card>
              <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('profile.disableMfaHint')}</Text>
              <TextField
                label={t('auth.mfaCode')}
                value={disableCode}
                onChangeText={setDisableCode}
                keyboardType="number-pad"
                autoCapitalize="none"
              />
              <Button
                title={t('profile.disableMfa')}
                variant="danger"
                onPress={disable}
                loading={pending}
                disabled={pending || disableCode.trim().length < 6}
              />
            </Card>
          </Section>
        ) : (
          <Section title={t('profile.enableMfa')}>
            {setup ? (
              <Card>
                <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('profile.mfaSetupHint')}</Text>
                <View>
                  <KeyValue label={t('profile.secret')} value={setup.secret} />
                  <KeyValue label={t('profile.otpauthUrl')} value={setup.otpauthUrl} />
                </View>
                <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('profile.manualEntryHint')}</Text>
                <TextField
                  label={t('auth.mfaCode')}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />
                <Button
                  title={t('profile.verifyAndEnable')}
                  onPress={enable}
                  loading={pending}
                  disabled={pending || code.trim().length < 6}
                />
                <Button title={t('common.cancel')} variant="ghost" onPress={() => setSetup(null)} disabled={pending} />
              </Card>
            ) : (
              <Card>
                <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('profile.mfaSetupTitle')}</Text>
                <Button title={t('profile.enableMfa')} onPress={startSetup} loading={pending} disabled={pending} />
              </Card>
            )}
          </Section>
        )}

        {recoveryCodes.length > 0 ? (
          <Section title={t('profile.recoveryCodes')}>
            <Card>
              <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('profile.recoveryCodesHint')}</Text>
              {recoveryCodes.map((recoveryCode) => (
                <Text key={recoveryCode} style={[styles.code, { color: theme.colors.text }]}>
                  {recoveryCode}
                </Text>
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13 },
  code: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
