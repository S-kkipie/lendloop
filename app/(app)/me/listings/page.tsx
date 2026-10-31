import type { Metadata } from "next";
import { MyListings } from "@/components/tools/MyListings";

// Signed-in area: see app/(app)/layout.tsx.
export const instant = false;

export const metadata: Metadata = { title: "My listings" };

export default function MyListingsPage() {
  return <MyListings />;
}
