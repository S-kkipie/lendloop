import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { errorCode, messageForError } from "./convexErrors";

const fail = (code: string, message: string) => new ConvexError({ code, message });

describe("messageForError", () => {
  it.each([
    ["UNAUTHENTICATED", "Sign in required", "Please sign in again."],
    ["FORBIDDEN", "Admins only", "You can't do that."],
    ["NOT_FOUND", "Tool not found", "This item no longer exists."],
    ["RATE_LIMITED", "Slow down", "Too many attempts. Try again in a few minutes."],
  ])("%s uses fixed copy, not the server text", (code, serverMessage, expected) => {
    expect(messageForError(fail(code, serverMessage))).toBe(expected);
  });

  it.each([
    ["INVALID", "Pick an end date on or after the start date."],
    ["CONFLICT", "Those dates overlap an approved booking."],
  ])("%s shows the server message, which is written for users", (code, message) => {
    expect(messageForError(fail(code, message))).toBe(message);
  });

  it.each([
    ["INVALID with an empty message", fail("INVALID", "  ")],
    ["an unknown code", fail("TEAPOT", "I am a teapot")],
    ["a ConvexError with string data", new ConvexError("boom")],
    ["a plain Error", new Error("Network request failed")],
    ["a thrown string", "oops"],
    ["undefined", undefined],
  ])("falls back to generic copy for %s", (_label, error) => {
    expect(messageForError(error)).toBe("Something went wrong. Please try again.");
  });
});

describe("errorCode", () => {
  it("reads the code from a ConvexError", () => {
    expect(errorCode(fail("FORBIDDEN", "Account deleted"))).toBe("FORBIDDEN");
  });

  it.each([
    [new ConvexError({ code: "TEAPOT" })],
    [new ConvexError("boom")],
    [new Error("x")],
    [null],
  ])("returns null when there is no known code (%#)", (error) => {
    expect(errorCode(error)).toBeNull();
  });
});
