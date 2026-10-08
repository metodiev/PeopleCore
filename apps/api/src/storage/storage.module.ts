import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { LocalStorageDriver } from './drivers/local.driver.js';
import { S3StorageDriver } from './drivers/s3.driver.js';
import type { StoragePort } from './storage.port.js';

export const STORAGE = Symbol('STORAGE');

@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      useFactory: (config: AppConfig): StoragePort => {
        if (config.storage.driver === 's3') {
          if (!config.storage.s3.bucket || !config.storage.s3.accessKeyId || !config.storage.s3.secretAccessKey) {
            throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
          }
          return new S3StorageDriver({
            endpoint: config.storage.s3.endpoint,
            region: config.storage.s3.region,
            bucket: config.storage.s3.bucket,
            accessKeyId: config.storage.s3.accessKeyId,
            secretAccessKey: config.storage.s3.secretAccessKey,
            forcePathStyle: config.storage.s3.forcePathStyle,
            signedUrlTtl: config.storage.s3.signedUrlTtl,
          });
        }
        return new LocalStorageDriver(config.storage.localPath);
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}

/** Type-only alias so consumers can inject with `@Inject(STORAGE)`. */
export type Storage = StoragePort;
