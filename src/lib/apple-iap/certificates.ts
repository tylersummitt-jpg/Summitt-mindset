/**
 * Public Apple Root CA certificates for SignedDataVerifier.
 *
 * Source (Apple PKI, "Apple Root Certificates"):
 * https://www.apple.com/certificateauthority/
 *
 * Official files:
 * - AppleIncRootCertificate.cer  (Apple Root CA / Apple Inc. Root)
 * - AppleRootCA-G2.cer
 * - AppleRootCA-G3.cer
 *
 * Apple App Store Server Library docs:
 * https://github.com/apple/app-store-server-library-node#obtaining-apple-root-certificates
 *
 * These are PUBLIC CA certificates only. They are not private keys, .p8
 * files, or App Store Connect signing material.
 *
 * The copies in this directory were extracted as DER from the macOS
 * SystemRootCertificates keychain, which ships the same Apple Root CA
 * certificates published on Apple PKI. Fingerprints (SHA-256 of DER):
 *
 * - AppleIncRootCertificate.cer
 *   b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024
 * - AppleRootCA-G2.cer
 *   c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050
 * - AppleRootCA-G3.cer
 *   63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179
 */

import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "node:crypto";
import { AppleIapError } from "./errors";

const CERT_FILENAMES = [
  "AppleIncRootCertificate.cer",
  "AppleRootCA-G2.cer",
  "AppleRootCA-G3.cer",
] as const;

function resolveAppleIapCertsDirectory(): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "certs"),
    join(process.cwd(), "src/lib/apple-iap/certs"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "AppleRootCA-G3.cer"))) return dir;
  }
  throw new AppleIapError(
    "apple_iap_not_configured",
    "Apple public root certificate directory is missing"
  );
}

export function loadAppleIapRootCertificates(): Buffer[] {
  const certsDir = resolveAppleIapCertsDirectory();
  const buffers: Buffer[] = [];

  for (const filename of CERT_FILENAMES) {
    const path = join(certsDir, filename);
    if (!existsSync(path)) {
      throw new AppleIapError(
        "apple_iap_not_configured",
        "Apple public root certificate file is missing"
      );
    }
    const der = readFileSync(path);
    if (der.length === 0) {
      throw new AppleIapError(
        "apple_iap_not_configured",
        "Apple public root certificate file is empty"
      );
    }
    try {
      const parsed = new X509Certificate(der);
      if (!parsed.subject.includes("Apple")) {
        throw new Error("unexpected certificate subject");
      }
    } catch (cause) {
      throw new AppleIapError(
        "apple_iap_not_configured",
        "Apple public root certificate file is not a valid X.509 certificate",
        { cause }
      );
    }
    buffers.push(der);
  }

  return buffers;
}
