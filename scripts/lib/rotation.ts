// Order of the Convex env updates around an n8n restart, so a rotation never
// rejects a delivery: each verifier learns a new secret before its signer
// starts using it.
//   1. Convex learns the new n8n->Convex secret (keeping the old one as
//      previous), so the restarted n8n's write-backs verify; it keeps signing
//      with the old Convex->n8n secret for now.
//   2. n8n restarts holding the new Convex->n8n secret and the old one as
//      previous, so it accepts whatever Convex signs during and after step 3.
//   3. Convex starts signing with the new Convex->n8n secret.
// Without a running n8n there is nothing to order: n8n reads both secrets when
// it next starts, so Convex is updated once (after n8n/.env is written).
export type RotationStep = { kind: "convex"; values: Map<string, string> } | { kind: "restart-n8n" };

export function rotationPlan(
  convexEnv: Map<string, string>,
  options: { webhookSecretRotated: boolean; oldWebhookSecret?: string; n8nRunning: boolean },
): RotationStep[] {
  const { webhookSecretRotated, oldWebhookSecret, n8nRunning } = options;
  if (!webhookSecretRotated || !oldWebhookSecret || !n8nRunning) return [{ kind: "convex", values: convexEnv }];
  return [
    { kind: "convex", values: new Map(convexEnv).set("N8N_WEBHOOK_SECRET", oldWebhookSecret) },
    { kind: "restart-n8n" },
    { kind: "convex", values: convexEnv },
  ];
}
