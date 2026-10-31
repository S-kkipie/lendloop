/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as automation_outbox from "../automation/outbox.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_displayName from "../lib/displayName.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_loanTransitions from "../lib/loanTransitions.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_tools from "../lib/tools.js";
import type * as lib_validators from "../lib/validators.js";
import type * as model_dates from "../model/dates.js";
import type * as model_loanMachine from "../model/loanMachine.js";
import type * as model_overlap from "../model/overlap.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "automation/outbox": typeof automation_outbox;
  "lib/audit": typeof lib_audit;
  "lib/config": typeof lib_config;
  "lib/displayName": typeof lib_displayName;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/loanTransitions": typeof lib_loanTransitions;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/tools": typeof lib_tools;
  "lib/validators": typeof lib_validators;
  "model/dates": typeof model_dates;
  "model/loanMachine": typeof model_loanMachine;
  "model/overlap": typeof model_overlap;
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
