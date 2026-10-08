#!/usr/bin/env node
/**
 * Regenerates `apps/web/src/lib/api-routes.ts` from the NestJS controllers.
 *
 * The web client's unit tests assert that every `api.*()` call targets a route
 * in this list, so a renamed or invented endpoint fails CI instead of becoming
 * a 404 in production. Run this after adding, renaming or removing a controller
 * route:
 *
 *   node scripts/generate-api-routes.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = join(repoRoot, 'apps/api/src');
const target = join(repoRoot, 'apps/web/src/lib/api-routes.ts');

/** All controllers under apps/api/src (excluding the generated Prisma client). */
function controllerFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      found.push(...controllerFiles(full));
      continue;
    }
    if (entry.endsWith('.controller.ts')) found.push(full);
  }
  return found;
}

/**
 * Extracts routes from one controller file. A file may declare more than one
 * controller (the calendar module does: `@Controller('calendars')` for calendar
 * objects and `@Controller('calendar')` for events/holidays), so the file is
 * split at every `@Controller(` and each block is read separately.
 */
function routesIn(file) {
  const source = readFileSync(file, 'utf8');
  const controllers = [];
  const decorator = /@Controller\(\s*([^)]*)\)/g;
  for (let match = decorator.exec(source); match; match = decorator.exec(source)) {
    const name = /'([^']*)'/.exec(match[1]);
    controllers.push({ start: match.index, prefix: name ? name[1] : '' });
  }

  const routes = [];
  for (const [index, controller] of controllers.entries()) {
    const end = index + 1 < controllers.length ? controllers[index + 1].start : source.length;
    const body = source.slice(controller.start, end);
    const verbs = /@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
    for (let match = verbs.exec(body); match; match = verbs.exec(body)) {
      // A controller may have no prefix at all (`@Controller()` + `@Get('roles')`),
      // so join the prefix and the path without assuming either is present.
      const segments = [controller.prefix, match[2]].filter(Boolean);
      // Normalise `:id`, `:provider`, … so concrete ids from the client match.
      routes.push(`/${segments.join('/')}`.replace(/:\w+/g, ':id'));
    }
  }
  return routes;
}

const routes = [...new Set(controllerFiles(apiSrc).flatMap(routesIn))].sort();
if (routes.length === 0) {
  console.error('No routes found — did the controller layout change?');
  process.exit(1);
}

const contents = `/**
 * Every API route the backend exposes (base path excluded — the client adds
 * \`/api/v1\`), generated from the NestJS controllers in \`apps/api/src\`.
 *
 * Kept as data so \`api-paths.test.ts\` can prove the web client only calls
 * endpoints that actually exist: a typo, a renamed route or an invented path
 * fails the unit tests instead of surfacing as a 404 in production.
 *
 * Regenerate after adding or renaming a controller route:
 *   node scripts/generate-api-routes.mjs
 */
export const API_ROUTES = [
${routes.map((route) => `  ${JSON.stringify(route)},`).join('\n')}
] as const;

export type ApiRoute = (typeof API_ROUTES)[number];
`;

writeFileSync(target, contents);
console.log(`Wrote ${routes.length} routes to apps/web/src/lib/api-routes.ts`);
