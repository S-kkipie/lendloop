// How other people see a user: never the full name, never the email.
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Neighbour";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "Neighbour";
}

export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.charAt(0)}***${email.slice(at)}`;
}
