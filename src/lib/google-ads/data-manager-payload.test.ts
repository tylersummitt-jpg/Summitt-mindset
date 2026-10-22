import { describe, expect, it } from "vitest";

import {
  buildDataManagerIngestBody,
  classifyIngestResponse,
  googleAdsIngestEnabled,
  googleOidcAudience,
  googleStsAudience,
  readGoogleAdsConfig,
  usdAmountFromStripeCents,
  type GoogleAdsConfig,
} from "@/lib/google-ads/data-manager-payload";

const FEDERATION = {
  GOOGLE_CLOUD_PROJECT_NUMBER: "123456789012",
  GOOGLE_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GOOGLE_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL:
    "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com",
};

const config: GoogleAdsConfig = {
  customerId: "2101350707",
  loginCustomerId: null,
  trialActionId: "7861619714",
  paymentActionId: "7861626227",
  projectNumber: "123456789012",
  poolId: "vercel",
  providerId: "vercel",
  serviceAccountEmail: FEDERATION.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL,
};

describe("Data Manager payload", () => {
  it("reads a direct account and keeps a manager id only when configured", () => {
    expect(
      readGoogleAdsConfig({
        GOOGLE_ADS_CUSTOMER_ID: "210-135-0707",
        GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID: "7861619714",
        GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID: "7861626227",
        ...FEDERATION,
      })
    ).toMatchObject({
      customerId: "2101350707",
      loginCustomerId: null,
      serviceAccountEmail: FEDERATION.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL,
    });

    expect(
      readGoogleAdsConfig({
        GOOGLE_ADS_CUSTOMER_ID: "2101350707",
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111-222-3333",
        GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID: "7861619714",
        GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID: "7861626227",
        ...FEDERATION,
      })?.loginCustomerId
    ).toBe("1112223333");

    expect(googleOidcAudience(config)).toBe(
      "https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel"
    );
    expect(googleStsAudience(config)).toBe(
      "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel"
    );

    expect(
      readGoogleAdsConfig({
        GOOGLE_ADS_CUSTOMER_ID: "2101350707",
        GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID: "7861619714",
        GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID: "7861626227",
        GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID: "client",
        GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET: "secret",
        GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN: "refresh",
      })
    ).toBeNull();
    expect(
      readGoogleAdsConfig({
        GOOGLE_ADS_CUSTOMER_ID: "2101350707",
        GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID: "7861619714",
        GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID: "7861626227",
        ...FEDERATION,
        GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL: "",
      })
    ).toBeNull();
    expect(googleAdsIngestEnabled({})).toBe(false);
    expect(googleAdsIngestEnabled({ GOOGLE_ADS_INGEST_ENABLED: "true" })).toBe(true);
  });

  it("builds a click-id trial event without consent or customer data", () => {
    const body = buildDataManagerIngestBody(config, {
      kind: "trial_started",
      transactionId: "start_trial:sub_1",
      eventTimeUnix: 1_700_000_000,
      click: { type: "gclid", value: "EAIaIQobChMI_test" },
      valueUsd: null,
    });
    const encoded = JSON.stringify(body);
    expect(body).toMatchObject({
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "2101350707" },
          productDestinationId: "7861619714",
        },
      ],
      events: [
        {
          adIdentifiers: { gclid: "EAIaIQobChMI_test" },
          eventTimestamp: "2023-11-14T22:13:20.000Z",
          transactionId: "start_trial:sub_1",
          eventSource: "WEB",
        },
      ],
      validateOnly: false,
    });
    expect(encoded).not.toContain("loginAccount");
    expect(encoded).not.toContain("consent");
    expect(encoded).not.toContain("userData");
    expect(encoded).not.toContain("email");
    expect(encoded).not.toContain("phone");
    expect(encoded).not.toContain("ipAddress");
    expect(encoded).not.toContain("conversionValue");
    const event = (body?.events as Array<Record<string, unknown>>)[0];
    expect(Object.keys(event?.adIdentifiers as object)).toEqual(["gclid"]);
  });

  it("sends wbraid or gbraid as that field and the payment amount in USD", () => {
    const wbraid = buildDataManagerIngestBody(config, {
      kind: "trial_started",
      transactionId: "start_trial:sub_1",
      eventTimeUnix: 1_700_000_000,
      click: { type: "wbraid", value: "wbraid_1" },
      valueUsd: null,
    });
    expect((wbraid?.events as Array<Record<string, unknown>>)[0]?.adIdentifiers).toEqual({
      wbraid: "wbraid_1",
    });

    const payment = buildDataManagerIngestBody(
      { ...config, loginCustomerId: "9999999999" },
      {
        kind: "first_payment",
        transactionId: "subscribe:sub_1",
        eventTimeUnix: 1_700_604_800,
        click: { type: "gbraid", value: "gbraid_1" },
        valueUsd: usdAmountFromStripeCents(24900),
      }
    );
    expect(payment).toMatchObject({
      destinations: [
        {
          loginAccount: { accountType: "GOOGLE_ADS", accountId: "9999999999" },
          productDestinationId: "7861626227",
        },
      ],
      events: [
        {
          adIdentifiers: { gbraid: "gbraid_1" },
          conversionValue: 249,
          currency: "USD",
          transactionId: "subscribe:sub_1",
        },
      ],
    });
    expect(usdAmountFromStripeCents(2999)).toBe(29.99);
    expect(usdAmountFromStripeCents(0)).toBeNull();
  });

  it("treats a requestId as ingestion acceptance and not as attribution", () => {
    expect(classifyIngestResponse(200, { requestId: "req-1" })).toEqual({
      outcome: "ingestion_accepted",
      requestId: "req-1",
    });
    expect(classifyIngestResponse(200, {})).toEqual({
      outcome: "not_accepted",
      reason: "missing_request_id",
    });
    expect(classifyIngestResponse(400, { error: { status: "INVALID_ARGUMENT", message: "secret" } })).toEqual({
      outcome: "not_accepted",
      reason: "INVALID_ARGUMENT",
    });
    expect(JSON.stringify(classifyIngestResponse(200, { requestId: "req-1" }))).not.toContain(
      "attributed"
    );
  });
});
