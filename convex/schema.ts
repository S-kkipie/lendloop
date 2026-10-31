import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vActorType,
  vCategory,
  vCloseReason,
  vCondition,
  vEntityType,
  vEventType,
  vLoanStatus,
  vOutboxStatus,
  vToolStatus,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    isTrustedLender: v.boolean(),
    trustedAt: v.optional(v.number()),
    trustedBy: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    status: vToolStatus,
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_status_category", ["status", "category"])
    .index("by_owner", ["ownerId"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
    status: vLoanStatus,
    closeReason: v.optional(vCloseReason),
    approvedAt: v.optional(v.number()),
    handedOverAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status_endDate", ["status", "endDate"])
    .index("by_status_startDate", ["status", "startDate"]),

  outboxEvents: defineTable({
    type: vEventType,
    schemaVersion: v.literal(1),
    loanId: v.optional(v.id("loans")),
    toolId: v.optional(v.id("tools")),
    recipientId: v.id("users"),
    status: vOutboxStatus,
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    replayOf: v.optional(v.id("outboxEvents")),
  })
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"]),

  reminders: defineTable({
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    n8nExecutionId: v.string(),
    error: v.optional(v.string()),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  automationErrors: defineTable({
    workflow: v.string(),
    executionId: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    eventId: v.optional(v.id("outboxEvents")),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
  })
    .index("by_executionId", ["executionId"])
    .index("by_resolved", ["resolvedAt"]),

  automationHeartbeats: defineTable({
    workflow: v.literal("overdue-reminders"),
    lastCheckInAt: v.number(),
  }).index("by_workflow", ["workflow"]),

  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    actorType: vActorType,
    action: v.string(),
    entityType: vEntityType,
    entityId: v.string(),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    reason: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_time", ["at"]),
});
