/** Result of storing a file. */
export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

export interface StoredFile {
  data: Buffer;
  mimeType?: string;
}

/**
 * File storage abstraction. Drivers: local filesystem (development, single
 * node) and S3-compatible object storage (production, multi-node).
 */
export interface StoragePort {
  readonly driver: 'local' | 's3';
  put(storageKey: string, data: Uint8Array, options?: { contentType?: string }): Promise<StoredObject>;
  get(storageKey: string): Promise<StoredFile>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  /** Time-limited download URL (S3 presigned URL, or an API route for local). */
  signedUrl(storageKey: string, expiresInSeconds?: number): Promise<string>;
}
