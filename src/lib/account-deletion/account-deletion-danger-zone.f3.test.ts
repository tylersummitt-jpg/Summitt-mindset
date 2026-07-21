/**
 * APP-041F3 — Account Danger Zone UI tests (flag-hidden).
 * Pure helpers + source/wiring proofs. No live Clerk/Supabase/deletion.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_DELETION_CONFIRM_INSTRUCTION,
  ACCOUNT_DELETION_CONSEQUENCE_BULLETS,
  ACCOUNT_DELETION_CONSEQUENCES_INTRO,
  ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE,
  ACCOUNT_DELETION_CONSEQUENCES_TITLE,
  ACCOUNT_DELETION_DANGER_ZONE_HEADING,
  ACCOUNT_DELETION_DANGER_ZONE_SUPPORT,
  ACCOUNT_DELETION_DANGER_ZONE_TRIGGER,
  ACCOUNT_DELETION_FINAL_ACTION,
  ACCOUNT_DELETION_POST_PATH,
  ACCOUNT_DELETION_RETENTION_CAVEAT,
  ACCOUNT_DELETION_UI_COPY,
  buildAccountDeletionInitiationRequestBody,
  canSubmitAccountDeletionConfirmation,
  isExactAccountDeletionConfirmationInput,
  mapAccountDeletionInitiationResponse,
} from "./account-deletion-danger-zone";
import {
  ACCOUNT_DELETION_CONFIRMATION_VALUE,
  ACCOUNT_DELETION_INITIATION_CODES,
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  ACCOUNT_DELETION_POST_PATH as CONTRACT_POST_PATH,
  isAccountDeletionInitiationCode,
  validateAccountDeletionConfirmation,
} from "./account-deletion-initiation-contract";
import {
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  isExactTrueFlag,
} from "./run-account-deletion-initiation";
import { ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV } from "./run-account-deletion-scheduler";

const ROOT = process.cwd();
const PAGE = join(ROOT, "src/app/user/[[...user]]/page.tsx");
const CLIENT = join(ROOT, "src/app/user/[[...user]]/user-account-client.tsx");
const ZONE = join(ROOT, "src/components/account-deletion-danger-zone.tsx");
const HELPERS = join(
  ROOT,
  "src/lib/account-deletion/account-deletion-danger-zone.ts"
);
const CONTRACT = join(
  ROOT,
  "src/lib/account-deletion/account-deletion-initiation-contract.ts"
);
const SERVER_CORE = join(
  ROOT,
  "src/lib/account-deletion/run-account-deletion-initiation.ts"
);
const NAVBAR = join(ROOT, "src/components/Navbar.tsx");
const DASHBOARD_LAYOUT = join(ROOT, "src/app/dashboard/layout.tsx");
const ONBOARDING = join(ROOT, "src/app/onboarding/page.tsx");
const FILM_ROOM = join(ROOT, "src/app/film-room/page.tsx");
const VERCEL = join(ROOT, "vercel.json");
const ROUTE = join(ROOT, "src/app/api/account/delete/route.ts");

const SERVER_ONLY_IMPORT =
  /from\s+["'](\.?\.?\/)?(.*run-account-deletion-initiation|.*initiate-account-deletion-request|.*verify-account-deletion-reauthentication|.*\/repository|.*supabase-server)["']/;

function existsAsTs(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

function collectLocalImports(
  filePath: string,
  seen = new Set<string>()
): string[] {
  const abs = filePath;
  if (seen.has(abs)) return [...seen];
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  const dir = join(abs, "..");
  const re =
    /from\s+["'](@\/lib\/account-deletion\/[^"']+|\.\.?\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let spec = m[1];
    if (spec.startsWith("@/lib/account-deletion/")) {
      spec = join(
        ROOT,
        "src/lib/account-deletion",
        spec.slice("@/lib/account-deletion/".length)
      );
    } else {
      spec = join(dir, spec);
    }
    if (!spec.endsWith(".ts") && !spec.endsWith(".tsx")) {
      if (existsAsTs(spec + ".ts")) spec = spec + ".ts";
      else if (existsAsTs(spec + ".tsx")) spec = spec + ".tsx";
      else continue;
    }
    collectLocalImports(spec, seen);
  }
  return [...seen];
}

describe("APP-041F3 client/server import boundary", () => {
  it("1–5. client + helpers + contract never import server-only modules", () => {
    const serverOnlyStmt = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

    const contractSrc = readFileSync(CONTRACT, "utf8");
    expect(contractSrc).not.toMatch(serverOnlyStmt);
    expect(contractSrc).not.toMatch(
      /from\s+["'][^"']*(supabase|repository|verify-account-deletion|initiate-account-deletion-request)[^"']*["']/i
    );
    expect(contractSrc).not.toMatch(/\bprocess\.env\b/);

    const helperSrc = readFileSync(HELPERS, "utf8");
    expect(helperSrc).not.toContain("run-account-deletion-initiation");
    expect(helperSrc).toContain("account-deletion-initiation-contract");
    expect(helperSrc).not.toMatch(SERVER_ONLY_IMPORT);

    const zoneSrc = readFileSync(ZONE, "utf8");
    expect(zoneSrc).not.toContain("run-account-deletion-initiation");
    expect(zoneSrc).not.toMatch(SERVER_ONLY_IMPORT);
    expect(zoneSrc).toContain("account-deletion-danger-zone");

    const graph = collectLocalImports(ZONE);
    for (const file of graph) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(serverOnlyStmt);
      expect(file).not.toMatch(/run-account-deletion-initiation\.ts$/);
      expect(file).not.toMatch(/initiate-account-deletion-request\.ts$/);
      expect(file).not.toMatch(/verify-account-deletion-reauthentication\.ts$/);
      expect(file).not.toMatch(/repository\.ts$/);
      expect(file).not.toMatch(/supabase-server/);
    }

    const serverCore = readFileSync(SERVER_CORE, "utf8");
    expect(serverCore).toMatch(serverOnlyStmt);
    expect(serverCore).toContain("account-deletion-initiation-contract");
  });

  it("6–7. response-code union complete; mapping handles every code", () => {
    expect(ACCOUNT_DELETION_INITIATION_CODES).toEqual([
      ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
      "unauthorized",
      "reauth_required",
      "reauth_unavailable",
      "invalid_confirmation",
      "accepted_new",
      "accepted_existing",
      "already_completed",
      "failed_terminal",
      "conflict",
      "internal_error",
    ]);
    for (const code of ACCOUNT_DELETION_INITIATION_CODES) {
      expect(isAccountDeletionInitiationCode(code)).toBe(true);
      const mapped = mapAccountDeletionInitiationResponse({ ok: false, code });
      expect(mapped.message.length).toBeGreaterThan(0);
      expect(mapped.message).not.toContain(code);
      expect(mapped.message).not.toMatch(/\{.*ok.*\}/);
    }
  });
});

describe("APP-041F3 flag gating (exact true only)", () => {
  it("1–4. only exact true enables UI gate", () => {
    expect(isExactTrueFlag(undefined)).toBe(false);
    expect(isExactTrueFlag("")).toBe(false);
    expect(isExactTrueFlag("false")).toBe(false);
    expect(isExactTrueFlag("TRUE")).toBe(false);
    expect(isExactTrueFlag("1")).toBe(false);
    expect(isExactTrueFlag(" true")).toBe(false);
    expect(isExactTrueFlag("true ")).toBe(false);
    expect(isExactTrueFlag("true")).toBe(true);
  });

  it("5. server page gates via shared access helper; no env string to client props", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("shouldShowAccountDeletionDangerZone");
    expect(page).toContain("await auth()");
    expect(page).toContain("AccountDeletionDangerZone");
    expect(page).toContain("showDangerZone ? <AccountDeletionDangerZone");
    expect(page).toContain('surface="dark"');
    expect(page).not.toContain('"use client"');
    expect(page).not.toMatch(/dangerZone=\{process\.env/);
    expect(page).not.toMatch(/enabled=\{process\.env/);
    expect(page).not.toMatch(/userId=\{/);
  });
});

describe("APP-041F3 placement / reachability source proofs", () => {
  it("6–7. no public nav / dashboard / onboarding / Film Room exposure", () => {
    for (const file of [NAVBAR, DASHBOARD_LAYOUT, ONBOARDING, FILM_ROOM]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(
        /Danger zone|Delete account|AccountDeletionDangerZone/i
      );
      expect(src).not.toContain("/api/account/delete");
    }
  });

  it("membership page reuses the same Danger Zone behind the same server helper", () => {
    const membership = readFileSync(
      join(ROOT, "src/app/app/membership/page.tsx"),
      "utf8"
    );
    expect(membership).toContain("shouldShowAccountDeletionDangerZone");
    expect(membership).toContain("AccountDeletionDangerZone");
    expect(membership).toContain('surface="light"');
    expect(membership).toContain('export const dynamic = "force-dynamic"');
    expect(membership).not.toMatch(/userId=\{/);
    expect(membership).not.toContain("ACCOUNT_DELETION_INITIATION_ENABLED");
  });

  it("surface variants keep dark /user and light /app/membership treatments", () => {
    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain('surface = "dark"');
    expect(zone).toContain('"light"');
    expect(zone).toContain("data-account-deletion-surface");
    expect(zone).toContain("bg-red-50");
    expect(zone).toContain("text-red-950");
    expect(zone).toContain("bg-red-800");
    expect(zone).toContain("text-white");
    expect(zone).not.toMatch(/\$29|\$249|free trial|Subscribe|Checkout/i);
  });

  it("8–13. Danger Zone below membership; copy + no dark patterns", () => {
    const client = readFileSync(CLIENT, "utf8");
    const zone = readFileSync(ZONE, "utf8");
    const helpers = readFileSync(HELPERS, "utf8");

    const membershipIdx = client.indexOf("ManageMembershipButton");
    const slotIdx = client.indexOf("account-danger-zone-slot");
    expect(membershipIdx).toBeGreaterThan(-1);
    expect(slotIdx).toBeGreaterThan(membershipIdx);

    expect(helpers).toContain(ACCOUNT_DELETION_DANGER_ZONE_HEADING);
    expect(helpers).toContain(ACCOUNT_DELETION_DANGER_ZONE_SUPPORT);
    expect(helpers).toContain(ACCOUNT_DELETION_DANGER_ZONE_TRIGGER);
    expect(helpers).toContain(ACCOUNT_DELETION_CONSEQUENCES_TITLE);
    expect(helpers).toContain(ACCOUNT_DELETION_CONSEQUENCES_INTRO);
    expect(helpers).toContain(ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE);
    expect(helpers).toContain(ACCOUNT_DELETION_RETENTION_CAVEAT);
    for (const bullet of ACCOUNT_DELETION_CONSEQUENCE_BULLETS) {
      expect(helpers).toContain(bullet);
    }
    expect(zone).toContain("ACCOUNT_DELETION_CONSEQUENCE_BULLETS");
    expect(zone).not.toMatch(
      /discount|special offer|stay for|are you sure you want to leave/i
    );
    expect(zone).not.toMatch(/checkbox|type=\"checkbox\"/);
  });
});

describe("APP-041F3 confirmation + flow helpers", () => {
  it("14–21. exact DELETE only; submit gating", () => {
    expect(isExactAccountDeletionConfirmationInput("DELETE")).toBe(true);
    expect(ACCOUNT_DELETION_CONFIRMATION_VALUE).toBe("DELETE");
    expect(CONTRACT_POST_PATH).toBe("/api/account/delete");
    expect(
      validateAccountDeletionConfirmation({ confirmation: "DELETE" }).ok
    ).toBe(true);
    expect(
      validateAccountDeletionConfirmation({ confirmation: "delete" }).ok
    ).toBe(false);
    for (const v of ["delete", "Delete", " DELETE", "DELETE ", "", "DEL"]) {
      expect(isExactAccountDeletionConfirmationInput(v)).toBe(false);
    }
    expect(canSubmitAccountDeletionConfirmation("idle", "DELETE")).toBe(false);
    expect(
      canSubmitAccountDeletionConfirmation("confirmation", "DELETE")
    ).toBe(true);
    expect(
      canSubmitAccountDeletionConfirmation("confirmation", "delete")
    ).toBe(false);
    expect(
      canSubmitAccountDeletionConfirmation("submitting", "DELETE")
    ).toBe(false);
    expect(canSubmitAccountDeletionConfirmation("error", "DELETE")).toBe(true);
  });
});

describe("APP-041F3 reauth wiring", () => {
  it("22–26. useReverification used; no custom OTP/password; no bypass", () => {
    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain("useReverification");
    expect(zone).toContain("isReverificationCancelledError");
    expect(zone).not.toMatch(/password|otp|one-time|totp/i);
    expect(zone).not.toMatch(/defaultAllow|bypassReauth|skipReauth/);
    expect(zone).not.toContain(
      "verifyAccountDeletionReauthenticationWithClerk(() => true)"
    );
  });
});

describe("APP-041F3 request contract", () => {
  it("27–32. exact POST body path; no ids; single-shot helpers", () => {
    const body = buildAccountDeletionInitiationRequestBody();
    expect(body).toEqual({ confirmation: "DELETE" });
    expect(Object.keys(body)).toEqual(["confirmation"]);
    expect(ACCOUNT_DELETION_POST_PATH).toBe("/api/account/delete");

    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain('method: "POST"');
    expect(zone).toContain("ACCOUNT_DELETION_POST_PATH");
    expect(zone).toContain('Content-Type": "application/json"');
    expect(zone).toContain("buildAccountDeletionInitiationRequestBody()");
    expect(zone).not.toMatch(/userId|clerkUserId|requestId|idempotencyKey/);
    expect(zone).not.toMatch(/setInterval|poll|retry\(/);
    expect(zone).not.toMatch(/while\s*\(/);
  });
});

describe("APP-041F3 response mapping", () => {
  it("33–44. maps codes to safe copy; no raw JSON/codes in messages", () => {
    const cases: Array<[unknown, string, string, boolean?]> = [
      [
        { ok: true, code: "accepted_new" },
        "accepted",
        ACCOUNT_DELETION_UI_COPY.accepted,
      ],
      [
        { ok: true, code: "accepted_existing" },
        "existing",
        ACCOUNT_DELETION_UI_COPY.existing,
      ],
      [
        { ok: true, code: "already_completed" },
        "already_completed",
        ACCOUNT_DELETION_UI_COPY.already_completed,
      ],
      [
        { ok: false, code: "account_deletion_initiation_disabled" },
        "disabled",
        ACCOUNT_DELETION_UI_COPY.unavailable,
      ],
      [
        { ok: false, code: "reauth_required" },
        "error",
        ACCOUNT_DELETION_UI_COPY.reauth,
      ],
      [
        { ok: false, code: "invalid_confirmation" },
        "confirmation",
        ACCOUNT_DELETION_UI_COPY.invalid_confirmation,
      ],
      [
        { ok: false, code: "failed_terminal" },
        "error",
        ACCOUNT_DELETION_UI_COPY.support,
      ],
      [
        { ok: false, code: "conflict" },
        "error",
        ACCOUNT_DELETION_UI_COPY.support,
      ],
      [
        { ok: false, code: "internal_error" },
        "error",
        ACCOUNT_DELETION_UI_COPY.generic,
      ],
    ];
    for (const [body, state, message] of cases) {
      const mapped = mapAccountDeletionInitiationResponse(body);
      expect(mapped.uiState).toBe(state);
      expect(mapped.message).toBe(message);
      expect(mapped.message).not.toContain("accepted_new");
      expect(mapped.message).not.toContain("internal_error");
      expect(mapped.message).not.toMatch(/\{.*ok.*\}/);
    }

    const unauth = mapAccountDeletionInitiationResponse({
      ok: false,
      code: "unauthorized",
    });
    expect(unauth.redirectToSignIn).toBe(true);

    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain("signInPathForClient");
    expect(zone).toContain("useIsNativeSummittMindsetIos");
    expect(zone).toContain("window.location.assign(signInPathForClient(isNativeIos))");
    expect(zone).toContain("mapAccountDeletionInitiationResponse");
    expect(zone).not.toMatch(/JSON\.stringify\(body\)/);
    expect(zone).not.toMatch(/\{JSON\.stringify/);
  });
});

describe("APP-041F3 accessibility + UX wiring", () => {
  it("45–50. labeled region, aria-live, submitting guards", () => {
    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain('role="region"');
    expect(zone).toContain("aria-labelledby");
    expect(zone).toContain('aria-live="polite"');
    expect(zone).toContain("aria-busy");
    expect(zone).toContain("htmlFor={inputId}");
    expect(zone).toContain("inFlightRef.current");
    expect(zone).toContain('event.key !== "Escape"');
    expect(zone).toContain('autoComplete="off"');
    expect(zone).toContain("spellCheck={false}");
    expect(zone).toContain("ACCOUNT_DELETION_CONFIRM_INSTRUCTION");
    expect(zone).toContain("ACCOUNT_DELETION_FINAL_ACTION");
    expect(zone).toContain('href="/sign-out"');
    expect(readFileSync(HELPERS, "utf8")).toContain(
      ACCOUNT_DELETION_CONFIRM_INSTRUCTION
    );
    expect(readFileSync(HELPERS, "utf8")).toContain(
      ACCOUNT_DELETION_FINAL_ACTION
    );
  });
});

describe("APP-041F3 PII / server-client boundary", () => {
  it("51–56. no ids/secrets/flag values in Danger Zone props/HTML helpers", () => {
    const zone = readFileSync(ZONE, "utf8");
    const page = readFileSync(PAGE, "utf8");
    expect(zone).not.toMatch(/userId|clerkUserId|requestId|idempotency/);
    expect(zone).not.toMatch(/process\.env/);
    expect(zone).not.toMatch(/SUPABASE|SERVICE_ROLE|sk_live|sk_test/);
    expect(page).not.toMatch(/clerkUserId|requestId/);
    expect(page).not.toContain("ACCOUNT_DELETION_INITIATION_ENABLED=");
  });
});

describe("APP-041F3 no-scope / no-activation", () => {
  it("57–66. no migration/vercel/cron/providers; flags off; route still dual-gated", () => {
    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    expect(
      migrations.some((f) => /f3|danger.?zone|initiation-contract/i.test(f))
    ).toBe(false);

    const vercel = readFileSync(VERCEL, "utf8");
    expect(vercel).not.toMatch(/ACCOUNT_DELETION_INITIATION|Danger zone/i);

    for (const file of [ZONE, HELPERS, PAGE, CLIENT, CONTRACT]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(
        /executeTrustedAccountDeletionReconcile|suppressSmsForDeletion|acquireAccountDeletionLease|orchestrateClerkDeletion|purgeAppDataForDeletion/
      );
    }

    const route = readFileSync(ROUTE, "utf8");
    expect(route).toContain("resolveAccountDeletionInitiationAccess");
    expect(route).toContain("reverificationError");
    expect(route).toContain('code === "reauth_required"');

    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain("useReverification");

    expect(process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV]).not.toBe(
      "true"
    );
  });

  it("67. no GET status endpoint added", () => {
    const zone = readFileSync(ZONE, "utf8");
    expect(zone).not.toMatch(/method:\s*\"GET\"/);
    expect(zone).not.toMatch(/\/api\/account\/delete\/status/);
    expect(zone).not.toMatch(/account_deletion_requests/);
  });
});

describe("APP-041F3 fetch wrapper behavior (mocked)", () => {
  it("24–25. failed reverification path does not require a successful POST body", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(buildAccountDeletionInitiationRequestBody()).toEqual({
        confirmation: "DELETE",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
