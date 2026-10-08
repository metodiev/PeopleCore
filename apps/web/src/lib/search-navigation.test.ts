import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTE_BY_TYPE,
  normalizeSearchResponse,
} from "../components/global-search.js";

/**
 * The search API returns one group per `SEARCH_ENTITY_TYPES` entry. Every one
 * of those types must resolve to a route this SPA actually has, otherwise
 * clicking a search result lands on the 404 page. Kept in lockstep with
 * `apps/api/src/modules/search/dto/search.dto.ts`.
 */
const API_SEARCH_TYPES = [
  "employees",
  "departments",
  "documents",
  "requests",
  "assets",
  "leaveRequests",
  "positions",
] as const;

/** Route paths declared in App.tsx (relative to the authenticated shell). */
function declaredRoutes(): string[] {
  const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
  return [...app.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path !== "*");
}

const UNSAFE_SEGMENTS = new Set(["", "*"]);

function routeExists(target: string, declared: string[]): boolean {
  const [pathname] = target.split("?");
  const segments = (pathname ?? "")
    .split("/")
    .filter((segment) => !UNSAFE_SEGMENTS.has(segment));
  if (segments.length === 0) return true; // '/' — the dashboard index route

  return declared.some((pattern) => {
    const patternSegments = pattern
      .split("/")
      .filter((segment) => !UNSAFE_SEGMENTS.has(segment));
    if (patternSegments.length !== segments.length) return false;
    return patternSegments.every(
      (segment, index) =>
        segment.includes(":") ||
        segment.includes("*") ||
        segment === segments[index],
    );
  });
}

describe("search result navigation", () => {
  it("resolves every entity type the API returns to an existing route", () => {
    const declared = declaredRoutes();
    expect(declared.length).toBeGreaterThan(0);

    for (const type of API_SEARCH_TYPES) {
      const build = ROUTE_BY_TYPE[type];
      expect(build, `no route mapped for search type "${type}"`).toBeTypeOf(
        "function",
      );
      const target = build!("11111111-1111-1111-1111-111111111111");
      expect(
        routeExists(target, declared),
        `${type} navigates to ${target}, which is not a declared route`,
      ).toBe(true);
    }
  });

  it("prefers the SPA route table over the API-provided url", () => {
    // The API returns resource paths such as `/employees/<id>`, which are not
    // SPA routes; the client map must win.
    const groups = normalizeSearchResponse({
      groups: [
        {
          type: "employees",
          items: [
            {
              type: "employees",
              id: "abc",
              title: "Ada",
              url: "/employees/abc",
            },
          ],
        },
      ],
    });
    const hit = groups[0]?.items[0];
    expect(hit?.route).toBe("/employees/abc");
    expect(ROUTE_BY_TYPE[hit!.type]?.(hit!.id)).toBe("/people/abc");
  });

  it("parses the grouped response shape the API returns", () => {
    const groups = normalizeSearchResponse({
      query: "ada",
      groups: [
        {
          type: "employees",
          count: 2,
          items: [
            { type: "employees", id: "e1", title: "Ada", subtitle: "HR" },
          ],
        },
        { type: "documents", count: 0, items: [] },
      ],
    });
    expect(groups).toHaveLength(1); // empty groups are dropped
    expect(groups[0]?.type).toBe("employees");
    expect(groups[0]?.items[0]).toMatchObject({
      id: "e1",
      title: "Ada",
      subtitle: "HR",
    });
  });

  it("ignores malformed payloads", () => {
    expect(normalizeSearchResponse(null)).toEqual([]);
    expect(normalizeSearchResponse("nope")).toEqual([]);
    expect(normalizeSearchResponse({ groups: "nope" })).toEqual([]);
    expect(normalizeSearchResponse({ groups: [null, 42] })).toEqual([]);
  });
});
