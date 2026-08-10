import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260810140000_v2_win_media.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

describe("v2_win_media migration (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("orders after v2_win_user_edit migration", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.indexOf("20260810140000_v2_win_media.sql")).toBeGreaterThan(
      files.indexOf("20260809120000_v2_win_user_edit.sql")
    );
  });

  it("creates v2_win_media with one-photo unique, MMS partial unique, cascade FK", () => {
    expect(sql).toContain("CREATE TABLE public.v2_win_media");
    expect(sql).toContain("REFERENCES public.v2_win (id) ON DELETE CASCADE");
    expect(sql).toContain("CONSTRAINT v2_win_media_win_id_uq UNIQUE (win_id)");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_v2_win_media_mms_provenance");
    expect(sql).toContain("mime_type = 'image/jpeg'");
    expect(sql).toContain("source_type IN ('web_upload', 'inbound_mms')");
    expect(sql).toContain("CONSTRAINT v2_win_media_provenance_chk");
  });

  it("creates v2_inbound_media_job with status/resolution checks and SET NULL FK", () => {
    expect(sql).toContain("CREATE TABLE public.v2_inbound_media_job");
    expect(sql).toContain("REFERENCES public.v2_win (id) ON DELETE SET NULL");
    expect(sql).toContain(
      "CONSTRAINT v2_inbound_media_job_message_ordinal_uq UNIQUE (message_sid, media_ordinal)"
    );
    expect(sql).toContain("'pending_download'");
    expect(sql).toContain("'tombstoned'");
    expect(sql).toContain("'skipped_conflict'");
    expect(sql).toContain("'user_priority_blocked'");
    expect(sql).toContain("'acc_win'");
    // Table must not persist Twilio MediaUrl or inbound message body columns.
    const tableStart = sql.indexOf("CREATE TABLE public.v2_inbound_media_job");
    const tableEnd = sql.indexOf(";", tableStart);
    const tableSql = sql.slice(tableStart, tableEnd);
    expect(tableSql).not.toMatch(/media_url/i);
    expect(tableSql).not.toMatch(/\bbody\b/i);
    expect(sql).toContain("Does not store MediaUrl or message body");
  });

  it("enables RLS and restricts grants to service_role only", () => {
    for (const table of ["v2_win_media", "v2_inbound_media_job"]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`);
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM authenticated`
      );
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC`);
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM service_role`
      );
      expect(sql).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO service_role`
      );
    }
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]{0,80}v2_win_media/i
    );
    expect(sql).not.toMatch(
      /GRANT[\s\S]{0,40}ON TABLE public\.v2_win_media[\s\S]{0,40}TO authenticated/i
    );
  });

  it("extends purge to delete media tables before v2_win", () => {
    expect(sql).toContain(
      "DELETE FROM public.v2_inbound_media_job WHERE clerk_user_id = v_clerk"
    );
    expect(sql).toContain(
      "DELETE FROM public.v2_win_media WHERE clerk_user_id = v_clerk"
    );
    expect(sql).toContain("jsonb_build_object('v2_win_media', v_n)");
    expect(sql).toContain("jsonb_build_object('v2_inbound_media_job', v_n)");
    const inboundIdx = sql.indexOf(
      "DELETE FROM public.v2_inbound_media_job WHERE clerk_user_id = v_clerk"
    );
    const mediaIdx = sql.indexOf(
      "DELETE FROM public.v2_win_media WHERE clerk_user_id = v_clerk"
    );
    const winIdx = sql.indexOf(
      "DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk"
    );
    expect(inboundIdx).toBeGreaterThan(-1);
    expect(mediaIdx).toBeGreaterThan(inboundIdx);
    expect(winIdx).toBeGreaterThan(mediaIdx);
    expect(sql).toContain("Does not delete Supabase Storage objects");
  });
});
