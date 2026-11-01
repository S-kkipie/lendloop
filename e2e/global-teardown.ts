import type { E2EUser } from "./support/clerk-users";
import { deleteClerkUser, purgeConvex } from "./support/clerk-users";

export default async function globalTeardown() {
  const users = JSON.parse(process.env.E2E_USERS ?? "[]") as E2EUser[];
  if (!users.length) return;
  const ids = users.map((u) => u.clerkId);
  console.log(`[e2e] purged: ${purgeConvex(ids).replace(/\s+/g, " ")}`);
  for (const id of ids) await deleteClerkUser(id);
  console.log(`[e2e] deleted ${ids.length} Clerk test users`);
}
