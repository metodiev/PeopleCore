import type { Language } from '@/i18n';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Card, KeyValue, Section } from '@/components/card';
import { NotificationPreferences } from '@/components/notification-preferences';
import { ScreenHeader, ScreenScroll } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { SwitchRow } from '@/components/switch-row';
import { useI18n } from '@/i18n';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language, setLanguage } = useI18n();
  const user = useAuth((state) => state.user);
  const tenant = useAuth((state) => state.tenant);
  const roles = useAuth((state) => state.roles);
  const biometricEnabled = useAuth((state) => state.biometricEnabled);
  const biometricAvailable = useAuth((state) => state.biometricAvailable);
  const setBiometricEnabled = useAuth((state) => state.setBiometricEnabled);
  const logout = useAuth((state) => state.logout);

  const confirmSignOut = () => {
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.no'), style: 'cancel' },
      { text: t('common.yes'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <ScreenScroll>
      <ScreenHeader
        title={t('nav.settings')}
        action={
          <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
        }
      />

      {user ? (
        <Card style={styles.identity}>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>
              {user.email}
            </Text>
            <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {[tenant?.name, ...roles].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Card>
      ) : null}

      <Section title={t('profile.language')}>
        <Segmented<Language>
          value={language}
          onChange={(value) => setLanguage(value)}
          options={[
            { value: 'bg', label: t('profile.bulgarian') },
            { value: 'en', label: t('profile.english') },
          ]}
        />
      </Section>

      <Section title={t('profile.security')}>
        <Card>
          <SwitchRow
            label={t('profile.biometrics')}
            hint={biometricAvailable ? t('profile.biometricsHint') : t('auth.biometricUnavailable')}
            value={biometricEnabled}
            disabled={!biometricAvailable}
            onChange={(value) => {
              void setBiometricEnabled(value);
            }}
          />
        </Card>
        <Button
          title={t('profile.mfa')}
          variant="secondary"
          onPress={() => router.push('/profile/mfa')}
        />
      </Section>

      <Section title={t('notifications.preferences')}>
        <NotificationPreferences />
      </Section>

      <Section title={t('profile.account')}>
        <Card>
          <KeyValue label={t('auth.email')} value={user?.email ?? null} />
          <KeyValue label={t('profile.company')} value={tenant?.name ?? null} />
          <KeyValue label={t('profile.language')} value={language === 'bg' ? t('profile.bulgarian') : t('profile.english')} />
        </Card>
        <Button title={t('profile.signOut')} variant="danger" onPress={confirmSignOut} />
      </Section>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  identity: { marginBottom: 16 },
  identityText: { gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },
});
