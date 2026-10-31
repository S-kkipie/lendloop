import type { Metadata } from "next";
import { DataPromise } from "./_components/DataPromise";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { RegisterSection } from "./_components/RegisterSection";
import { SiteFooter } from "./_components/SiteFooter";
import { SiteHeader } from "./_components/SiteHeader";

export const metadata: Metadata = {
  title: { absolute: "LendLoop · Borrow what you need. Lend what you don't." },
  description: "A lending board for your street. Every request, handover and return on the record.",
};

// Static shell (header, hero, sections, footer) with two request-time holes:
// the sign-in aware actions and the live register of available tools.
export default function LandingPage() {
  return (
    <div data-page="landing" className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <RegisterSection />
        <HowItWorks />
        <DataPromise />
      </main>
      <SiteFooter />
    </div>
  );
}
