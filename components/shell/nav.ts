import type { Icon } from "@phosphor-icons/react";
import {
  PaperPlaneTiltIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  TagIcon,
  TrayIcon,
} from "@phosphor-icons/react/ssr";

export interface NavItem {
  href: "/tools" | "/me/listings" | "/me/requests" | "/me/incoming" | "/admin";
  label: string;
  icon: Icon;
  /** Shown only to admins. */
  adminOnly?: boolean;
  /** Carries the live count of pending incoming requests. */
  showsIncomingCount?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/tools", label: "Browse", icon: SquaresFourIcon },
  { href: "/me/listings", label: "My listings", icon: TagIcon },
  { href: "/me/requests", label: "My requests", icon: PaperPlaneTiltIcon },
  { href: "/me/incoming", label: "Incoming", icon: TrayIcon, showsIncomingCount: true },
  { href: "/admin", label: "Admin", icon: ShieldCheckIcon, adminOnly: true },
];

/** /tools/new is "List a tool", not Browse; everything else matches by prefix. */
export function isActive(href: NavItem["href"], pathname: string): boolean {
  if (href === "/tools" && pathname === "/tools/new") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
