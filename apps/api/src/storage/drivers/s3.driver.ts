import { createHash, createHmac } from 'node:crypto';
import { StorageError } from '../../common/errors/app-error.js';
import type { StoragePort, StoredFile, StoredObject } from '../storage.port.js';

export interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  signedUrlTtl: number;
}

/**
 * S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, …) implementing
 * AWS Signature V4 directly, so no SDK dependency is required.
 */
export class S3StorageDriver implements StoragePort {
  readonly driver = 's3' as const;

  constructor(private readonly config: S3Config) {}

  private get endpoint(): string {
    return this.config.endpoint ?? `https://s3.${this.config.region ?? 'us-east-1'}.amazonaws.com`;
  }

  private objectUrl(storageKey: string): string {
    const base = this.endpoint.replace(/\/$/, '');
    return this.config.forcePathStyle || this.config.endpoint
      ? `${base}/${this.config.bucket}/${storageKey}`
      : `${base.replace('https://', `https://${this.config.bucket}.`)}/${storageKey}`;
  }

  private sign(method: string, storageKey: string, payloadHash: string, extraHeaders: Record<string, string> = {}) {
    const region = this.config.region ?? 'us-east-1';
    const service = 's3';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(this.objectUrl(storageKey)).host;
    const canonicalUri = new URL(this.objectUrl(storageKey)).pathname.split('/').map(encodeURIComponent).join('/');

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const signedHeaders = Object.keys(headers).map((key) => key.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders.map((key) => `${key}:${headers[key] ?? headers[key.toUpperCase()] ?? ''}\n`).join('');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');

    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return {
      headers: {
        ...headers,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
      },
      amzDate,
      dateStamp,
      region,
    };
  }

  async put(storageKey: string, data: Uint8Array, options: { contentType?: string } = {}): Promise<StoredObject> {
    const payloadHash = createHash('sha256').update(data).digest('hex');
    const { headers } = this.sign('PUT', storageKey, payloadHash, {
      ...(options.contentType ? { 'content-type': options.contentType } : {}),
      'content-length': String(data.byteLength),
    });

    const response = await fetch(this.objectUrl(storageKey), {
      method: 'PUT',
      headers: headers as Record<string, string>,
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      throw new StorageError(`S3 upload failed (${response.status})`, 'S3_UPLOAD_FAILED');
    }
    return { storageKey, sizeBytes: data.byteLength, checksum: payloadHash };
  }

  async get(storageKey: string): Promise<StoredFile> {
    const url = await this.signedUrl(storageKey);
    const response = await fetch(url);
    if (!response.ok) throw new StorageError('File not found', 'FILE_NOT_FOUND');
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? undefined,
    };
  }

  async delete(storageKey: string): Promise<void> {
    const { headers } = this.sign('DELETE', storageKey, createHash('sha256').update('').digest('hex'));
    const response = await fetch(this.objectUrl(storageKey), { method: 'DELETE', headers: headers as Record<string, string> });
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`S3 delete failed (${response.status})`, 'S3_DELETE_FAILED');
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const { headers } = this.sign('HEAD', storageKey, createHash('sha256').update('').digest('hex'));
    const response = await fetch(this.objectUrl(storageKey), { method: 'HEAD', headers: headers as Record<string, string> });
    return response.ok;
  }

  /** Presigned GET URL (query-string signing, valid for `expiresInSeconds`). */
  async signedUrl(storageKey: string, expiresInSeconds?: number): Promise<string> {
    const expires = Math.min(expiresInSeconds ?? this.config.signedUrlTtl, 604_800);
    const region = this.config.region ?? 'us-east-1';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;

    const url = new URL(this.objectUrl(storageKey));
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.config.accessKeyId}/${scope}`);
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-Expires', String(expires));
    url.searchParams.set('X-Amz-SignedHeaders', 'host');

    const canonicalRequest = [
      'GET',
      url.pathname.split('/').map(encodeURIComponent).join('/'),
      [...url.searchParams.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&'),
      `host:${url.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    url.searchParams.set('X-Amz-Signature', createHmac('sha256', kSigning).update(stringToSign).digest('hex'));
    return url.toString();
  }
}
