# PII map

Every piece of personal data LendLoop handles: where it is stored, who can see it, whether it leaves Convex, whether it can reach logs, how long it is kept, and what happens when the account is deleted. Rule of the data model: **outbox, audit log and logs reference IDs, never personal data.**

Related: [security](security.md), [integration payloads](integration.md#payloads-contract-v1), [ADR 0007](adr/0007-ids-only-outbox.md).

## How other people see a user

| Context | What is shown | Code |
|---|---|---|
| Public landing page | nothing about any user (tool name and category only) | `tools.listPublic` |
| Other signed-in neighbours | display name "Marta R." (first name and last initial), Trusted Lender badge | `displayName` in `convex/lib/displayName.ts` |
| The other party on a loan | display name; first name in emails | `summarizeLoan`, `buildNotificationPayload` |
| Admins | display name and masked email `m***@example.com` | `admin.listUsers`, `maskEmail` |
| The user themself | own display name, own email, role | `users.me` |

Nobody, admins included, sees another user's full name or full email in the app.

## Convex tables

| Field | Table | Source | Who sees it | Sent to n8n | In logs | Retention | On account deletion |
|---|---|---|---|---|---|---|---|
| Full name | `users.name` | Clerk `name` claim, `user.updated` webhook | nobody in full; others see display name | first name only, at send time (as recipient or counterpart) | no (`name`/`firstName` keys redacted) | until deletion | replaced with "Former neighbour" |
| Email | `users.email` | Clerk `email` claim, webhook | the user; admins see it masked | the recipient's own email, at send time | no (key redacted, email patterns stripped) | until deletion | set to `null` |
| Clerk user ID, token identifier | `users.clerkId`, `users.tokenIdentifier` | Clerk token | nobody in the UI | no | IDs only if logged | until deletion | kept (pseudonymous; needed so late webhooks and sign-ins cannot recreate the account) |
| Trusted Lender flag, `trustedAt`, `trustedBy` | `users` | admin action | signed-in neighbours see the badge | no | no | until changed | flag cleared |
| Tool name | `tools.name` | owner | **everyone, including the public landing page** while listed and available | yes (`tool.name`) | no | indefinitely (soft delete) | listing removed (`status: removed`), text kept |
| Tool description | `tools.description` | owner | signed-in neighbours | never | no | indefinitely | listing removed, text kept |
| Removal reason | `tools.removalReason`, `auditLog.reason` | admin | the owner and admins | no | no | indefinitely | kept |
| Loan dates | `loans.startDate`, `endDate` | borrower | the two parties and admins; others see booked ranges without identity | yes (own loans) | no | indefinitely | kept with the loan |
| Borrower's message | `loans.message` | borrower | the tool owner only (not admins) | never | no (`message` key redacted) | indefinitely | **kept** (known limitation) |
| Loan parties | `loans.ownerId`, `borrowerId` | system | parties and admins, as display names | counterpart first name only | IDs only | indefinitely | IDs kept; names resolve to "Former neighbour" |
| Overdue state | derived, not stored | system | the two parties and admins. Other neighbours' UI shows only "On loan" once the return date has passed, but `tools.browse` and `tools.get` still return that date (without identity), so lateness can be inferred | yes, in reminders (`daysOverdue`) | no | n/a | n/a |
| Outbox event | `outboxEvents` | system | admins (type, status, sanitized error), parties on the timeline | the payload is built from other tables at send time | event ID and status | indefinitely | pending events for the deleted user become `skipped` |
| Reminder record | `reminders` | n8n write-back | parties on the timeline, admins (counts) | n/a | no | indefinitely | kept (IDs only) |
| Automation error | `automationErrors.message` | n8n (emails stripped twice) | admins | n/a | workflow, execution, node | until resolved, then kept | kept (no personal data by construction) |
| Audit entry | `auditLog` | system | admins; parties for their loan | no | no | indefinitely, append-only | kept (IDs only; actor shows as "Former neighbour") |
| Rate-limit state | rate limiter component | system | nobody | no | no | rolling window | keyed by user ID only |

Demo data from `pnpm seed` is fictional and those users cannot sign in. Their addresses are Resend's sink mailbox (`delivered+marta@resend.dev` and so on), which accepts and discards mail, so demo notifications never bounce off the production sending domain.

## Other systems

| System | Personal data | Who sees it | Retention | Notes |
|---|---|---|---|---|
| Clerk | account: email, name, sign-in methods, sessions, IP and device metadata | the user; the Clerk dashboard owner | Clerk's policy, until the user is deleted in Clerk | Deleting the user in Clerk triggers `user.deleted` → anonymization in Convex |
| n8n (Postgres) | error executions only: the failed run's input, which can include the recipient's email, first names, tool name, dates | the n8n owner | 7 days (`EXECUTIONS_DATA_MAX_AGE=168`), successful runs not stored | Dedupe history holds event IDs only |
| SMTP provider (Resend in production) | recipient email, subject and body (first names, tool name, dates, a link) | the Resend account owner | Resend's log retention | Sending-only API key scoped to the domain |
| Mailpit (local) | every email the local stack sends | anyone with access to `localhost:8025` | until the container is recreated | Local only |
| `OPS_EMAIL` inbox | workflow name, node name, execution ID | operators | the mailbox's | No user data by construction |
| Convex logs | redacted JSON lines (IDs, statuses, reasons) | deployment admins | Convex's log retention | See [logging](security.md#logging-and-redaction) |
| Browser | Clerk session cookies; Convex client cache of what the user may see | the user | session | LendLoop's own code uses no `localStorage`, `sessionStorage` or cookies |

## Emails

| Email | To | Contains |
|---|---|---|
| Loan notifications (8 types) | the recipient's own address | recipient first name, counterpart first name, tool name, loan dates, a link to the loan or listings |
| Overdue reminder | the borrower | borrower first name, tool name, due date, days overdue |
| Ops fallback | `OPS_EMAIL` | workflow, node, execution ID |

Emails never contain last names, the other party's email, the borrower's message or tool descriptions. They are plain text, so no tracking pixels or remote images.

## Account deletion

Triggered by Clerk's `user.deleted` webhook (`convex/users.ts` `deleteAccount`, tested in `convex/clerkWebhook.test.ts`):

1. Each listed tool of the user is removed; its pending and approved loans are cancelled (`listing_removed`) and their borrowers notified.
2. The user's pending and approved requests as a borrower are cancelled (`account_deleted`) and the owners notified (`loan.cancelled`).
3. Active loans stay, so the other party can close them.
4. The row is anonymized: name "Former neighbour", email `null`, Trusted flag cleared, `deletedAt` set. Later sign-ins with the same Clerk identity are refused, and later `user.updated` events are ignored.
5. One audit entry `user.delete`.

Not erased (see [known limitations](security.md#known-limitations)): the row's Clerk ID, borrower messages on loans, names and descriptions of removed listings, emails already delivered, and n8n error executions until they age out after 7 days. There is no self-service export; the production plan is in [production.md](production.md#data-subject-rights).
