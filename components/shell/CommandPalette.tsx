"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { PlusIcon, SealCheckIcon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMe, useUserStatus } from "@/components/providers/EnsureUser";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { categoryIcon, categoryLabel } from "@/lib/categories";
import { formatDay } from "@/lib/format";
import { ErrorBoundary } from "./ErrorBoundary";
import { Kbd } from "./Kbd";
import { NAV_ITEMS } from "./nav";

interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  const value = use(PaletteContext);
  if (!value) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return value;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.closest('[role="textbox"], [role="combobox"], [role="searchbox"]') !== null;
}

function anOverlayIsOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"]') !== null;
}

/**
 * Owns the palette's open state and the global shortcuts:
 * ⌘K / Ctrl+K toggles the palette anywhere; N opens "List a tool" when focus
 * is not in a field and no overlay is open.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (
        key === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat &&
        !isEditable(event.target) &&
        !anOverlayIsOpen()
      ) {
        event.preventDefault();
        router.push("/tools/new");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <PaletteContext value={{ open, setOpen }}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function ToolResults({ search, onPick }: { search: string; onPick: (id: Id<"tools">) => void }) {
  const tools = useQuery(api.tools.browse, { search });

  if (tools === undefined) {
    return <p className="px-2.5 py-2 text-sm text-muted-foreground">Searching tools…</p>;
  }
  if (tools.length === 0) {
    return <p className="px-2.5 py-2 text-sm text-muted-foreground">No tools match “{search}”.</p>;
  }
  return tools.slice(0, 8).map((tool) => {
    const Icon = categoryIcon(tool.category);
    return (
      <CommandItem key={tool._id} value={`tool:${tool._id}`} onSelect={() => onPick(tool._id)}>
        <Icon aria-hidden="true" />
        <span className="min-w-0 truncate">{tool.name}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{categoryLabel(tool.category)}</span>
        <CommandShortcut className="font-sans text-xs">
          {tool.isMine ? (
            "Yours"
          ) : tool.availability.state === "available" ? (
            "Available"
          ) : (
            <span className="font-mono">Back {formatDay(tool.availability.until)}</span>
          )}
          {tool.owner.isTrustedLender && !tool.isMine ? (
            <SealCheckIcon weight="fill" aria-label="Trusted lender" className="text-primary-ink" />
          ) : null}
        </CommandShortcut>
      </CommandItem>
    );
  });
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const me = useMe();
  const { status } = useUserStatus();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 150);
  const needle = query.trim().toLowerCase();

  const nav = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === "admin").filter((item) =>
    item.label.toLowerCase().includes(needle),
  );
  const showListAction = "list a tool".includes(needle) || "new".includes(needle);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
      title="Command palette"
      description="Jump to a page, search tools by name, or list a tool."
    >
      <Command shouldFilter={false} loop label="Command palette">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search tools or jump to…" />
        <CommandList>
          {nav.length > 0 ? (
            <CommandGroup heading="Navigate">
              {nav.map(({ href, label, icon: Icon }) => (
                <CommandItem key={href} value={`nav:${href}`} onSelect={() => go(href)}>
                  <Icon aria-hidden="true" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {search && status === "ready" ? (
            <CommandGroup heading="Tools">
              <ErrorBoundary
                resetKey={search}
                fallback={() => <p className="px-2.5 py-2 text-sm text-muted-foreground">Search is unavailable right now.</p>}
              >
                <ToolResults search={search} onPick={(id) => go(`/tools/${id}`)} />
              </ErrorBoundary>
            </CommandGroup>
          ) : null}

          {showListAction ? (
            <CommandGroup heading="Actions">
              <CommandItem value="action:new" onSelect={() => go("/tools/new")}>
                <PlusIcon aria-hidden="true" />
                List a tool
                <CommandShortcut>
                  <Kbd>N</Kbd>
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
          ) : null}

          {nav.length === 0 && !showListAction && !search ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">No pages match “{query.trim()}”.</p>
          ) : null}
        </CommandList>
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:flex pointer-coarse:hidden">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> to open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> to close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
