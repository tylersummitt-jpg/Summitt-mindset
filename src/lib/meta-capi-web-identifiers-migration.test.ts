import { readFileSync } from "node:fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260908220000_meta_capi_web_identifiers.sql"
);

describe("meta_capi_web_identifiers migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates a clerk-keyed nullable identifier table without billing FKs", () => {
    expect(sql).toContain("CREATE TABLE public.meta_capi_web_identifiers");
    expect(sql).toContain("clerk_user_id TEXT PRIMARY KEY");
    expect(sql).toContain("meta_fbclid TEXT NULL");
    expect(sql).toContain("meta_fbclid_observed_at TIMESTAMPTZ NULL");
    expect(sql).toContain("meta_fbc TEXT NULL");
    expect(sql).toContain("meta_fbp TEXT NULL");
    expect(sql).toContain("client_ip TEXT NULL");
    expect(sql).toContain("client_user_agent TEXT NULL");
    expect(sql).not.toMatch(/REFERENCES public\./i);
    expect(sql).not.toMatch(/UNIQUE INDEX/i);
  });

  it("is service-role only with RLS and no client policies", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.meta_capi_web_identifiers FROM anon"
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.meta_capi_web_identifiers FROM authenticated"
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_capi_web_identifiers TO service_role"
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("does not store email, phone, SMS, goals, or card data", () => {
    expect(sql).not.toMatch(/email TEXT|phone TEXT/i);
    expect(sql).toMatch(/No names, emails, phone numbers/);
    expect(sql).toMatch(/Deleted on account deletion/);
  });
});

describe("meta_capi_web_identifiers live purge snippet", () => {
  const snippet = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260909110000_meta_capi_web_identifiers_purge_rpc_snippet.sql"
    ),
    "utf8"
  );

  it("does not replace the live purge RPC and includes the clerk-keyed DELETE", () => {
    expect(snippet).not.toContain(
      "CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion("
    );
    expect(snippet).toContain(
      "DELETE FROM public.meta_capi_web_identifiers WHERE clerk_user_id = v_clerk"
    );
    expect(snippet).toContain("jsonb_build_object('meta_capi_web_identifiers', v_n)");
    expect(snippet).toContain("v_total := v_total + v_n");
  });
});
