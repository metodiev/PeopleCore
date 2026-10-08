import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { SearchInput, useDebouncedValue } from "./feature/widgets.js";
import { Dialog, DialogContent } from "./ui/dialog.js";
import { Spinner } from "./ui/feedback.js";

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  route?: string | null;
}

export interface SearchGroup {
  type: string;
  label?: string;
  items: SearchHit[];
}

/**
 * Where a search hit should navigate. Keyed by the entity types the search API
 * actually returns (`SEARCH_ENTITY_TYPES` in the API's search DTO — note the
 * plural / camelCase forms). Entities without a dedicated detail route in this
 * SPA land on their list page; settings-backed entities open the right tab.
 *
 * The server's `url` is a resource identifier, not an SPA route, so this map
 * takes precedence and the server value is only a last resort.
 */
export const ROUTE_BY_TYPE: Record<string, (id: string) => string> = {
  employees: (id) => `/people/${id}`,
  employee: (id) => `/people/${id}`,
  departments: () => "/settings?tab=organization",
  department: () => "/settings?tab=organization",
  positions: () => "/settings?tab=organization",
  position: () => "/settings?tab=organization",
  users: () => "/settings?tab=users",
  user: () => "/settings?tab=users",
  documents: () => "/documents",
  document: () => "/documents",
  requests: () => "/requests",
  request: () => "/requests",
  leaveRequests: () => "/leave",
  leave_request: () => "/leave",
  assets: () => "/assets",
  asset: () => "/assets",
  expenses: () => "/expenses",
  expense: () => "/expenses",
  courses: () => "/training",
  course: () => "/training",
};

/** Normalises the grouped / flat shapes a search endpoint may return. */
export function normalizeSearchResponse(payload: unknown): SearchGroup[] {
  const toHit = (raw: unknown, fallbackType: string): SearchHit | null => {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : null;
    if (!id) return null;
    const title =
      (typeof record["title"] === "string" && record["title"]) ||
      (typeof record["label"] === "string" && record["label"]) ||
      (typeof record["name"] === "string" && record["name"]) ||
      id;
    return {
      id,
      type: typeof record["type"] === "string" ? record["type"] : fallbackType,
      title,
      subtitle:
        typeof record["subtitle"] === "string" ? record["subtitle"] : null,
      route:
        typeof record["route"] === "string"
          ? record["route"]
          : typeof record["url"] === "string"
            ? record["url"]
            : null,
    };
  };

  const collect = (raw: unknown[], type: string) =>
    raw
      .map((entry) => toHit(entry, type))
      .filter((hit): hit is SearchHit => hit !== null);

  if (Array.isArray(payload))
    return [{ type: "all", items: collect(payload, "all") }];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record["groups"])) {
    return (record["groups"] as unknown[]).flatMap((group) => {
      if (!group || typeof group !== "object") return [];
      const entry = group as Record<string, unknown>;
      const type = typeof entry["type"] === "string" ? entry["type"] : "all";
      const items = Array.isArray(entry["items"])
        ? collect(entry["items"], type)
        : [];
      return items.length > 0
        ? [
            {
              type,
              label:
                typeof entry["label"] === "string" ? entry["label"] : undefined,
              items,
            },
          ]
        : [];
    });
  }
  if (Array.isArray(record["data"]))
    return [{ type: "all", items: collect(record["data"], "all") }];
  return [];
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const debounced = useDebouncedValue(term, 250);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.key === "k" || event.key === "K") &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setHighlight(0);
    }
  }, [open]);

  const query = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<unknown>("/search", { query: { q: debounced } }),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 10_000,
  });

  const groups = normalizeSearchResponse(query.data);
  const flat = groups.flatMap((group) => group.items);
  const searching = debounced.trim().length >= 2;

  const openHit = (hit: SearchHit) => {
    setOpen(false);
    // Prefer this app's own route table; the API's `url` is a resource path
    // (e.g. `/employees/<id>`) that does not match the SPA's routes.
    const target = ROUTE_BY_TYPE[hit.type]?.(hit.id) ?? hit.route ?? "/";
    navigate(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) =>
        Math.min(current + 1, Math.max(0, flat.length - 1)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && flat[highlight]) {
      event.preventDefault();
      openHit(flat[highlight]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title={t("search.title")}
        description={t("search.hint")}
        className="w-[min(96vw,36rem)]"
      >
        <div className="space-y-4">
          <SearchInput
            value={term}
            onChange={(value) => {
              setTerm(value);
              setHighlight(0);
            }}
            placeholder={t("search.placeholder")}
            label={t("search.placeholder")}
            onKeyDown={onKeyDown}
            autoFocus
          />
          <div
            role="listbox"
            aria-label={t("search.results")}
            className="max-h-80 space-y-4 overflow-y-auto"
          >
            {query.isFetching ? <Spinner /> : null}
            {!searching ? (
              <p className="px-1 text-sm text-slate-500 dark:text-slate-400">
                {t("search.typeMore")}
              </p>
            ) : null}
            {searching && !query.isFetching && flat.length === 0 ? (
              <p className="px-1 text-sm text-slate-500 dark:text-slate-400">
                {t("common.noResults")}
              </p>
            ) : null}
            {groups.map((group) => (
              <div key={group.type}>
                <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {group.label ??
                    t(`search.types.${group.type}`, {
                      defaultValue: group.type,
                    })}
                </p>
                <ul className="space-y-1">
                  {group.items.map((hit) => {
                    const index = flat.indexOf(hit);
                    return (
                      <li key={`${hit.type}-${hit.id}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === highlight}
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => openHit(hit)}
                          className={cn(
                            "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                            index === highlight &&
                              "bg-slate-100 dark:bg-slate-800",
                          )}
                        >
                          <span className="block font-medium text-slate-900 dark:text-slate-100">
                            {hit.title}
                          </span>
                          {hit.subtitle ? (
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              {hit.subtitle}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
