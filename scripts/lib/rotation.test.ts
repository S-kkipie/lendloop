import { describe, expect, test } from "vitest";
import { rotationPlan } from "./rotation";

const convexEnv = new Map([
  ["APP_URL", "http://localhost:3000"],
  ["N8N_WEBHOOK_SECRET", "new-webhook"],
  ["N8N_WEBHOOK_SECRET_PREVIOUS", "old-webhook"],
  ["CONVEX_INBOUND_SECRET", "new-inbound"],
  ["CONVEX_INBOUND_SECRET_PREVIOUS", "old-inbound"],
]);

describe("rotationPlan", () => {
  test("with n8n running: Convex verifies the new inbound secret first, signs with the new webhook secret only after n8n restarted", () => {
    const plan = rotationPlan(convexEnv, { webhookSecretRotated: true, oldWebhookSecret: "old-webhook", n8nRunning: true });
    expect(plan.map((step) => step.kind)).toEqual(["convex", "restart-n8n", "convex"]);
    const [staged, , final] = plan as [{ values: Map<string, string> }, unknown, { values: Map<string, string> }];
    expect(staged.values.get("N8N_WEBHOOK_SECRET")).toBe("old-webhook");
    expect(staged.values.get("CONVEX_INBOUND_SECRET")).toBe("new-inbound");
    expect(staged.values.get("CONVEX_INBOUND_SECRET_PREVIOUS")).toBe("old-inbound");
    expect(final.values.get("N8N_WEBHOOK_SECRET")).toBe("new-webhook");
    expect(convexEnv.get("N8N_WEBHOOK_SECRET")).toBe("new-webhook"); // input not mutated
  });

  test.each([
    ["no rotation", { webhookSecretRotated: false, oldWebhookSecret: "old-webhook", n8nRunning: true }],
    ["n8n not running", { webhookSecretRotated: true, oldWebhookSecret: "old-webhook", n8nRunning: false }],
    ["first rotation without a previous value", { webhookSecretRotated: true, n8nRunning: true }],
  ])("%s: one Convex update with the final values", (_label, options) => {
    expect(rotationPlan(convexEnv, options)).toEqual([{ kind: "convex", values: convexEnv }]);
  });
});
