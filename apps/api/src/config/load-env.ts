import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Loads `.env` files into `process.env` before the application boots.
 *
 * Two locations are supported, in order of precedence:
 *   1. `apps/api/.env` — API-specific settings (database driver, ports, secrets)
 *   2. `<repo>/.env`   — shared settings, created by `cp .env.example .env`
 *
 * Values already present in the environment always win (`override: false`), so
 * production deployments configure the process through the container/platform
 * environment and a stray `.env` file in an image can never take precedence.
 *
 * `loadConfig()` stays a pure function of its `env` argument; this module is the
 * only place that touches the filesystem, and it is imported by `main.ts`.
 */
const here = dirname(fileURLToPath(import.meta.url));
// src/config → src → apps/api (works identically for dist/config).
const apiRoot = resolve(here, '../..');
const repoRoot = resolve(apiRoot, '../..');

const candidates = [resolve(apiRoot, '.env'), resolve(repoRoot, '.env')];

for (const path of candidates) {
  if (existsSync(path)) {
    loadDotenv({ path, override: false, quiet: true });
  }
}

export const loadedEnvFiles = candidates.filter(existsSync);
