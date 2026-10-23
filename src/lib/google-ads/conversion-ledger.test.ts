import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertSingle = vi.fn();
const selectMaybe = vi.fn();
const updateEq = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    event_kind: "trial_started",
    stripe_subscription_id: "sub_1",
    transaction_id: "start_trial:sub_1",
    event_time: 1_700_000_000,
    value: null,
    currency: null,
    google_click_id_type: "gclid",
    google_click_id: "EAIaIQobChMI_test",
    request_country: "US",
    status: "pending",
    google_request_id: null,
    created_at: "2026-10-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("google ads conversion ledger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertSingle.mockResolvedValue({ data: pendingRow(), error: null });
    selectMaybe.mockResolvedValue({ data: null, error: null });
    updateEq.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "checkout_browser_intents") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ stripe_subscription_id: "sub_1" }], error: null }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: () => insertSingle(),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => selectMaybe(),
            }),
            maybeSingle: () => selectMaybe(),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => updateEq(),
          }),
          in: () => ({
            eq: () => updateEq(),
          }),
        }),
      };
    });
  });

  it("claims a pending trial row", async () => {
    const { claimGoogleAdsConversion } = await import("./conversion-ledger");
    const result = await claimGoogleAdsConversion({
      eventKind: "trial_started",
      stripeSubscriptionId: "sub_1",
      transactionId: "start_trial:sub_1",
      eventTime: 1_700_000_000,
      value: null,
      currency: null,
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("claimed");
    expect(fromMock).toHaveBeenCalledWith("google_ads_conversion_events");
  });

  it("does not claim a second send after ingestion was accepted", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    selectMaybe.mockResolvedValue({
      data: pendingRow({
        status: "ingestion_accepted",
        google_request_id: "req-1",
        event_kind: "first_payment",
        transaction_id: "subscribe:sub_1",
        value: 29.99,
        currency: "USD",
      }),
      error: null,
    });
    const { claimGoogleAdsConversion } = await import("./conversion-ledger");
    const result = await claimGoogleAdsConversion({
      eventKind: "first_payment",
      stripeSubscriptionId: "sub_1",
      transactionId: "subscribe:sub_1",
      eventTime: 1_700_604_800,
      value: 29.99,
      currency: "USD",
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("ingestion_accepted");
  });

  it("suppresses pending rows and clears accepted click ids for a deleted account", async () => {
    const updates: Array<Record<string, unknown>> = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "checkout_browser_intents") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ stripe_subscription_id: "sub_1" }],
                error: null,
              }),
          }),
        };
      }
      return {
        update: (patch: Record<string, unknown>) => ({
          in: () => ({
            eq: (_column: string, status: string) => {
              updates.push({ status, patch });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    });
    const { suppressGoogleAdsConversionsForClerkUser } = await import("./conversion-ledger");
    await suppressGoogleAdsConversionsForClerkUser("user_1");
    expect(updates).toEqual([
      {
        status: "pending",
        patch: expect.objectContaining({
          status: "suppressed",
          google_click_id: null,
          google_click_id_type: null,
          request_country: null,
        }),
      },
      {
        status: "ingestion_accepted",
        patch: expect.objectContaining({
          google_click_id: null,
          google_click_id_type: null,
        }),
      },
    ]);
    expect(JSON.stringify(updates)).not.toContain("EAIaIQobChMI_test");
  });

  it("drops the click id when ingestion is accepted", async () => {
    let patch: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (value: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => {
            patch = value;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }));
    const { markGoogleAdsIngestionAccepted } = await import("./conversion-ledger");
    await markGoogleAdsIngestionAccepted("row-1", "req-1");
    expect(patch).toMatchObject({
      status: "ingestion_accepted",
      google_request_id: "req-1",
      google_click_id: null,
      google_click_id_type: null,
    });
    expect(JSON.stringify(patch)).not.toContain("EAIa");
  });

  it("fails closed when the deletion lookup fails", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: null, error: { code: "42P01" } }),
      }),
    }));
    const { suppressGoogleAdsConversionsForClerkUser } = await import("./conversion-ledger");
    await expect(suppressGoogleAdsConversionsForClerkUser("user_1")).rejects.toThrow(
      "google_ads_conversion_clear_failed"
    );
  });

  it("acquires one send lock when two conditional updates overlap", async () => {
    let lastError: string | null = null;
    fromMock.mockImplementation(() => ({
      update: (patch: { last_error?: string }) => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              or: (filter: string) => ({
                select: () => {
                  expect(filter).toContain("last_error.is.null");
                  expect(filter).toContain("operator_sending");
                  expect(filter).toContain("operator_ambiguous");
                  expect(filter).toContain("operator_blocked");
                  if (
                    lastError === "operator_sending" ||
                    lastError === "operator_ambiguous" ||
                    lastError === "operator_blocked"
                  ) {
                    return Promise.resolve({ data: [], error: null });
                  }
                  lastError = patch.last_error ?? null;
                  return Promise.resolve({ data: [{ id: "row-1" }], error: null });
                },
              }),
            }),
          }),
        }),
      }),
    }));
    const { acquireOperatorGoogleAdsSend } = await import("./conversion-ledger");
    const [first, second] = await Promise.all([
      acquireOperatorGoogleAdsSend("row-1"),
      acquireOperatorGoogleAdsSend("row-1"),
    ]);
    expect([first.status, second.status].sort()).toEqual(["acquired", "not_held"]);
  });

  it("returns busy on the global send-lock unique violation and does not retry", async () => {
    let calls = 0;
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              or: () => ({
                select: () => {
                  calls += 1;
                  if (calls === 1) return Promise.resolve({ data: [{ id: "row-1" }], error: null });
                  return Promise.resolve({ data: null, error: { code: "23505" } });
                },
              }),
            }),
          }),
        }),
      }),
    }));
    const { acquireOperatorGoogleAdsSend } = await import("./conversion-ledger");
    const first = await acquireOperatorGoogleAdsSend("row-1");
    const second = await acquireOperatorGoogleAdsSend("row-2");
    expect(first.status).toBe("acquired");
    expect(second.status).toBe("busy");
    expect(calls).toBe(2);
  });

  it("inserts an operator row already holding the send lock", async () => {
    let payload: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      insert: (value: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            payload = value;
            return Promise.resolve({ data: pendingRow(), error: null });
          },
        }),
      }),
      update: () => {
        throw new Error("operator insert must not update");
      },
    }));
    const { insertOperatorGoogleAdsSend } = await import("./conversion-ledger");
    const result = await insertOperatorGoogleAdsSend({
      eventKind: "trial_started",
      stripeSubscriptionId: "sub_1",
      transactionId: "start_trial:sub_1",
      eventTime: 1_700_000_000,
      value: null,
      currency: null,
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("locked");
    expect(payload).toMatchObject({
      status: "pending",
      last_error: "operator_sending",
      stripe_subscription_id: "sub_1",
    });
  });

  it("stops on the operator-lock conflict without reading or updating a row", async () => {
    fromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "google_ads_conversion_events_operator_send_uq"',
              },
            }),
        }),
      }),
      select: () => {
        throw new Error("operator-lock conflict must not read");
      },
      update: () => {
        throw new Error("operator-lock conflict must not update");
      },
    }));
    const { insertOperatorGoogleAdsSend } = await import("./conversion-ledger");
    await expect(
      insertOperatorGoogleAdsSend({
        eventKind: "trial_started",
        stripeSubscriptionId: "sub_2",
        transactionId: "start_trial:sub_2",
        eventTime: 1_700_000_000,
        value: null,
        currency: null,
        clickType: "gclid",
        clickId: "EAIaIQobChMI_test",
      })
    ).resolves.toEqual({ status: "busy" });
  });

  it("reloads an existing subscription row and does not modify it before the caller locks it", async () => {
    fromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "google_ads_conversion_events_kind_sub_uq"',
              },
            }),
        }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: pendingRow(), error: null }),
          }),
        }),
      }),
      update: () => {
        throw new Error("existing-row conflict must not update");
      },
    }));
    const { insertOperatorGoogleAdsSend } = await import("./conversion-ledger");
    const result = await insertOperatorGoogleAdsSend({
      eventKind: "trial_started",
      stripeSubscriptionId: "sub_1",
      transactionId: "start_trial:sub_1",
      eventTime: 1_700_000_000,
      value: null,
      currency: null,
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("existing");
    if (result.status === "existing") expect(result.row.id).toBe("row-1");
  });

  it("stops on an unknown unique conflict without reading or updating", async () => {
    fromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            }),
        }),
      }),
      select: () => {
        throw new Error("unknown conflict must not read");
      },
      update: () => {
        throw new Error("unknown conflict must not update");
      },
    }));
    const { insertOperatorGoogleAdsSend } = await import("./conversion-ledger");
    await expect(
      insertOperatorGoogleAdsSend({
        eventKind: "trial_started",
        stripeSubscriptionId: "sub_1",
        transactionId: "start_trial:sub_1",
        eventTime: 1_700_000_000,
        value: null,
        currency: null,
        clickType: "gclid",
        clickId: "EAIaIQobChMI_test",
      })
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("leaves a webhook claim unlocked", async () => {
    let payload: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      insert: (value: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            payload = value;
            return Promise.resolve({ data: pendingRow(), error: null });
          },
        }),
      }),
    }));
    const { claimGoogleAdsConversion } = await import("./conversion-ledger");
    const result = await claimGoogleAdsConversion({
      eventKind: "trial_started",
      stripeSubscriptionId: "sub_1",
      transactionId: "start_trial:sub_1",
      eventTime: 1_700_000_000,
      value: null,
      currency: null,
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("claimed");
    expect(payload).not.toHaveProperty("last_error");
  });

  it("does not let a normal error mark replace an operator lock", async () => {
    let filter = "";
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            or: (value: string) => {
              filter = value;
              return Promise.resolve({ error: null });
            },
          }),
        }),
      }),
    }));
    const { markGoogleAdsConversionError } = await import("./conversion-ledger");
    await markGoogleAdsConversionError("row-1", "ingest_disabled");
    expect(filter).toContain("operator_sending");
    expect(filter).toContain("operator_ambiguous");
    expect(filter).toContain("operator_blocked");
  });

  it("treats a second ledger identity as occupied and does not read click ids", async () => {
    let columns = "";
    fromMock.mockImplementation(() => ({
      select: (value: string) => ({
        limit: () => {
          columns = value;
          return Promise.resolve({
            data: [
              {
                id: "row-1",
                event_kind: "trial_started",
                stripe_subscription_id: "sub_1",
                status: "pending",
                google_request_id: null,
                last_error: null,
              },
              {
                id: "row-2",
                event_kind: "trial_started",
                stripe_subscription_id: "sub_2",
                status: "pending",
                google_request_id: null,
                last_error: null,
              },
            ],
            error: null,
          });
        },
      }),
    }));
    const { inspectGoogleAdsTrialOccupancy } = await import("./conversion-ledger");
    await expect(inspectGoogleAdsTrialOccupancy("sub_1")).resolves.toEqual({ status: "blocked" });
    expect(columns).not.toContain("google_click_id");
  });

  it("moves an in-flight lock to ambiguous only while this confirm still holds it", async () => {
    let patch: Record<string, unknown> | null = null;
    const filters: string[] = [];
    fromMock.mockImplementation(() => ({
      update: (value: Record<string, unknown>) => ({
        eq: (_column: string, expected: string) => {
          filters.push(expected);
          return {
            eq: (_statusColumn: string, status: string) => {
              filters.push(status);
              return {
                eq: (lockColumn: string, lock: string) => {
                  filters.push(`${lockColumn}:${lock}`);
                  patch = value;
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        },
      }),
    }));
    const { markOperatorGoogleAdsAmbiguous } = await import("./conversion-ledger");
    await markOperatorGoogleAdsAmbiguous("row-1");
    expect(patch).toMatchObject({ last_error: "operator_ambiguous" });
    expect(filters).toContain("pending");
    expect(filters).toContain("last_error:operator_sending");
  });

  it("lets the send-lock holder continue beside another open pending row", async () => {
    let columns = "";
    fromMock.mockImplementation(() => ({
      select: (value: string) => ({
        limit: () => {
          columns = value;
          return Promise.resolve({
            data: [
              {
                id: "row-1",
                status: "pending",
                last_error: "operator_sending",
                google_request_id: null,
              },
              {
                id: "row-2",
                status: "pending",
                last_error: null,
                google_request_id: null,
              },
            ],
            error: null,
          });
        },
      }),
    }));
    const { assessOperatorSendHold } = await import("./conversion-ledger");
    await expect(assessOperatorSendHold("row-1")).resolves.toEqual({ status: "clear" });
    expect(columns).not.toContain("google_click_id");
  });

  it("stops the holder when another row is already accepted", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        limit: () =>
          Promise.resolve({
            data: [
              {
                id: "row-1",
                status: "pending",
                last_error: "operator_sending",
                google_request_id: null,
              },
              {
                id: "row-2",
                status: "ingestion_accepted",
                last_error: null,
                google_request_id: "req-other",
              },
            ],
            error: null,
          }),
      }),
    }));
    const { assessOperatorSendHold } = await import("./conversion-ledger");
    await expect(assessOperatorSendHold("row-1")).resolves.toEqual({ status: "occupied" });
  });
});
