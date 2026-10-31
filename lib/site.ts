// Public links shown on the landing page. The repository URL is configuration
// (NEXT_PUBLIC_REPO_URL), never a guess: when it is not set, links that point
// into the repository are left out instead of pointing somewhere made up.

const repo = process.env.NEXT_PUBLIC_REPO_URL?.trim().replace(/\/+$/, "") || null;

export const REPO_URL: string | null = repo;

/** The security notes (threat model, data handling) in the repository. */
export const SECURITY_DOC_URL: string | null = repo ? `${repo}/blob/main/docs/security.md` : null;
