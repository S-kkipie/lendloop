import { clerkMiddleware } from "@clerk/nextjs/server";

// Only attaches Clerk's session to requests. Following Clerk's guidance (path
// matching in middleware is deprecated), there are no route rules here:
// app layouts call auth.protect() for UX redirects, and authorization is
// enforced in Convex functions.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
