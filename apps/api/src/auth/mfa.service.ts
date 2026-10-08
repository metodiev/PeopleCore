import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnauthorizedError } from '../common/errors/app-error.js';
import { CryptoService, randomToken, sha256 } from '../common/utils/crypto.util.js';

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
}

const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP-based multi-factor authentication (Google Authenticator, Authy, 1Password…)
 * with single-use recovery codes. Secrets are encrypted at rest; recovery codes
 * are stored as hashes only.
 */
@Injectable()
export class MfaService {
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
  }

  /** Creates (or replaces) a pending TOTP secret — not active until verified. */
  async beginSetup(userId: string, email: string, companyName: string): Promise<MfaSetupResult> {
    const secret = generateSecret();
    await this.prisma.raw.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: this.crypto.encrypt(secret), mfaEnabled: false, mfaEnabledAt: null },
    });
    const otpauthUrl = generateURI({ issuer: `PeopleCore (${companyName})`, label: email, secret });
    return { secret, otpauthUrl };
  }

  /** Confirms the TOTP code and activates MFA, returning fresh recovery codes. */
  async enable(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.raw.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEnc) {
      throw new UnauthorizedError('Start MFA setup first', 'MFA_SETUP_REQUIRED');
    }
    const secret = this.crypto.decrypt(user.mfaSecretEnc);
    if (!(await this.isValidTotp(secret, code))) {
      throw new UnauthorizedError('Invalid verification code', 'MFA_CODE_INVALID');
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(9));
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({
        where: { id: userId },
        data: { mfaEnabled: true, mfaEnabledAt: new Date() },
      }),
      this.prisma.raw.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.raw.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((codeValue) => ({
          userId,
          codeHash: sha256(normalizeRecoveryCode(codeValue)),
        })),
      }),
    ]);
    return { recoveryCodes };
  }

  async disable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.raw.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled) return;
    if (!(await this.verify(userId, code))) {
      throw new UnauthorizedError('Invalid verification code', 'MFA_CODE_INVALID');
    }
    await this.prisma.raw.$transaction([
      this.prisma.raw.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnabledAt: null },
      }),
      this.prisma.raw.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  /** Accepts a TOTP code or a single-use recovery code. */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.raw.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) return false;

    const secret = this.crypto.decrypt(user.mfaSecretEnc);
    if (await this.isValidTotp(secret, code)) return true;

    const recovery = await this.prisma.raw.mfaRecoveryCode.findFirst({
      where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null },
    });
    if (!recovery) return false;
    await this.prisma.raw.mfaRecoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } });
    return true;
  }

  async regenerateRecoveryCodes(userId: string): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(9));
    await this.prisma.raw.$transaction([
      this.prisma.raw.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.raw.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((codeValue) => ({
          userId,
          codeHash: sha256(normalizeRecoveryCode(codeValue)),
        })),
      }),
    ]);
    return { recoveryCodes };
  }

  private async isValidTotp(secret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code.trim())) return false;
    try {
      const result = await verifyTotp({ secret, token: code.trim() });
      return result.valid;
    } catch {
      return false;
    }
  }
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}

/** Generates a stable device-independent hash for logging/audit purposes. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** Cryptographically strong numeric code (for SMS/email OTP fallbacks). */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return (Number(randomBytes(4).readUInt32BE(0) % max) + '').padStart(digits, '0');
}
