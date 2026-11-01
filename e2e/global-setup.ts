import { clerkSetup } from "@clerk/testing/playwright";
import { E2E_PEOPLE, createClerkUser, deleteClerkUser, findClerkUserIds, purgeConvex } from "./support/clerk-users";

// Runs once, before the workers start: values put on process.env here reach
// every test (Clerk's testing token, and the users' emails and IDs; no passwords).
export default async function globalSetup() {
  await clerkSetup();
  // Leftovers from an interrupted run: clear their data, then the accounts.
  const stale = await findClerkUserIds(E2E_PEOPLE.map((p) => p.email));
  if (stale.length) {
    purgeConvex(stale);
    for (const id of stale) await deleteClerkUser(id);
  }
  const users = [];
  for (const person of E2E_PEOPLE) users.push(await createClerkUser(person));
  process.env.E2E_USERS = JSON.stringify(users);
}
