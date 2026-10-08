import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { ScreenScroll } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useI18n } from '@/i18n';
import { authenticateBiometric } from '@/lib/biometric';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const auth = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [showCompany, setShowCompany] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const submit = async () => {
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = t('common.required');
    if (!password) nextErrors.password = t('common.required');
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await auth.login(email.trim(), password, tenantSlug.trim() || undefined);
      if (result === 'mfa') {
        router.replace('/(auth)/mfa');
        return;
      }
      offerBiometric();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const offerBiometric = () => {
    const state = useAuth.getState();
    if (!state.biometricAvailable || state.biometricEnabled) return;
    Alert.alert(t('auth.enableBiometricTitle'), t('auth.enableBiometricHint'), [
      { text: t('auth.notNow'), style: 'cancel' },
      {
        text: t('auth.enableBiometric'),
        onPress: () => {
          void state.setBiometricEnabled(true);
        },
      },
    ]);
  };

  const unlock = async () => {
    setBioBusy(true);
    setError(null);
    const ok = await authenticateBiometric(t('auth.biometricPrompt'));
    if (!ok) {
      setError(t('auth.biometricFailed'));
      setBioBusy(false);
      return;
    }
    const unlocked = await useAuth.getState().unlockWithBiometrics();
    if (!unlocked) setError(t('auth.biometricFailed'));
    setBioBusy(false);
  };

  return (
    <ScreenScroll centered>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: theme.colors.brand }]}>
          <Text style={styles.logoLabel}>PC</Text>
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t('auth.signInTitle')}</Text>
        <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{t('auth.signInSubtitle')}</Text>
      </View>

      {auth.sessionError ? <InlineMessage text={auth.sessionError} tone="warning" /> : null}
      {error ? <InlineMessage text={error} tone="danger" /> : null}

      <Card>
        <TextField
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          placeholder="name@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          error={fieldErrors.email ?? null}
        />
        <TextField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          error={fieldErrors.password ?? null}
        />
        {showCompany ? (
          <TextField
            label={t('auth.companySlug')}
            value={tenantSlug}
            onChangeText={setTenantSlug}
            placeholder="acme"
            autoCapitalize="none"
            hint={t('auth.companySlugHint')}
          />
        ) : (
          <Button title={t('auth.companySlug')} variant="ghost" size="sm" onPress={() => setShowCompany(true)} fullWidth={false} />
        )}

        <Button title={t('auth.signInAction')} onPress={submit} loading={submitting} disabled={submitting} />

        {auth.biometricEnabled && auth.biometricAvailable ? (
          <Button
            title={t('auth.biometricUnlock')}
            variant="secondary"
            onPress={unlock}
            loading={bioBusy}
            disabled={bioBusy || submitting}
          />
        ) : null}
      </Card>

      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('app.tagline')}</Text>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, marginBottom: 24 },
  logo: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  logoLabel: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
});
