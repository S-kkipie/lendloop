import { httpRouter } from "convex/server";
import { validate } from "convex-helpers/validators";
import { internal } from "./_generated/api";
import { vAutomationError, vNotificationStatus, vReminderReport } from "./automation/contract";
import { InvalidBody, json, signedEndpoint } from "./automation/inbound";
import { httpAction } from "./lib/functions";

const http = httpRouter();

// For uptime monitors: no data, no auth.
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json(200, { ok: true })),
});

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: signedEndpoint(async (ctx) => {
    await ctx.runMutation(internal.automation.heartbeat.checkIn, {});
    const loans = await ctx.runQuery(internal.automation.reminders.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vReminderReport, body)) throw new InvalidBody();
    const result = await ctx.runMutation(internal.automation.reminders.recordReminder, body);
    return result.accepted ? json(200, result) : json(422, { error: "rejected" });
  }),
});

http.route({
  path: "/n8n/notifications/status",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vNotificationStatus, body)) throw new InvalidBody();
    const result = await ctx.runMutation(internal.automation.notifications.recordNotificationStatus, body);
    return result.found ? json(200, result) : json(404, { error: "not_found" });
  }),
});

http.route({
  path: "/n8n/automation-errors",
  method: "POST",
  handler: signedEndpoint(async (ctx, body) => {
    if (!validate(vAutomationError, body)) throw new InvalidBody();
    return json(200, await ctx.runMutation(internal.automation.errors.recordError, body));
  }),
});

export default http;
