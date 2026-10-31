import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("expire stale loans", { minuteUTC: 5 }, internal.loans.expireStale, {});
crons.hourly("check reminder heartbeat", { minuteUTC: 15 }, internal.automation.heartbeat.checkStale, {});

export default crons;
