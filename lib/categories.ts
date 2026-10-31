import type { Icon } from "@phosphor-icons/react";
import {
  BroomIcon,
  CookingPotIcon,
  HammerIcon,
  LadderIcon,
  PackageIcon,
  PlantIcon,
  PlugIcon,
  TentIcon,
} from "@phosphor-icons/react/ssr";
import type { Category } from "../convex/lib/validators";

export type { Category };

export interface CategoryInfo {
  slug: Category;
  label: string;
  icon: Icon;
}

/** Display order matches the server's category list. */
export const CATEGORIES: readonly CategoryInfo[] = [
  { slug: "power_tools", label: "Power tools", icon: PlugIcon },
  { slug: "hand_tools", label: "Hand tools", icon: HammerIcon },
  { slug: "garden", label: "Garden", icon: PlantIcon },
  { slug: "kitchen", label: "Kitchen", icon: CookingPotIcon },
  { slug: "camping", label: "Camping", icon: TentIcon },
  { slug: "cleaning", label: "Cleaning", icon: BroomIcon },
  { slug: "ladders", label: "Ladders", icon: LadderIcon },
  { slug: "other", label: "Other", icon: PackageIcon },
];

const OTHER = CATEGORIES[CATEGORIES.length - 1];
const BY_SLUG = new Map<string, CategoryInfo>(CATEGORIES.map((c) => [c.slug, c]));

function infoFor(slug: string): CategoryInfo {
  return BY_SLUG.get(slug) ?? OTHER;
}

export function categoryLabel(slug: string): string {
  return infoFor(slug).label;
}

export function categoryIcon(slug: string): Icon {
  return infoFor(slug).icon;
}
