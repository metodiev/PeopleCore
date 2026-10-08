import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricCapability {
  available: boolean;
  /** 'face' | 'fingerprint' | 'iris' | 'biometric' — best-effort label for the UI. */
  kind: string | null;
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const kind = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? 'face'
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ? 'fingerprint'
        : types.includes(LocalAuthentication.AuthenticationType.IRIS)
          ? 'iris'
          : types.length > 0
            ? 'biometric'
            : null;
    return { available: hasHardware && enrolled, kind };
  } catch {
    return { available: false, kind: null };
  }
}

/** Prompts for Face ID / Touch ID / fingerprint. Returns false when cancelled or unavailable. */
export async function authenticateBiometric(promptMessage = 'Confirm your identity to continue'): Promise<boolean> {
  try {
    const capability = await getBiometricCapability();
    if (!capability.available) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
