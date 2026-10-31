"use client";

import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shell/EmptyState";
import { Kbd } from "@/components/shell/Kbd";
import { Button, ButtonLink } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/categories";
import { CategoryFilter } from "./CategoryFilter";
import { ToolCard, ToolCardSkeleton } from "./ToolCard";

const SEARCH_DEBOUNCE_MS = 200;
const CATEGORY_SLUGS = new Set<string>(CATEGORIES.map((c) => c.slug));

interface Filters {
  q: string;
  category: Category | null;
  available: boolean;
}

function readFilters(params: URLSearchParams): Filters {
  const category = params.get("category");
  return {
    q: params.get("q")?.trim() ?? "",
    category: category && CATEGORY_SLUGS.has(category) ? (category as Category) : null,
    available: params.get("available") === "1",
  };
}

function hrefFor(pathname: string, filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.available) params.set("available", "1");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Header shared by the page and its loading state. */
function BrowseHeader() {
  return (
    <header className="grid gap-1.5">
      <h1 className="text-2xl font-semibold tracking-title">Browse tools</h1>
      <p className="text-sm text-muted-foreground">Everything your neighbours lend. Open one to see its free days.</p>
    </header>
  );
}

export function BrowseSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <BrowseHeader />
      <span className="sr-only" role="status">
        Loading tools
      </span>
      <div className="grid gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
        <div className="flex gap-1.5">
          {[48, 96, 88, 64, 72].map((width) => (
            <Skeleton key={width} className="h-8 rounded-md" style={{ width }} />
          ))}
        </div>
      </div>
      <ResultsGridSkeleton />
    </div>
  );
}

function ResultsGridSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <ToolCardSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * Browse: search (debounced, in ?q=), category chips (?category=) and
 * "Available only" (?available=1), over a live grid of tools. The URL is the
 * state, so filters survive reloads and can be shared.
 */
export function BrowseTools() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = readFilters(new URLSearchParams(searchParams.toString()));
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  // The input is local so typing stays instant; the URL (and the query)
  // follow 200 ms after the last keystroke.
  const [query, setQuery] = useState(filters.q);

  const { q, category, available } = filters;
  useEffect(() => {
    const next = query.trim();
    if (next === q) return;
    const timer = setTimeout(() => {
      router.replace(hrefFor(pathname, { q: next, category, available }), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, q, category, available, pathname, router]);

  // "/" jumps to search from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isEditable(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function update(patch: Partial<Filters>) {
    router.replace(hrefFor(pathname, { ...filters, q: query.trim(), ...patch }), { scroll: false });
  }

  function clearAll() {
    setQuery("");
    router.replace(pathname, { scroll: false });
  }

  const results = useQuery(api.tools.browse, {
    search: filters.q || undefined,
    category: filters.category ?? undefined,
    availableOnly: filters.available || undefined,
  });
  // Keep showing the previous results while a new filter loads, so the grid
  // doesn't flash back to skeletons on every keystroke.
  const [lastResults, setLastResults] = useState(results);
  if (results !== undefined && results !== lastResults) setLastResults(results);
  const shown = results ?? lastResults;
  const refreshing = results === undefined && lastResults !== undefined;

  const filtered = Boolean(filters.q || filters.category || filters.available);
  const count = shown?.length ?? 0;

  let summary = `${count} ${count === 1 ? "tool" : "tools"}`;
  if (filters.category) summary += ` in ${categoryLabel(filters.category)}`;
  if (filters.available) summary += ", available now";
  if (filters.q) summary += ` matching “${filters.q}”`;

  return (
    <div className="grid gap-6">
      <BrowseHeader />

      <div role="search" aria-label="Filter tools" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label htmlFor={searchId} className="sr-only">
            Search tools by name
          </label>
          <InputGroup className="w-full sm:max-w-sm">
            <InputGroupAddon>
              <MagnifyingGlassIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={searchId}
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Search tools"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
              className="[&::-webkit-search-cancel-button]:appearance-none"
            />
            <InputGroupAddon align="inline-end">
              {query ? (
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              ) : (
                <Kbd className="pointer-coarse:hidden">/</Kbd>
              )}
            </InputGroupAddon>
          </InputGroup>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium select-none">
            <Switch checked={filters.available} onCheckedChange={(checked) => update({ available: checked })} />
            Available only
          </label>
        </div>
        <CategoryFilter value={filters.category} onChange={(category) => update({ category })} />
      </div>

      {shown === undefined ? (
        <>
          <span className="sr-only" role="status">
            Loading tools
          </span>
          <ResultsGridSkeleton />
        </>
      ) : (
        <section aria-label="Results" aria-busy={refreshing || undefined} className="grid gap-3">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <p role="status" className="font-mono text-xs text-muted-foreground">
              {summary}
            </p>
            {filtered && count > 0 ? (
              <Button variant="ghost" size="xs" onClick={clearAll}>
                Clear filters
              </Button>
            ) : null}
          </div>

          {count === 0 && !filtered ? (
            <EmptyState
              title="No tools listed yet"
              body="Be the first on your street: list something you're happy to lend, and neighbours can start requesting it."
              action={
                <ButtonLink href="/tools/new">
                  <PlusIcon aria-hidden="true" weight="bold" />
                  List a tool
                  <Kbd className="pointer-coarse:hidden">N</Kbd>
                </ButtonLink>
              }
            />
          ) : count === 0 ? (
            <EmptyState
              title="No tools match"
              body="Nothing fits these filters right now. Try another word or category, or include tools that are on loan."
              action={
                <Button variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul
              className={`grid grid-cols-1 gap-3 transition-opacity duration-(--dur-row) sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${refreshing ? "opacity-60" : ""}`}
            >
              {shown.map((tool, index) => (
                <li key={tool._id} className="min-w-0">
                  <ToolCard tool={tool} number={String(index + 1).padStart(3, "0")} href={`/tools/${tool._id}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
