import { useRouter } from 'expo-router';
import { Button } from '@/components/button';
import { NotificationPreferences } from '@/components/notification-preferences';
import { ScreenHeader, ScreenScroll } from '@/components/screen';
import { useI18n } from '@/i18n';

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <ScreenScroll>
      <ScreenHeader
        title={t('notifications.preferences')}
        action={
          <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
        }
      />
      <NotificationPreferences />
    </ScreenScroll>
  );
}
