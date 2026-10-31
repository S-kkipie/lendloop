import type { IconProps } from "@phosphor-icons/react";
import { createElement } from "react";
import { categoryIcon } from "@/lib/categories";

/** The Phosphor icon for a category slug (Other's box for anything unknown). */
export function CategoryIcon({ category, ...props }: { category: string } & IconProps) {
  return createElement(categoryIcon(category), props);
}
