/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as automation_contract from "../automation/contract.js";
import type * as automation_delivery from "../automation/delivery.js";
import type * as automation_errors from "../automation/errors.js";
import type * as automation_heartbeat from "../automation/heartbeat.js";
import type * as automation_inbound from "../automation/inbound.js";
import type * as automation_notifications from "../automation/notifications.js";
import type * as automation_outbox from "../automation/outbox.js";
import type * as automation_payloads from "../automation/payloads.js";
import type * as automation_reminders from "../automation/reminders.js";
import type * as clerkWebhook from "../clerkWebhook.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_displayName from "../lib/displayName.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_hmac from "../lib/hmac.js";
import type * as lib_integrationConfig from "../lib/integrationConfig.js";
import type * as lib_loanAccess from "../lib/loanAccess.js";
import type * as lib_loanTransitions from "../lib/loanTransitions.js";
import type * as lib_logger from "../lib/logger.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_tools from "../lib/tools.js";
import type * as lib_validators from "../lib/validators.js";
import type * as loans from "../loans.js";
import type * as model_dates from "../model/dates.js";
import type * as model_delivery from "../model/delivery.js";
import type * as model_heartbeat from "../model/heartbeat.js";
import type * as model_loanMachine from "../model/loanMachine.js";
import type * as model_overlap from "../model/overlap.js";
import type * as seed from "../seed.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "automation/contract": typeof automation_contract;
  "automation/delivery": typeof automation_delivery;
  "automation/errors": typeof automation_errors;
  "automation/heartbeat": typeof automation_heartbeat;
  "automation/inbound": typeof automation_inbound;
  "automation/notifications": typeof automation_notifications;
  "automation/outbox": typeof automation_outbox;
  "automation/payloads": typeof automation_payloads;
  "automation/reminders": typeof automation_reminders;
  clerkWebhook: typeof clerkWebhook;
  crons: typeof crons;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/config": typeof lib_config;
  "lib/displayName": typeof lib_displayName;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/hmac": typeof lib_hmac;
  "lib/integrationConfig": typeof lib_integrationConfig;
  "lib/loanAccess": typeof lib_loanAccess;
  "lib/loanTransitions": typeof lib_loanTransitions;
  "lib/logger": typeof lib_logger;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/tools": typeof lib_tools;
  "lib/validators": typeof lib_validators;
  loans: typeof loans;
  "model/dates": typeof model_dates;
  "model/delivery": typeof model_delivery;
  "model/heartbeat": typeof model_heartbeat;
  "model/loanMachine": typeof model_loanMachine;
  "model/overlap": typeof model_overlap;
  seed: typeof seed;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
