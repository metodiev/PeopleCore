import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoadingState } from '@/components/states';
import { useI18nStore } from '@/i18n';
import {
  configureNotificationHandler,
  registerForPushNotifications,
  subscribeToForegroundNotifications,
} from '@/lib/push';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';
import { useNotificationsStore } from '@/store/notifications';

export default function RootLayout() {
  const theme = useTheme();
  const status = useAuth((state) => state.status);
  const userId = useAuth((state) => state.user?.id ?? null);
  const hydrate = useAuth((state) => state.hydrate);
  const hydrateLanguage = useI18nStore((state) => state.hydrate);
  const bumpNotifications = useNotificationsStore((state) => state.bump);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void hydrateLanguage();
    void hydrate();
  }, [hydrate, hydrateLanguage]);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    void registerForPushNotifications();
  }, [status, userId]);

  useEffect(() => {
    void configureNotificationHandler();
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void subscribeToForegroundNotifications(bumpNotifications).then((off) => {
      if (cancelled) {
        off();
      } else {
        unsubscribe = off;
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bumpNotifications]);

  useEffect(() => {
    if (status === 'loading') return;
    const group = segments[0];
    const inAuthGroup = group === '(auth)';
    // `useSegments()` is typed as a tuple of the current route only; the group
    // is index 0, so the screen name inside it is read through a widened view.
    const route: string | undefined = (segments as readonly string[])[1];

    if (status === 'anonymous' && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (status === 'mfa' && route !== 'mfa') {
      router.replace('/(auth)/mfa');
    } else if (status === 'authenticated' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [router, segments, status]);

  if (status === 'loading') {
    return (
      <SafeAreaProvider>
        <LoadingState />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="leave/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="attendance/correction" options={{ presentation: 'modal' }} />
        <Stack.Screen name="requests/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications/preferences" />
        <Stack.Screen name="profile/mfa" options={{ presentation: 'modal' }} />
        <Stack.Screen name="calendar" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="team" />
      </Stack>
    </SafeAreaProvider>
  );
}
