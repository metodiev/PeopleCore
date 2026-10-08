import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { notificationsApi } from '@/api/endpoints';

type NotificationsModule = typeof import('expo-notifications');

/** True when the app runs inside Expo Go. `expoGoConfig` is only populated there. */
function isExpoGo(): boolean {
  return Boolean(Constants.expoGoConfig);
}

let cached: NotificationsModule | null | undefined;

/**
 * Loads `expo-notifications` on demand.
 *
 * The module can *throw on import* (Android in Expo Go, where remote push was
 * removed in SDK 53) and this code is reachable from the root route module, so
 * importing it at the top level would take down the entire route tree. Every use
 * therefore goes through here and degrades to `null`.
 */
async function loadNotifications(): Promise<NotificationsModule | null> {
  if (cached !== undefined) return cached;
  if (isExpoGo()) {
    cached = null;
    return null;
  }
  try {
    cached = (await import('expo-notifications')) as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Foreground presentation for push notifications. Never throws. */
export async function configureNotificationHandler(): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications) return;
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Notifications are optional; never let them break the app.
  }
}

/**
 * Subscribes to notifications received while the app is foregrounded.
 * Returns an unsubscribe function; a no-op when notifications are unavailable.
 */
export async function subscribeToForegroundNotifications(onNotification: () => void): Promise<() => void> {
  const notifications = await loadNotifications();
  if (!notifications) return () => undefined;
  try {
    const subscription = notifications.addNotificationReceivedListener(() => onNotification());
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}

/**
 * Registers the device's Expo push token with the API.
 * Returns `null` when notifications are unavailable (Expo Go, simulator, denied
 * permission, missing EAS project id) — notification support is optional and
 * never blocks sign-in.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const notifications = await loadNotifications();
  if (!notifications) return null;

  try {
    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: notifications.AndroidImportance.DEFAULT,
      });
    }

    const current = await notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;

    const { data: token } = await notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    await notificationsApi.registerDevice({
      token,
      platform: Platform.OS,
      deviceName: Device.deviceName ?? undefined,
    });
    return token;
  } catch {
    return null;
  }
}
