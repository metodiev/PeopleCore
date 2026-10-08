/**
 * Typed application configuration. Values come from environment variables and
 * are validated once at boot — fail fast, never at request time.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

export type DatabaseDriver = 'postgres' | 'pglite';
export type MailDriver = 'console' | 'smtp';
export type StorageDriver = 'local' | 's3';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  /** When set, the API listens on a Unix domain socket instead of TCP. */
  listenSocket?: string;
  apiPrefix: string;
  apiVersion: string;
  webAppUrl: string;
  corsOrigins: string[];
  database: {
    driver: DatabaseDriver;
    url: string;
    shadowUrl?: string;
    /** Directory for the embedded PGlite database (dev/test without Docker). */
    pgliteDir?: string;
  };
  redisUrl?: string;
  auth: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  encryptionKey: string;
  mail: {
    driver: MailDriver;
    from: string;
    smtp: { host?: string; port: number; user?: string; password?: string; secure: boolean };
  };
  storage: {
    driver: StorageDriver;
    localPath: string;
    s3: {
      endpoint?: string;
      region?: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
      signedUrlTtl: number;
    };
  };
  oauth: {
    google: { clientId?: string; clientSecret?: string; redirectUri?: string };
    microsoft: { clientId?: string; clientSecret?: string; tenantId: string; redirectUri?: string };
  };
  samlCertificate?: string;
  expoAccessToken?: string;
  logLevel: string;
  sentryDsn?: string;
}

const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=';

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  const isProduction = nodeEnv === 'production';
  const databaseUrl = env.DATABASE_URL ?? 'postgresql://peoplecore:peoplecore@localhost:5432/peoplecore';
  const driver: DatabaseDriver =
    env.DATABASE_DRIVER === 'pglite' || databaseUrl.startsWith('pglite:') ? 'pglite' : 'postgres';

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    port: int(env.PORT, 4000),
    listenSocket: env.LISTEN_SOCKET || undefined,
    apiPrefix: env.API_PREFIX ?? 'api',
    apiVersion: env.API_VERSION ?? '1',
    webAppUrl: env.WEB_APP_URL ?? 'http://localhost:5173',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8081')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    database: {
      driver,
      url: databaseUrl,
      shadowUrl: env.SHADOW_DATABASE_URL || undefined,
      pgliteDir: env.PGLITE_DATA_DIR || './.pgdata',
    },
    redisUrl: env.REDIS_URL || undefined,
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET ?? '',
      refreshSecret: env.JWT_REFRESH_SECRET ?? '',
      accessTtl: env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: env.JWT_REFRESH_TTL ?? '30d',
    },
    encryptionKey: env.ENCRYPTION_KEY || (isProduction ? '' : DEV_ENCRYPTION_KEY),
    mail: {
      driver: (env.MAIL_DRIVER as MailDriver) === 'smtp' ? 'smtp' : 'console',
      from: env.MAIL_FROM ?? 'PeopleCore <no-reply@peoplecore.local>',
      smtp: {
        host: env.SMTP_HOST || undefined,
        port: int(env.SMTP_PORT, 587),
        user: env.SMTP_USER || undefined,
        password: env.SMTP_PASSWORD || undefined,
        secure: bool(env.SMTP_SECURE),
      },
    },
    storage: {
      driver: (env.STORAGE_DRIVER as StorageDriver) === 's3' ? 's3' : 'local',
      localPath: env.STORAGE_LOCAL_PATH ?? './storage/documents',
      s3: {
        endpoint: env.S3_ENDPOINT || undefined,
        region: env.S3_REGION || undefined,
        bucket: env.S3_BUCKET || undefined,
        accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
        forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
        signedUrlTtl: int(env.S3_SIGNED_URL_TTL, 900),
      },
    },
    oauth: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || undefined,
        clientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
        redirectUri: env.GOOGLE_REDIRECT_URI || undefined,
      },
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID || undefined,
        clientSecret: env.MICROSOFT_CLIENT_SECRET || undefined,
        tenantId: env.MICROSOFT_TENANT_ID ?? 'common',
        redirectUri: env.MICROSOFT_REDIRECT_URI || undefined,
      },
    },
    samlCertificate: env.SAML_CERTIFICATE || undefined,
    expoAccessToken: env.EXPO_ACCESS_TOKEN || undefined,
    logLevel: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    sentryDsn: env.SENTRY_DSN || undefined,
  };

  validateConfig(config);
  return config;
}

function validateConfig(config: AppConfig): void {
  const problems: string[] = [];

  if (config.auth.accessSecret.length < 32) {
    problems.push('JWT_ACCESS_SECRET must be at least 32 characters');
  }
  if (config.auth.refreshSecret.length < 32) {
    problems.push('JWT_REFRESH_SECRET must be at least 32 characters');
  }
  if (!config.encryptionKey) {
    problems.push('ENCRYPTION_KEY is required in production');
  } else {
    const key = Buffer.from(config.encryptionKey, 'base64');
    if (key.length !== 32) {
      problems.push('ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32)');
    }
  }
  if (config.isProduction && config.mail.driver === 'smtp' && !config.mail.smtp.host) {
    problems.push('SMTP_HOST is required when MAIL_DRIVER=smtp');
  }
  if (config.isProduction && config.storage.driver === 's3' && !config.storage.s3.bucket) {
    problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}
