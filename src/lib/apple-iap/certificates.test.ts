import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSandboxSignedDataVerifier } from "./verifier";
import { loadAppleIapRootCertificates } from "./certificates";

const CERT_FILES = [
  "AppleIncRootCertificate.cer",
  "AppleRootCA-G2.cer",
  "AppleRootCA-G3.cer",
] as const;

const CERT_SHA256 = [
  "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024",
  "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
] as const;

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

  it("returns the same DER bytes as the checked-in Apple root certificates", () => {
    const certs = loadAppleIapRootCertificates();
    CERT_FILES.forEach((filename, index) => {
      const der = readFileSync(
        join(process.cwd(), "src/lib/apple-iap/certs", filename)
      );
      expect(certs[index]?.equals(der)).toBe(true);
      expect(createHash("sha256").update(certs[index]!).digest("hex")).toBe(
        CERT_SHA256[index]
      );
    });
  });

  it("gives Apple verification the embedded root certificates without reading the filesystem", () => {
    const loaderSrc = readFileSync(
      join(process.cwd(), "src/lib/apple-iap/certificates.ts"),
      "utf8"
    );
    expect(loaderSrc).not.toMatch(/process\.cwd\(/);
    expect(loaderSrc).not.toMatch(/import\.meta\.url/);
    expect(loaderSrc).not.toMatch(/readFileSync|existsSync|readdirSync|node:fs|from ["']fs["']/);
    expect(() =>
      createSandboxSignedDataVerifier({ enableOnlineChecks: false })
    ).not.toThrow();
  });
});
