import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadAppleIapRootCertificates } from "./certificates";

describe("Apple IAP public root certificates", () => {
  it("loads three DER Apple Root CA certificates", () => {
    const certs = loadAppleIapRootCertificates();
    expect(certs).toHaveLength(3);
    const subjects = certs.map((der) => new X509Certificate(der).subject);
    expect(subjects.some((s) => s.includes("Apple Root CA - G3"))).toBe(true);
    expect(subjects.some((s) => s.includes("Apple Root CA - G2"))).toBe(true);
    expect(
      subjects.some(
        (s) => s.includes("Apple Root CA") && !s.includes("G2") && !s.includes("G3")
      )
    ).toBe(true);
    for (const der of certs) {
      expect(der.includes("PRIVATE KEY")).toBe(false);
    }
  });
});
