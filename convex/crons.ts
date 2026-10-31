import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("expire stale loans", { minuteUTC: 5 }, internal.loans.expireStale, {});

export default crons;
