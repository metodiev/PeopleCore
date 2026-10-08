import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { StorageError } from '../../common/errors/app-error.js';
import type { StoragePort, StoredFile, StoredObject } from '../storage.port.js';

/** Local filesystem storage — the default for development and single-node deploys. */
export class LocalStorageDriver implements StoragePort {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(storageKey: string): string {
    const target = normalize(join(this.root, storageKey));
    if (!target.startsWith(this.root + sep) && target !== this.root) {
      throw new StorageError('Invalid storage key', 'INVALID_STORAGE_KEY');
    }
    return target;
  }

  async put(storageKey: string, data: Uint8Array): Promise<StoredObject> {
    const target = this.pathFor(storageKey);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    } catch (error) {
      throw new StorageError(`Failed to write ${storageKey}: ${(error as Error).message}`);
    }
    return {
      storageKey,
      sizeBytes: data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  }

  async get(storageKey: string): Promise<StoredFile> {
    try {
      const data = await readFile(this.pathFor(storageKey));
      return { data };
    } catch {
      throw new StorageError(`File not found: ${storageKey}`, 'FILE_NOT_FOUND');
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.pathFor(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(storageKey: string, expiresInSeconds = 900): Promise<string> {
    void expiresInSeconds;
    // Local files are served through the API (with authorization) instead.
    return `/api/v1/documents/download?key=${encodeURIComponent(storageKey)}`;
  }
}
