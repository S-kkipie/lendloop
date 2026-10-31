"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/validators";
import { useMe } from "@/components/providers/EnsureUser";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, categoryLabel, type Category } from "@/lib/categories";
import { CONDITIONS, conditionLabel, type Condition } from "@/lib/conditions";
import { messageForError } from "@/lib/convexErrors";
import { CategoryIcon } from "./CategoryIcon";
import { ToolCard } from "./ToolCard";

export interface ToolDraft {
  name: string;
  category: Category | null;
  condition: Condition | null;
  description: string;
}

type Field = "name" | "category" | "condition" | "description";
type Errors = Partial<Record<Field, string>>;

const EMPTY: ToolDraft = { name: "", category: null, condition: null, description: "" };

function validate(draft: ToolDraft): Errors {
  const errors: Errors = {};
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (name.length === 0) errors.name = "Give the tool a name.";
  else if (name.length < LIMITS.toolNameMin) errors.name = `Use at least ${LIMITS.toolNameMin} characters.`;
  else if (name.length > LIMITS.toolNameMax) errors.name = `Keep it to ${LIMITS.toolNameMax} characters.`;
  if (!draft.category) errors.category = "Choose a category.";
  if (!draft.condition) errors.condition = "Choose a condition.";
  if (draft.description.trim().length > LIMITS.descriptionMax) {
    errors.description = `Keep it to ${LIMITS.descriptionMax} characters.`;
  }
  return errors;
}

function FieldMessage({ id, error, children }: { id: string; error?: string; children?: ReactNode }) {
  if (error) {
    return (
      <p id={id} className="flex items-start gap-1.5 text-xs text-danger-ink">
        <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-px size-3.5 shrink-0" />
        {error}
      </p>
    );
  }
  return children ? (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  ) : null;
}

function Counter({ id, value, max }: { id: string; value: number; max: number }) {
  return (
    <span id={id} className="font-mono text-xs text-muted-foreground tabular-nums">
      {value}/{max}
    </span>
  );
}

interface ToolFormProps {
  /** Present when editing an existing listing. */
  toolId?: Id<"tools">;
  initial?: ToolDraft;
}

/**
 * Create or edit a listing. Labels above, helper text or the error below,
 * counters on the text fields; errors appear after the first submit and then
 * update as you type. A live preview shows the card neighbours will see.
 */
export function ToolForm({ toolId, initial = EMPTY }: ToolFormProps) {
  const router = useRouter();
  const me = useMe();
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const editing = toolId !== undefined;

  const [draft, setDraft] = useState<ToolDraft>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const ids = {
    name: useId(),
    nameHelp: useId(),
    nameCount: useId(),
    category: useId(),
    categoryLabel: useId(),
    categoryHelp: useId(),
    condition: useId(),
    conditionLabel: useId(),
    conditionHelp: useId(),
    description: useId(),
    descriptionHelp: useId(),
    descriptionCount: useId(),
    formError: useId(),
  };
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const conditionRef = useRef<HTMLButtonElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const errors = submitted ? validate(draft) : {};
  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setFormError(null);
    const found = validate(draft);
    const firstInvalid = (["name", "category", "condition", "description"] as const).find((field) => found[field]);
    if (firstInvalid) {
      const target = { name: nameRef, category: categoryRef, condition: conditionRef, description: descriptionRef }[firstInvalid];
      target.current?.focus();
      return;
    }
    const fields = {
      name: draft.name,
      category: draft.category!,
      condition: draft.condition!,
      description: draft.description,
    };
    setPending(true);
    try {
      if (editing) {
        await update({ toolId, ...fields });
        toast.success("Changes saved");
        router.push(`/tools/${toolId}`);
      } else {
        const id = await create(fields);
        toast.success(`${fields.name.trim()} is listed`, { description: "Neighbours can request it now." });
        router.push(`/tools/${id}`);
      }
    } catch (error) {
      setPending(false);
      setFormError(messageForError(error));
    }
  }

  const describedBy = (help: string, extra?: string) => [help, extra].filter(Boolean).join(" ");
  const nameLength = draft.name.trim().length;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <form onSubmit={onSubmit} noValidate className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-6 px-5 py-6 sm:px-6">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor={ids.name}>Name</Label>
              <Counter id={ids.nameCount} value={nameLength} max={LIMITS.toolNameMax} />
            </div>
            <Input
              id={ids.name}
              ref={nameRef}
              value={draft.name}
              maxLength={LIMITS.toolNameMax}
              autoComplete="off"
              placeholder="Cordless drill"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy(ids.nameHelp, ids.nameCount)}
              onChange={(event) => set("name", event.target.value)}
            />
            <FieldMessage id={ids.nameHelp} error={errors.name}>
              What neighbours will search for. {LIMITS.toolNameMin} to {LIMITS.toolNameMax} characters.
            </FieldMessage>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label id={ids.categoryLabel} htmlFor={ids.category}>
                Category
              </Label>
              <Select<Category>
                value={draft.category}
                onValueChange={(value) => set("category", value)}
                items={CATEGORIES.map((c) => ({ value: c.slug, label: c.label }))}
              >
                <SelectTrigger
                  id={ids.category}
                  ref={categoryRef}
                  className="w-full"
                  aria-labelledby={ids.categoryLabel}
                  aria-invalid={errors.category ? true : undefined}
                  aria-describedby={ids.categoryHelp}
                >
                  <SelectValue>
                    {(value: Category | null) =>
                      value ? (
                        <>
                          <CategoryIcon category={value} aria-hidden="true" className="text-muted-foreground" />
                          {categoryLabel(value)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Choose a category</span>
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(({ slug, label, icon: Icon }) => (
                    <SelectItem key={slug} value={slug}>
                      <Icon aria-hidden="true" className="text-muted-foreground" />
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldMessage id={ids.categoryHelp} error={errors.category}>
                Where it shows up when people filter.
              </FieldMessage>
            </div>

            <div className="grid content-start gap-2">
              <Label id={ids.conditionLabel} htmlFor={ids.condition}>
                Condition
              </Label>
              <Select<Condition>
                value={draft.condition}
                onValueChange={(value) => set("condition", value)}
                items={CONDITIONS.map((c) => ({ value: c.slug, label: c.label }))}
              >
                <SelectTrigger
                  id={ids.condition}
                  ref={conditionRef}
                  className="w-full"
                  aria-labelledby={ids.conditionLabel}
                  aria-invalid={errors.condition ? true : undefined}
                  aria-describedby={ids.conditionHelp}
                >
                  <SelectValue>
                    {(value: Condition | null) =>
                      value ? conditionLabel(value) : <span className="text-muted-foreground">Choose a condition</span>
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map(({ slug, label, hint }) => (
                    <SelectItem key={slug} value={slug} className="items-start">
                      <span className="grid gap-0.5">
                        <span>{label}</span>
                        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldMessage id={ids.conditionHelp} error={errors.condition}>
                {draft.condition
                  ? CONDITIONS.find((c) => c.slug === draft.condition)?.hint
                  : "Be honest; it saves a conversation later."}
              </FieldMessage>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor={ids.description}>
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Counter id={ids.descriptionCount} value={draft.description.length} max={LIMITS.descriptionMax} />
            </div>
            <Textarea
              id={ids.description}
              ref={descriptionRef}
              value={draft.description}
              maxLength={LIMITS.descriptionMax}
              rows={4}
              placeholder="18 V, two batteries and a set of bits. Charger included."
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={describedBy(ids.descriptionHelp, ids.descriptionCount)}
              onChange={(event) => set("description", event.target.value)}
              className="min-h-28"
            />
            <FieldMessage id={ids.descriptionHelp} error={errors.description}>
              What&apos;s included and anything a borrower should know.
            </FieldMessage>
          </div>

          {formError ? (
            <p
              id={ids.formError}
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger-ink"
            >
              <WarningCircleIcon aria-hidden="true" weight="fill" className="mt-0.5 size-4 shrink-0" />
              {formError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border bg-muted px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <ButtonLink variant="outline" href={editing ? `/tools/${toolId}` : "/tools"}>
            Cancel
          </ButtonLink>
          <Button type="submit" aria-busy={pending || undefined} aria-describedby={formError ? ids.formError : undefined}>
            {pending ? (editing ? "Saving…" : "Listing…") : editing ? "Save changes" : "List tool"}
          </Button>
        </div>
      </form>

      <aside aria-label="Preview" className="grid gap-2 lg:sticky lg:top-10">
        <p className="text-xs text-muted-foreground">How it looks in Browse</p>
        <div aria-hidden="true">
          <ToolCard
            number="New"
            tool={{
              name: draft.name.trim() || "Your tool's name",
              category: draft.category,
              condition: draft.condition,
              isMine: false,
              owner: { displayName: me?.displayName ?? "You", isTrustedLender: false },
              availability: { state: "available" },
            }}
          />
        </div>
      </aside>
    </div>
  );
}
