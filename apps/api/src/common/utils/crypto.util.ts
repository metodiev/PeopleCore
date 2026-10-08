import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM encryption for sensitive values stored at rest (MFA secrets,
 * OAuth tokens, national IDs, IBANs). Format: `v1.<iv>.<tag>.<ciphertext>`
 * with base64url encoding.
 */
export class CryptoService {
  private readonly key: Buffer;

  constructor(encryptionKeyBase64: string) {
    const key = Buffer.from(encryptionKeyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    const [version, ivPart, tagPart, dataPart] = parts;
    // `dataPart` may legitimately be empty when the plaintext was an empty string.
    if (parts.length !== 4 || version !== 'v1' || !ivPart || !tagPart) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** Encrypts when a value is present, otherwise returns null. */
  encryptOptional(value: string | null | undefined): string | null {
    return value ? this.encrypt(value) : null;
  }

  decryptOptional(value: string | null | undefined): string | null {
    return value ? this.decrypt(value) : null;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token (default 32 bytes ≈ 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
