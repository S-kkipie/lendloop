import { expect, test } from "vitest";
import { displayName, firstName, maskEmail } from "./displayName";

test("displayName shows first name and last initial", () => {
  expect(displayName("Marta Rodríguez")).toBe("Marta R.");
  expect(displayName("  Ana  María   López ")).toBe("Ana L.");
  expect(displayName("Prince")).toBe("Prince");
  expect(displayName("   ")).toBe("Neighbour");
});

test("firstName", () => {
  expect(firstName("Marta Rodríguez")).toBe("Marta");
  expect(firstName("")).toBe("Neighbour");
});

test("maskEmail keeps first letter and domain", () => {
  expect(maskEmail("marta@example.com")).toBe("m***@example.com");
  expect(maskEmail(null)).toBeNull();
  expect(maskEmail("broken")).toBe("***");
});
