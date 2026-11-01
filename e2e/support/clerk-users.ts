// Clerk test users for the Playwright suite, through the Backend API. Emails
// use "+clerk_test", so Clerk sends no mail; passwords are random and only ever
// held in memory (sign-in uses a server-side sign-in token instead).
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const API = process.env.CLERK_API_URL ?? "https://api.clerk.com";

export type E2EUser = { key: "owner" | "borrower"; email: string; firstName: string; lastName: string; clerkId: string };

export const E2E_PEOPLE: Omit<E2EUser, "clerkId">[] = [
  { key: "owner", email: "e2e-owner+clerk_test@example.com", firstName: "Odalys", lastName: "Ownerton" },
  { key: "borrower", email: "e2e-borrower+clerk_test@example.com", firstName: "Bertil", lastName: "Borrowman" },
];

async function clerk<T>(method: string, path: string, body?: unknown): Promise<T> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret?.startsWith("sk_test_")) throw new Error("CLERK_SECRET_KEY (a development instance key) is required");
  const response = await fetch(`${API}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // Clerk error bodies carry codes and messages, never credentials.
    throw new Error(`Clerk ${method} ${path.split("?")[0]} -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export async function findClerkUserIds(emails: string[]): Promise<string[]> {
  const query = emails.map((e) => `email_address=${encodeURIComponent(e)}`).join("&");
  const users = await clerk<{ id: string }[]>("GET", `/users?${query}&limit=50`);
  return users.map((u) => u.id);
}

export async function createClerkUser(person: Omit<E2EUser, "clerkId">): Promise<E2EUser> {
  const created = await clerk<{ id: string }>("POST", "/users", {
    email_address: [person.email],
    first_name: person.firstName,
    last_name: person.lastName,
    password: randomBytes(24).toString("base64url"),
    skip_password_checks: true,
  });
  return { ...person, clerkId: created.id };
}

export async function deleteClerkUser(clerkId: string): Promise<void> {
  await clerk("DELETE", `/users/${encodeURIComponent(clerkId)}`);
}

/** Removes these users' Convex rows and everything they touched (devtools:purgeE2E, ALLOW_DEV_TOOLS only). */
export function purgeConvex(clerkIds: string[]): string {
  const result = spawnSync("pnpm", ["exec", "convex", "run", "devtools:purgeE2E", JSON.stringify({ clerkIds })], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`devtools:purgeE2E failed: ${String(result.stderr).slice(-400)}`);
  return String(result.stdout).trim();
}
