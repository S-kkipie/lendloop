import { preloadQuery } from "convex/nextjs";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { AvailableRegister, RegisterSkeleton, RegisterUnavailable } from "./AvailableRegister";
import { DitherBand } from "./DitherBand";

async function LiveRegister() {
  // The list changes all the time, so it is read per request (never baked
  // into the static shell) and then kept live in the browser.
  await connection();
  let preloaded;
  try {
    preloaded = await preloadQuery(api.tools.listPublic, {});
  } catch (error) {
    unstable_rethrow(error);
    return <RegisterUnavailable />;
  }
  return <AvailableRegister preloaded={preloaded} />;
}

/** The band and, hanging from it, the live register of available tools. */
export function RegisterSection() {
  return (
    <section id="register" aria-labelledby="register-title" className="mt-16 sm:mt-24">
      <DitherBand />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">
        <Suspense fallback={<RegisterSkeleton />}>
          <LiveRegister />
        </Suspense>
      </div>
    </section>
  );
}
