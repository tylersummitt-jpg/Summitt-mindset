import { describe, expect, it } from "vitest";
import { isAppleMessengerTapbackLine } from "./sms-imessage-reaction";

describe("isAppleMessengerTapbackLine", () => {
  it("detects Liked quotes line", () => {
    expect(isAppleMessengerTapbackLine(`Liked "I appreciate your honesty…"`)).toBe(true);
  });

  it("detects tapback with typographic single quotes", () => {
    expect(isAppleMessengerTapbackLine(`Liked \u2018Nice\u2019`)).toBe(true);
  });

  it("does not flag compliance keywords alone", () => {
    expect(isAppleMessengerTapbackLine("STOP")).toBe(false);
    expect(isAppleMessengerTapbackLine("HELP")).toBe(false);
    expect(isAppleMessengerTapbackLine("START")).toBe(false);
  });

  it("does not flag normal user SMS", () => {
    expect(isAppleMessengerTapbackLine("Yes — got it done before noon.")).toBe(false);
    expect(isAppleMessengerTapbackLine("Ok")).toBe(false);
  });
});
