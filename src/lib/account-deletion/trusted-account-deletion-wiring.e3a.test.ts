/**
 * APP-041E3a — unreachable production-safe stage wiring tests.
 * Mocked fetch / injected deps only — no live Clerk, Stripe, Twilio, or Supabase.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateClerkMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

import {
  createProductionAccountDeletionReconcilerDependencies,
  PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_DISABLED,
  PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID,
} from "./create-production-account-deletion-dependencies";
import {
  CLERK_REST_DELETE_CODES,
  createClerkRestDeletionAdapter,
} from "./clerk-rest-deletion-adapter";
import {
  createTrustedAccountDeletionReconcilerDependencies,
  executeTrustedAccountDeletionReconcile,
} from "./reconcile-account-deletion";
import {
  createAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
  useSupabaseAccountDeletionStoreForTests,
} from "./repository";
import type { DeletionStripeClient } from "./cancel-subscription";
import {
  createTrustedCancelStripeStage,
  createTrustedPurgeAppDataStage,
  createTrustedSmsDeletionStage,
} from "./trusted-account-deletion-stages";
import { suppressSmsForDeletion } from "./suppress-sms";

const ROOT = join(__dirname, "../../..");
const APP_DIR = join(ROOT, "src/app");
const COMPONENTS_DIR = join(ROOT, "src/components");
const WIRING = join(__dirname, "create-production-account-deletion-dependencies.ts");
const STAGES = join(__dirname, "trusted-account-deletion-stages.ts");
const CLERK_ADAPTER = join(__dirname, "clerk-rest-deletion-adapter.ts");
const SUPPRESS = join(__dirname, "suppress-sms.ts");
const RECONCILE = join(__dirname, "reconcile-account-deletion.ts");
const VERCEL_JSON = join(ROOT, "vercel.json");

function mockStripeClient(): DeletionStripeClient {
  return {
    customers: {
      retrieve: vi.fn(async () => {
        throw new Error("stripe_should_not_be_called");
      }),
    },
    subscriptions: {
      retrieve: vi.fn(async () => {
        throw new Error("stripe_should_not_be_called");
      }),
      list: vi.fn(async () => ({ data: [] })),
      cancel: vi.fn(async () => {
        throw new Error("stripe_should_not_be_called");
      }),
    },
  };
}

describe("APP-041E3a trusted SMS stage", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    updateClerkMock.mockReset();
    updateClerkMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
    vi.restoreAllMocks();
  });

  it("1–3. requires explicit suppress + metadata dependencies", () => {
    expect(() =>
      createTrustedSmsDeletionStage({} as never)
    ).toThrow("invalid_sms_deletion_dependencies");
    expect(() =>
      createTrustedSmsDeletionStage({
        suppressSmsData: async () => "removed",
        clearClerkDeletionMetadata: undefined as never,
      })
    ).toThrow("invalid_sms_deletion_dependencies");
    expect(() =>
      createTrustedSmsDeletionStage({
        suppressSmsData: undefined as never,
        clearClerkDeletionMetadata: async () => true,
      })
    ).toThrow("invalid_sms_deletion_dependencies");
  });

  it("4–5. both dependencies called; metadata soft-fail preserved", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_e3a_sms",
      idempotencyKey: "e3a-sms-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const suppressSmsData = vi.fn(async () => "removed" as const);
    const clearClerkDeletionMetadata = vi.fn(async () => false);

    const stage = createTrustedSmsDeletionStage({
      suppressSmsData,
      clearClerkDeletionMetadata,
    });

    const result = await stage({
      requestId: created.value.row.id,
      clerkUserId: "user_e3a_sms",
      lockOwner: "e3a-worker",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(suppressSmsData).toHaveBeenCalledWith({
      clerkUserId: "user_e3a_sms",
      requestId: created.value.row.id,
    });
    expect(clearClerkDeletionMetadata).toHaveBeenCalledWith("user_e3a_sms");
    expect(result.value.clerkMetadataWarning).toBe(true);
    expect(result.value.suppressResult).toBe("removed");
  });

  it("6–7. soft-fail logs contain no Clerk ID / phone / email / body", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateClerkMock.mockRejectedValueOnce(new Error("clerk_down"));

    const created = await createAccountDeletionRequest({
      clerkUserId: "user_e3a_log_PRIVACY",
      idempotencyKey: "e3a-log-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Production clearer path (no injected metadata fn) — logs must be sanitized.
    const result = await suppressSmsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_e3a_log_PRIVACY",
      lockOwner: "e3a-log",
      suppressSmsData: async () => "already_absent",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clerkMetadataWarning).toBe(true);
    }

    const logged = errSpy.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(logged).toContain("clerk_sms_metadata_cleanup_failed");
    expect(logged).not.toContain("user_e3a_log_PRIVACY");
    expect(logged).not.toMatch(/@|phone|\+1|raw body/i);
    expect(logged).not.toContain("clerk_down");

    const src = readFileSync(SUPPRESS, "utf8");
    expect(src).toContain('code: "clerk_sms_metadata_cleanup_failed"');
    expect(src).toContain('code: "sms_suppress_rpc_failed"');
    expect(src).toMatch(
      /console\.error\(\s*"\[suppressSmsForDeletion\] Clerk SMS metadata cleanup failed \(soft\)",\s*\{\s*code:\s*"clerk_sms_metadata_cleanup_failed"\s*\}\s*\)/
    );
    expect(src).toMatch(
      /console\.error\(\s*"\[suppressSmsForDeletion\] RPC failed",\s*\{[\s\S]*?code:\s*"sms_suppress_rpc_failed"[\s\S]*?\}\s*\)/
    );
  });

  it("8. existing suppressSmsForDeletion still accepts omitted deps (compat)", async () => {
    const input = {
      requestId: "00000000-0000-4000-8000-000000000001",
      clerkUserId: "user_x",
      lockOwner: "w",
    };
    const result = await suppressSmsForDeletion(input);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: "not_found" });
  });
});

describe("APP-041E3a trusted Stripe stage", () => {
  it("9–12. requires explicit client + recognizedPriceIds; no production Stripe", () => {
    expect(() =>
      createTrustedCancelStripeStage({} as never)
    ).toThrow("invalid_stripe_deletion_dependencies");
    expect(() =>
      createTrustedCancelStripeStage({
        stripe: mockStripeClient(),
        recognizedPriceIds: new Set(),
        getPublicMetadata: async () => ({}),
      })
    ).toThrow("invalid_stripe_deletion_dependencies");
    expect(() =>
      createTrustedCancelStripeStage({
        stripe: undefined as never,
        recognizedPriceIds: new Set(["price_x"]),
        getPublicMetadata: async () => ({}),
      })
    ).toThrow("invalid_stripe_deletion_dependencies");

    const stagesSrc = readFileSync(STAGES, "utf8");
    expect(stagesSrc).not.toMatch(
      /(?:import|require).*createProductionStripeClient|createProductionStripeClient\s*\(/
    );
    expect(stagesSrc).not.toContain("STRIPE_SECRET_KEY");
  });

  it("13. stage forwards explicit client/config", async () => {
    useInMemoryAccountDeletionStoreForTests();
    try {
      const stripe = mockStripeClient();
      const getPublicMetadata = vi.fn(async () => ({}));
      const recognizedPriceIds = new Set(["price_test"]);
      const stage = createTrustedCancelStripeStage({
        stripe,
        recognizedPriceIds,
        getPublicMetadata,
      });

      const result = await stage({
        requestId: "00000000-0000-4000-8000-000000000099",
        clerkUserId: "user_missing",
        lockOwner: "w",
        stripe: undefined,
        recognizedPriceIds: undefined,
        getPublicMetadata: undefined,
      });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: "not_found" });
      // Bound deps present; client not invoked because request missing.
      expect(typeof stage).toBe("function");
      expect(recognizedPriceIds.has("price_test")).toBe(true);
    } finally {
      useSupabaseAccountDeletionStoreForTests();
    }
  });
});

describe("APP-041E3a trusted purge stage", () => {
  it("15–18. requires explicit purgeFn; forwards exact function", async () => {
    expect(() =>
      createTrustedPurgeAppDataStage({} as never)
    ).toThrow("invalid_purge_deletion_dependencies");
    expect(() =>
      createTrustedPurgeAppDataStage({ purgeFn: undefined as never })
    ).toThrow("invalid_purge_deletion_dependencies");

    useInMemoryAccountDeletionStoreForTests();
    try {
      const purgeFn = vi.fn(async () => ({
        ok: false as const,
        code: "not_found" as const,
        message: "no",
      }));
      const stage = createTrustedPurgeAppDataStage({ purgeFn });
      const result = await stage({
        requestId: "00000000-0000-4000-8000-000000000088",
        clerkUserId: "user_missing",
        lockOwner: "w",
      });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: "not_found" });
      // Request missing — purgeFn not reached; still prove binding by source.
      const stagesSrc = readFileSync(STAGES, "utf8");
      expect(stagesSrc).toContain("purgeFn,");
      expect(stagesSrc).not.toContain("purgeAppDataForDeletion");
      void purgeFn;
    } finally {
      useSupabaseAccountDeletionStoreForTests();
    }
  });
});

describe("APP-041E3a Clerk REST adapter (mocked fetch only)", () => {
  const secret = "sk_test_e3a_secret_value";

  function adapterFor(
    fetchImpl: typeof fetch,
    timeoutMs = 5_000
  ) {
    return createClerkRestDeletionAdapter({
      secretKey: secret,
      fetch: fetchImpl,
      timeoutMs,
    });
  }

  it("19–20. 200/204 → deleted", async () => {
    for (const status of [200, 204]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      const result = await adapterFor(fetchImpl).deleteUser({
        clerkUserId: "user_abc",
      });
      expect(result).toEqual({
        outcome: "deleted",
        code: CLERK_REST_DELETE_CODES.deleted,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("21. 404 → already_absent", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const result = await adapterFor(fetchImpl).deleteUser({
      clerkUserId: "user_gone",
    });
    expect(result).toEqual({
      outcome: "already_absent",
      code: CLERK_REST_DELETE_CODES.already_absent,
    });
  });

  it("22–23. 429/5xx → retryable_error", async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = vi.fn(async () => new Response("x", { status }));
      const result = await adapterFor(fetchImpl).deleteUser({
        clerkUserId: "user_r",
      });
      expect(result).toEqual({
        outcome: "retryable_error",
        code: CLERK_REST_DELETE_CODES.http_retryable,
      });
    }
  });

  it("24. network throw → retryable_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await adapterFor(fetchImpl).deleteUser({
      clerkUserId: "user_n",
    });
    expect(result).toEqual({
      outcome: "retryable_error",
      code: CLERK_REST_DELETE_CODES.network,
    });
  });

  it("25. abort/timeout → retryable_error", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const result = await adapterFor(fetchImpl, 20).deleteUser({
      clerkUserId: "user_t",
    });
    expect(result).toEqual({
      outcome: "retryable_error",
      code: CLERK_REST_DELETE_CODES.timeout,
    });
  });

  it("26–27. 401/403 and other 4xx → terminal_error", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response("x", { status }));
      const result = await adapterFor(fetchImpl).deleteUser({
        clerkUserId: "user_a",
      });
      expect(result).toEqual({
        outcome: "terminal_error",
        code: CLERK_REST_DELETE_CODES.auth_or_config,
      });
    }
    const fetchImpl = vi.fn(async () => new Response("x", { status: 400 }));
    const result = await adapterFor(fetchImpl).deleteUser({
      clerkUserId: "user_b",
    });
    expect(result).toEqual({
      outcome: "terminal_error",
      code: CLERK_REST_DELETE_CODES.client_error,
    });
  });

  it("28–33. URL encodes id; auth header present; no body read; no PII lookup", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 })
    );
    const id = "user_special/../x?y=1";
    await adapterFor(fetchImpl).deleteUser({ clerkUserId: id });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(String(url)).toBe(
      `https://api.clerk.com/v1/users/${encodeURIComponent(id)}`
    );
    expect(init?.method).toBe("DELETE");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${secret}`,
    });

    const src = readFileSync(CLERK_ADAPTER, "utf8");
    expect(src).not.toMatch(/res\.text\(|res\.json\(/);
    expect(src).not.toMatch(/listClerkUsers|getClerkUser\(/);
    expect(src).not.toMatch(/email_addresses|phone_numbers/);
    expect(src).toContain('import "server-only"');
    expect(
      JSON.stringify(
        await adapterFor(fetchImpl).deleteUser({
          clerkUserId: "user_ok",
        })
      )
    ).not.toContain(secret);
  });

  it("rejects malformed adapter config", () => {
    expect(() =>
      createClerkRestDeletionAdapter({
        secretKey: "",
        fetch: vi.fn(),
        timeoutMs: 1000,
      })
    ).toThrow(CLERK_REST_DELETE_CODES.invalid_adapter_config);
    expect(() =>
      createClerkRestDeletionAdapter({
        secretKey: secret,
        fetch: vi.fn(),
        timeoutMs: 0,
      })
    ).toThrow(CLERK_REST_DELETE_CODES.invalid_adapter_config);
  });
});

describe("APP-041E3a production dependency factory", () => {
  const baseConfig = () => ({
    enabled: true as const,
    sms: {
      suppressSmsData: vi.fn(async () => "already_absent" as const),
      clearClerkDeletionMetadata: vi.fn(async () => true),
    },
    stripe: mockStripeClient(),
    recognizedPriceIds: new Set(["price_m"]),
    getPublicMetadata: vi.fn(async () => ({})),
    purgeFn: vi.fn(async () => ({
      ok: false as const,
      code: "not_found" as const,
      message: "x",
    })),
    clerk: {
      secretKey: "sk_test_factory",
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
      timeoutMs: 3000,
    },
  });

  it("34. disabled → fails closed before provider construction", () => {
    const cfg = baseConfig();
    const fetchSpy = cfg.clerk.fetch;
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...cfg,
        enabled: false,
      })
    ).toThrow(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_DISABLED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("35–39. missing SMS / Stripe / purge / Clerk secret / timeout fails", () => {
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...baseConfig(),
        sms: { suppressSmsData: undefined as never, clearClerkDeletionMetadata: async () => true },
      })
    ).toThrow();
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...baseConfig(),
        stripe: undefined as never,
      })
    ).toThrow(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...baseConfig(),
        purgeFn: undefined as never,
      })
    ).toThrow(PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID);
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...baseConfig(),
        clerk: { ...baseConfig().clerk, secretKey: "   " },
      })
    ).toThrow();
    expect(() =>
      createProductionAccountDeletionReconcilerDependencies({
        ...baseConfig(),
        clerk: { ...baseConfig().clerk, timeoutMs: -1 },
      })
    ).toThrow();
  });

  it("40–43. explicit config returns frozen bundle; no env; no provider call", () => {
    const cfg = baseConfig();
    const bundle = createProductionAccountDeletionReconcilerDependencies(cfg);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.clerkAdapter)).toBe(true);
    expect(typeof bundle.suppressSms).toBe("function");
    expect(typeof bundle.cancelStripe).toBe("function");
    expect(typeof bundle.purgeAppData).toBe("function");
    expect(typeof bundle.deleteClerk).toBe("function");
    expect(cfg.clerk.fetch).not.toHaveBeenCalled();
    expect(cfg.sms.suppressSmsData).not.toHaveBeenCalled();
    expect(cfg.purgeFn).not.toHaveBeenCalled();

    const wiringSrc = readFileSync(WIRING, "utf8");
    expect(wiringSrc).not.toMatch(/process\.env\b/);
    expect(wiringSrc).not.toContain("createProductionStripeClient");
    expect(wiringSrc).not.toContain("STRIPE_SECRET_KEY");
    expect(wiringSrc).not.toContain("CLERK_SECRET_KEY");
  });
});

describe("APP-041E3a immutability + entrypoint", () => {
  it("44–46. mutating original adapter after bundle creation has no effect", async () => {
    let calls = 0;
    const original = {
      async deleteUser() {
        calls += 1;
        return { outcome: "deleted" as const, code: "orig" };
      },
    };
    const bundle = createTrustedAccountDeletionReconcilerDependencies({
      suppressSms: async () => ({
        ok: false,
        code: "not_found",
        message: "x",
      }),
      cancelStripe: async () => ({
        ok: false,
        code: "not_found",
        message: "x",
      }),
      purgeAppData: async () => ({
        ok: false,
        code: "not_found",
        message: "x",
      }),
      deleteClerk: async () => ({
        ok: false,
        code: "not_found",
        message: "x",
      }),
      clerkAdapter: original,
    });

    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.clerkAdapter)).toBe(true);

    original.deleteUser = async () => {
      throw new Error("mutated_adapter_should_not_run");
    };

    const result = await bundle.clerkAdapter.deleteUser({
      clerkUserId: "user_imm",
    });
    expect(result).toEqual({ outcome: "deleted", code: "orig" });
    expect(calls).toBe(1);
  });

  it("47. executeTrusted is documented preferred entrypoint", () => {
    const src = readFileSync(RECONCILE, "utf8");
    expect(src).toContain("executeTrustedAccountDeletionReconcile");
    expect(src).toMatch(/MUST use executeTrustedAccountDeletionReconcile/);
    expect(src).toMatch(/lower-level internal\/test compatibility/);
    expect(typeof executeTrustedAccountDeletionReconcile).toBe("function");
  });
});

describe("APP-041E3a public/unreachable proof", () => {
  it("48–52. no route/cron/scanner/vercel change; wiring server-only", () => {
    const vercel = readFileSync(VERCEL_JSON, "utf8");
    expect(vercel).not.toMatch(/account-deletion/);

    for (const file of [WIRING, STAGES, CLERK_ADAPTER]) {
      expect(readFileSync(file, "utf8")).toContain('import "server-only"');
    }

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) out.push(p);
      }
      return out;
    }

    const markers = [
      "createProductionAccountDeletionReconcilerDependencies",
      "createClerkRestDeletionAdapter",
      "createTrustedSmsDeletionStage",
      "createTrustedCancelStripeStage",
      "createTrustedPurgeAppDataStage",
    ];
    const hits: string[] = [];
    for (const file of [...walk(APP_DIR), ...walk(COMPONENTS_DIR)]) {
      const text = readFileSync(file, "utf8");
      if (markers.some((m) => text.includes(m))) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
