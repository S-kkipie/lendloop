"use client";

import { ListIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCommandPalette } from "./CommandPalette";
import { SidebarContent } from "./SidebarNav";
import { UserAvatarButton } from "./UserMenu";
import { Wordmark } from "./Wordmark";

/** Top bar below the desktop breakpoint; the rail lives in a sheet. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { setOpen: setPaletteOpen } = useCommandPalette();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-1 border-b border-border bg-background px-2 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-lg" aria-label="Open navigation" />}>
          <ListIcon className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Pages, search and your account.</SheetDescription>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Link href="/tools" className="flex h-10 items-center rounded-md px-1.5 py-2" aria-label="LendLoop, browse tools">
        <Wordmark />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon-lg" aria-label="Search" onClick={() => setPaletteOpen(true)}>
          <MagnifyingGlassIcon className="size-5" />
        </Button>
        <UserAvatarButton />
      </div>
    </header>
  );
}
