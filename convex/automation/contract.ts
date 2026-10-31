// Wire contract between Convex and n8n. Changing anything here is a breaking
// change for the exported n8n workflows; bump schemaVersion if payloads change.
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const EVENT_ID_HEADER = "x-lendloop-event-id";
export const SIGNATURE_WINDOW_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;
export const MIN_SECRET_LENGTH = 32;
