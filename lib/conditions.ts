import type { Condition } from "../convex/lib/validators";

export type { Condition };

export interface ConditionInfo {
  slug: Condition;
  label: string;
  /** One line that tells a lender which condition to pick. */
  hint: string;
}

/** Display order matches the server's condition list (best first). */
export const CONDITIONS: readonly ConditionInfo[] = [
  { slug: "new", label: "New", hint: "Unused, still in its packaging" },
  { slug: "like_new", label: "Like new", hint: "Used a few times, no wear" },
  { slug: "good", label: "Good", hint: "Works well, some signs of use" },
  { slug: "fair", label: "Fair", hint: "Works, with visible wear" },
];

const BY_SLUG = new Map<string, ConditionInfo>(CONDITIONS.map((c) => [c.slug, c]));

export function conditionLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? "Used";
}
