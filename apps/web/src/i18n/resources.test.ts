import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resources } from './resources.js';

type Dictionary = Record<string, unknown>;

function flatten(dictionary: Dictionary, prefix = '', into = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Dictionary, path, into);
    else if (typeof value === 'string') into.set(path, value);
  }
  return into;
}

/** Every static `t('key')` / `t("key")` literal used in the app source. */
function usedKeys(): Set<string> {
  const root = join(process.cwd(), 'src');
  const keys = new Set<string>();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'test') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      for (const match of text.matchAll(/(?<![A-Za-z])t\(\s*(['"`])((?:(?!\1).)+)\1/g)) {
        const key = match[2];
        if (key.includes('${') || key.includes('\n')) continue;
        keys.add(key);
      }
    }
  };
  walk(root);
  return keys;
}

describe('i18n resources', () => {
  const bg = flatten(resources.bg.translation as Dictionary);
  const en = flatten(resources.en.translation as Dictionary);

  it('keeps the bg and en dictionaries in sync', () => {
    const onlyBg = [...bg.keys()].filter((key) => !en.has(key));
    const onlyEn = [...en.keys()].filter((key) => !bg.has(key));
    expect(onlyBg).toEqual([]);
    expect(onlyEn).toEqual([]);
    expect(bg.size).toBeGreaterThan(0);
  });

  it('has a non-empty translation for every key', () => {
    for (const [key, value] of [...bg, ...en]) {
      expect(value.trim(), `${key} is empty`).not.toBe('');
    }
  });

  it('defines every translation namespace used with interpolated keys', () => {
    const root = join(process.cwd(), 'src');
    const prefixes = new Set<string>();
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'test') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
        const text = readFileSync(full, 'utf8');
        for (const match of text.matchAll(/(?<![A-Za-z])t\(`([A-Za-z][\w.]*)\.\$\{/g)) prefixes.add(match[1]);
      }
    };
    walk(root);
    const missing = [...prefixes]
      .filter((prefix) => ![...bg.keys()].some((key) => key.startsWith(`${prefix}.`)))
      .sort();
    expect(missing).toEqual([]);
    expect(prefixes.size).toBeGreaterThan(0);
  });

  it('defines every translation key used in the app', () => {
    const missing = [...usedKeys()].filter((key) => !bg.has(key) || !en.has(key)).sort();
    expect(missing).toEqual([]);
  });
});
