import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ROUTES } from "./api-routes.js";
import { PROFILE_RESOURCES } from "../components/feature/employee/profile-sub-resources.js";

const SRC = join(process.cwd(), "src");
const ROUTES = new Set<string>(API_ROUTES);

/** Any call site, whether or not a literal path follows it. */
const API_CALL_SITE = /api\.(?:get|post|patch|put|delete|del|upload)\s*[<(]/g;
/** A call site whose first argument is a string or template literal. */
const API_CALL_WITH_PATH =
  /api\.(?:get|post|patch|put|delete|del|upload)(?:<[^()]*>)?\(\s*([`'"])((?:(?!\1).)+)\1/g;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry))
        files.push(full);
    }
  };
  walk(SRC);
  return files;
}

/** `:id` matches any single segment (ids, slugs, provider names, ...). */
function patternMatches(pattern: string, path: string): boolean {
  const expected = pattern.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) => segment === ":id" || segment === actual[index],
  );
}

function normalisePath(raw: string, isTemplateLiteral: boolean): string {
  // Template expressions first: they may contain `?.`, which must not be
  // mistaken for the start of a query string.
  const expanded = isTemplateLiteral ? raw.replace(/\$\{[^}]*\}/g, ":id") : raw;
  return expanded
    .split("?")[0]
    .split("#")[0]
    .split("/")
    .map((segment) => (UUID.test(segment) ? ":id" : segment))
    .join("/");
}

function scanClientCalls(): Array<{ file: string; raw: string; path: string }> {
  const calls: Array<{ file: string; raw: string; path: string }> = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(API_CALL_WITH_PATH)) {
      calls.push({
        file: relative(process.cwd(), file),
        raw: match[2],
        path: normalisePath(match[2], match[1] === "`"),
      });
    }
  }
  return calls;
}

describe("API paths", () => {
  it("only ever calls the six supported employee profile sub-resources", () => {
    expect([...PROFILE_RESOURCES]).toEqual([
      "emergency-contacts",
      "bank-accounts",
      "education",
      "skills",
      "languages",
      "notes",
    ]);

    const forbidden = ["experience", "dependents", "identifications"];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const resource of forbidden) {
        expect(
          text.includes(`profile/${resource}`),
          `${file} must not use profile/${resource}`,
        ).toBe(false);
      }
    }
  });

  it("only calls endpoints the backend exposes", () => {
    const calls = scanClientCalls();
    expect(calls.length).toBeGreaterThan(0);

    const offenders = calls
      .filter(
        (call) =>
          ![...ROUTES].some((known) => patternMatches(known, call.path)),
      )
      .map((call) => `${call.file} -> ${call.path} (from \`${call.raw}\`)`);

    expect(
      offenders,
      `unknown API route(s) called:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every api call statically checkable (literal path argument)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      const sites = text.match(API_CALL_SITE)?.length ?? 0;
      const withPath = text.match(API_CALL_WITH_PATH)?.length ?? 0;
      if (sites !== withPath) {
        offenders.push(
          `${relative(process.cwd(), file)}: ${sites} call(s), ${withPath} with a literal path`,
        );
      }
    }

    expect(
      offenders,
      `every api call must pass a literal path so the allowlist check can see it:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
