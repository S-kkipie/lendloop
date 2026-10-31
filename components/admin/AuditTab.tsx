"use client";

import { ArrowRightIcon, MagnifyingGlassIcon, ScrollIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { cn } from "cn";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { EntityType } from "@/convex/lib/validators";
import { useArrivals } from "@/components/loans/useArrivals";
import { EmptyState } from "@/components/shell/EmptyState";
import { LedgerCell, LedgerList } from "@/components/shell/LedgerList";
import { RelativeTime, useNow } from "@/components/shell/RelativeTime";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTITY_LABEL, ENTITY_TYPES, shortId, type AdminParams } from "@/lib/admin";
import { closeReasonText, type CloseReason } from "@/lib/loanStatus";
import { AdminRow, plural, ShortId, TableSkeleton, Toolbar, useKept } from "./shared";

type Entry = FunctionReturnType<typeof api.admin.auditLog>[number];

const LIMIT = 100;
const FILTER_DEBOUNCE_MS = 300;
const HEADS = ["When", "Actor", "Action", "Entity", "Change", "Reason"] as const;
const COLUMNS =
  "xl:grid-cols-[max-content_max-content_max-content_max-content_max-content_minmax(0,1fr)]";
const ENTITY_ITEMS = ENTITY_TYPES.map((type) => ({ value: type, label: ENTITY_LABEL[type] }));

/**
 * Why: system closures store a reason code ("dates_taken"), people write their
 * own (a moderator's removal reason). Codes read as the app's own sentence.
 */
function reasonText(reason: string | undefined): string | null {
  if (!reason) return null;
  return closeReasonText(reason as CloseReason) ?? `“${reason}”`;
}

/** Who acted: a person's display name, or LendLoop itself for system jobs and n8n. */
function Actor({ entry }: { entry: Entry }) {
  const role = entry.actorType === "user" ? null : entry.actorType === "n8n" ? "n8n" : entry.actorType === "admin" ? "Admin" : "System";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
      <span className="truncate">{entry.actor}</span>
      {role ? <span className="font-mono text-[0.6875rem] text-muted-foreground">{role}</span> : null}
    </span>
  );
}

function Change({ entry }: { entry: Entry }) {
  if (!entry.fromStatus && !entry.toStatus) return null;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
      {entry.fromStatus ? <span className="text-muted-foreground">{entry.fromStatus}</span> : null}
      {entry.fromStatus ? (
        <>
          <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          <span className="sr-only">to</span>
        </>
      ) : (
        <span className="sr-only">Now</span>
      )}
      <span>{entry.toStatus}</span>
    </span>
  );
}

function EntityButton({ entry, onFilter }: { entry: Entry; onFilter: (type: EntityType, id: string) => void }) {
  const label = ENTITY_LABEL[entry.entityType];
  return (
    <button
      type="button"
      onClick={() => onFilter(entry.entityType, entry.entityId)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-left text-[0.8125rem] text-primary-ink underline-offset-4 hover:underline"
    >
      {label}
      <ShortId id={entry.entityId} className="text-primary-ink" />
      <span className="sr-only">: show only its history</span>
    </button>
  );
}

function AuditRow({
  entry,
  now,
  filtered,
  onFilter,
  arriving,
  onArrived,
}: {
  entry: Entry;
  now: number;
  filtered: boolean;
  onFilter: (type: EntityType, id: string) => void;
  arriving: boolean;
  onArrived: () => void;
}) {
  const actionId = useId();
  const entity = filtered ? (
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem]">
      {ENTITY_LABEL[entry.entityType]} <ShortId id={entry.entityId} />
    </span>
  ) : (
    <EntityButton entry={entry} onFilter={onFilter} />
  );
  return (
    <AdminRow arriving={arriving} onArrived={onArrived} aria-labelledby={actionId} className="items-start xl:items-center">
      <LedgerCell className="hidden xl:block">
        <RelativeTime at={entry.at} now={now} focusable={false} />
      </LedgerCell>
      <LedgerCell className="hidden xl:block">
        <Actor entry={entry} />
      </LedgerCell>
      <LedgerCell className="col-start-1 row-start-1 grid content-start gap-1 xl:col-start-auto xl:row-start-auto xl:block">
        <span id={actionId} className="font-mono text-[0.8125rem] leading-6 font-medium">
          {entry.action}
        </span>
        {/* Stacked below xl: who, what it touched, the change and why. */}
        <div className="grid gap-1 xl:hidden">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Actor entry={entry} />
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            {entity}
          </p>
          {entry.fromStatus || entry.toStatus ? <Change entry={entry} /> : null}
          {entry.reason ? <p className="text-[0.8125rem] leading-5 text-muted-foreground">{reasonText(entry.reason)}</p> : null}
        </div>
      </LedgerCell>
      <LedgerCell className="hidden xl:block">{entity}</LedgerCell>
      <LedgerCell className="hidden text-[0.8125rem] xl:block">
        <Change entry={entry} />
      </LedgerCell>
      <LedgerCell className="hidden text-[0.8125rem] leading-5 text-muted-foreground [overflow-wrap:anywhere] xl:block">
        {reasonText(entry.reason)}
      </LedgerCell>
      <LedgerCell className="col-start-2 row-start-1 justify-self-end xl:hidden">
        <RelativeTime at={entry.at} now={now} focusable={false} />
      </LedgerCell>
    </AdminRow>
  );
}

/**
 * The append-only record of every state change and admin action, newest
 * first. Filter to one entity by pasting its ID, or by clicking it in a row.
 * The filter lives in the URL, so a link can open one loan's history.
 */
export function AuditTab({ params, update }: { params: AdminParams; update: (patch: Partial<AdminParams>) => void }) {
  const now = useNow();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const typeId = useId();
  const applied = params.entity;
  const [type, setType] = useState<EntityType>(applied?.type ?? "loan");
  const [draft, setDraft] = useState(applied?.id ?? "");

  // The URL changed from outside (a row click, Back): show its filter.
  const [lastApplied, setLastApplied] = useState(applied);
  if (applied?.type !== lastApplied?.type || applied?.id !== lastApplied?.id) {
    setLastApplied(applied);
    setType(applied?.type ?? type);
    setDraft(applied?.id ?? "");
  }

  // Typing filters 300 ms after the last keystroke; the type applies at once.
  useEffect(() => {
    const id = draft.trim();
    if (id === (applied?.id ?? "") && (!id || type === applied?.type)) return;
    const timer = setTimeout(() => update({ entity: id ? { type, id } : null }), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, type, applied, update]);

  const args = applied ? { entityType: applied.type, entityId: applied.id, limit: LIMIT } : { limit: LIMIT };
  const { data: entries, refreshing } = useKept(useQuery(api.admin.auditLog, args));
  const arrivals = useArrivals(entries?.map((entry) => entry._id));

  // The clicked button goes away with the filter; keep focus on the filter itself.
  const filterBy = (nextType: EntityType, id: string) => {
    update({ entity: { type: nextType, id } });
    inputRef.current?.focus();
  };
  const clear = () => {
    setDraft("");
    update({ entity: null });
  };

  const summary = entries
    ? applied
      ? `${plural(entries.length, "entry", "entries")} for ${ENTITY_LABEL[applied.type].toLowerCase()} ${shortId(applied.id)}, newest first`
      : `Latest ${plural(entries.length, "entry", "entries")}, newest first`
    : "Loading the audit log";

  return (
    <div className="grid gap-4">
      <Toolbar summary={summary}>
        <div role="search" aria-label="Filter the audit log" className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span id={typeId} className="sr-only">
            Entity type
          </span>
          <Select<EntityType> value={type} onValueChange={(value) => value && setType(value)} items={ENTITY_ITEMS}>
            <SelectTrigger size="sm" aria-labelledby={typeId} className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label htmlFor={inputId} className="sr-only">
            {ENTITY_LABEL[type]} ID
          </label>
          <InputGroup className="h-8 min-w-0 flex-1 sm:w-72 sm:flex-none">
            <InputGroupAddon>
              <MagnifyingGlassIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={inputId}
              ref={inputRef}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste a ${ENTITY_LABEL[type].toLowerCase()} ID`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && draft) {
                  event.preventDefault();
                  clear();
                }
              }}
              className="font-mono text-xs"
            />
            {draft ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear the filter" onClick={clear}>
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
      </Toolbar>

      {entries === undefined ? (
        <TableSkeleton heads={HEADS} columns={COLUMNS} rows={6} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ScrollIcon}
          title={applied ? `Nothing on record for this ${ENTITY_LABEL[applied.type].toLowerCase()}` : "Nothing on record yet"}
          body={
            applied
              ? "Check the ID and the entity type. IDs are case sensitive."
              : "Every request, approval, removal and admin action is written here as it happens."
          }
          action={
            applied ? (
              <Button variant="outline" onClick={clear}>
                Clear the filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div aria-busy={refreshing || undefined} className={cn(refreshing && "opacity-60 transition-opacity duration-(--dur-row)")}>
          <LedgerList label="Audit log" heads={HEADS} columns={COLUMNS} semantics="table" endAligned={false}>
            {entries.map((entry) => (
              <AuditRow
                key={entry._id}
                entry={entry}
                now={now}
                filtered={applied !== null}
                onFilter={filterBy}
                arriving={arrivals.isArriving(entry._id)}
                onArrived={() => arrivals.settle(entry._id)}
              />
            ))}
          </LedgerList>
        </div>
      )}
    </div>
  );
}
