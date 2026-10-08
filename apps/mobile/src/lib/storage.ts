import * as SecureStore from 'expo-secure-store';

/** Keys used for the persisted mobile session. */
export const StorageKeys = {
  accessToken: 'peoplecore.accessToken',
  refreshToken: 'peoplecore.refreshToken',
  language: 'peoplecore.language',
  biometricEnabled: 'peoplecore.biometricEnabled',
} as const;

export async function readSecure(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeSecure(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Secure storage is best-effort: a locked keychain must not break the app.
  }
}
