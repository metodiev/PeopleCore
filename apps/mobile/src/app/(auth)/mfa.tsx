import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { ScreenScroll } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useI18n } from '@/i18n';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function MfaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const completeMfa = useAuth((state) => state.completeMfa);
  const cancelMfa = useAuth((state) => state.cancelMfa);

  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (code.trim().length < 6) {
      setError(t('mfa.codeLength'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await completeMfa(code.trim());
      router.replace('/(tabs)');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenScroll centered>
      <View style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: theme.colors.brandSoft }]}>
          <Text style={{ color: theme.colors.brandOnSoft, fontWeight: '800' }}>2FA</Text>
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t('auth.mfaTitle')}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{t('auth.mfaSubtitle')}</Text>
      </View>

      {error ? <InlineMessage text={error} /> : null}

      <Card>
        <TextField
          label={recovery ? t('auth.recoveryCode') : t('auth.mfaCode')}
          value={code}
          onChangeText={setCode}
          placeholder={recovery ? 'XXXX-XXXX' : '123456'}
          keyboardType={recovery ? 'default' : 'number-pad'}
          autoCapitalize="characters"
          error={null}
        />
        <Button title={t('auth.verify')} onPress={submit} loading={submitting} disabled={submitting} />
        <Button
          title={recovery ? t('auth.useAuthenticatorCode') : t('auth.useRecoveryCode')}
          variant="ghost"
          size="sm"
          onPress={() => {
            setRecovery((value) => !value);
            setCode('');
            setError(null);
          }}
        />
        <Button
          title={t('common.cancel')}
          variant="secondary"
          onPress={() => {
            cancelMfa();
            router.replace('/(auth)/login');
          }}
        />
      </Card>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, marginBottom: 24 },
  badge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center' },
});
