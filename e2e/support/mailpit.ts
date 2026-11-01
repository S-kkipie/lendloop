// The automation stack (n8n + Mailpit, `pnpm stack:up`) is optional for the
// browser suite: with it up, the loan flow also checks the emails n8n sends.
import { existsSync, readFileSync } from "node:fs";

function mailpitUrl(): string {
  const env = existsSync("n8n/.env") ? readFileSync("n8n/.env", "utf8") : "";
  const port = /^MAILPIT_UI_PORT=(\d+)$/m.exec(env)?.[1] ?? "8025";
  return `http://localhost:${port}`;
}

export async function automationStackIsUp(): Promise<boolean> {
  const ok = (url: string) => fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
  const [n8n, mailpit] = await Promise.all([ok("http://localhost:5678/healthz"), ok(`${mailpitUrl()}/api/v1/info`)]);
  return n8n && mailpit;
}

type Message = { Subject: string; To: { Address: string }[] };

/** Subjects of the messages Mailpit holds for this address. */
export async function subjectsFor(address: string): Promise<string[]> {
  const response = await fetch(`${mailpitUrl()}/api/v1/messages?limit=500`);
  const { messages } = (await response.json()) as { messages: Message[] };
  return messages
    .filter((m) => m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()))
    .map((m) => m.Subject);
}
