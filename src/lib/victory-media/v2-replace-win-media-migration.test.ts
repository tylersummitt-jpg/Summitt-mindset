import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260812120000_v2_replace_win_media.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

describe("v2_replace_win_media migration (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("orders after v2_win_media migration", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.indexOf("20260812120000_v2_replace_win_media.sql")).toBeGreaterThan(
      files.indexOf("20260810140000_v2_win_media.sql")
    );
  });

  it("creates SECURITY INVOKER RPC with public search_path", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.v2_replace_win_media(");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = public");
  });

  it("1–3. locks owned active v2_win FOR UPDATE before v2_win_media FOR UPDATE", () => {
    const winSelectStart = sql.indexOf("FROM public.v2_win");
    const winForUpdate = sql.indexOf("FOR UPDATE", winSelectStart);
    const mediaSelectStart = sql.indexOf("FROM public.v2_win_media");
    const mediaForUpdate = sql.indexOf("FOR UPDATE", mediaSelectStart);

    expect(winSelectStart).toBeGreaterThan(-1);
    expect(winForUpdate).toBeGreaterThan(winSelectStart);
    expect(mediaSelectStart).toBeGreaterThan(winForUpdate);
    expect(mediaForUpdate).toBeGreaterThan(mediaSelectStart);

    const winBlock = sql.slice(winSelectStart, mediaSelectStart);
    expect(winBlock).toContain("status = 'active'");
    expect(winBlock).toContain("FOR UPDATE");

    const mediaBlock = sql.slice(mediaSelectStart, mediaForUpdate + "FOR UPDATE".length);
    expect(mediaBlock).toContain("FOR UPDATE");
  });

  it("4–6. existing replay returns existing with NULL old cleanup columns", () => {
    const replayStart = sql.indexOf("IF v_old.id = p_new_media_id THEN");
    expect(replayStart).toBeGreaterThan(-1);
    const replayEnd = sql.indexOf(
      "IF v_old.id IS DISTINCT FROM p_expected_media_id THEN",
      replayStart
    );
    const replayBlock = sql.slice(replayStart, replayEnd);
    expect(replayBlock).toContain("'existing'::TEXT");
    expect(replayBlock).toContain("NULL::UUID");
    expect(replayBlock).toMatch(/NULL::TEXT[\s\S]*NULL::TEXT[\s\S]*NULL::TEXT/);
    expect(replayBlock).not.toContain("v_old.storage_master_path");
    expect(replayBlock).not.toContain("v_old.storage_card_path");
    expect(replayBlock).not.toContain("v_old.id,");
    expect(replayBlock).not.toContain("v_old.source_type");
  });

  it("7. replaced result still returns actual OLD media id/master/card paths", () => {
    const replacedStart = sql.indexOf("'replaced'::TEXT");
    expect(replacedStart).toBeGreaterThan(-1);
    const replacedBlock = sql.slice(replacedStart, sql.indexOf("END;", replacedStart));
    expect(replacedBlock).toContain("v_old.id");
    expect(replacedBlock).toContain("v_old.storage_master_path");
    expect(replacedBlock).toContain("v_old.storage_card_path");
    expect(replacedBlock).toContain("v_old.source_type");
  });

  it("8. expectedMediaId check remains before mutation", () => {
    const expectedCheck = sql.indexOf(
      "v_old.id IS DISTINCT FROM p_expected_media_id"
    );
    const deleteIdx = sql.indexOf("DELETE FROM public.v2_win_media");
    const insertIdx = sql.indexOf("INSERT INTO public.v2_win_media");
    expect(expectedCheck).toBeGreaterThan(-1);
    expect(expectedCheck).toBeLessThan(deleteIdx);
    expect(deleteIdx).toBeLessThan(insertIdx);
    expect(sql).toContain("'stale_conflict'");
  });

  it("9. MMS tombstone behavior unchanged", () => {
    expect(sql).toContain("inbound_mms");
    expect(sql).toContain("UPDATE public.v2_inbound_media_job");
    expect(sql).toContain("status = 'tombstoned'");
    expect(sql).toContain("resolution = 'removed'");
    expect(sql).toContain("v2_replace_win_media_mms_tombstone_missing");
    const expectedCheck = sql.indexOf(
      "v_old.id IS DISTINCT FROM p_expected_media_id"
    );
    const tombstoneUpdate = sql.indexOf("UPDATE public.v2_inbound_media_job");
    const deleteIdx = sql.indexOf("DELETE FROM public.v2_win_media");
    expect(tombstoneUpdate).toBeGreaterThan(expectedCheck);
    expect(tombstoneUpdate).toBeLessThan(deleteIdx);
  });

  it("10. security/grants unchanged", () => {
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.v2_replace_win_media("
    );
    expect(sql).toContain("FROM PUBLIC");
    expect(sql).toContain("FROM anon");
    expect(sql).toContain("FROM authenticated");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.v2_replace_win_media("
    );
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.v2_replace_win_media[\s\S]{0,200}TO (anon|authenticated)/
    );
  });

  it("delete+insert new web_upload row with null MMS provenance", () => {
    expect(sql).toContain("DELETE FROM public.v2_win_media");
    expect(sql).toContain("INSERT INTO public.v2_win_media");
    expect(sql).toContain("'web_upload'");
    expect(sql).toMatch(/INSERT INTO public\.v2_win_media[\s\S]*NULL,\s*NULL,\s*NULL/);
    expect(sql).toContain("p_new_media_id");
  });

  it("returns replaced/stale/not_found/no_media/existing", () => {
    expect(sql).toContain("'replaced'");
    expect(sql).toContain("'stale_conflict'");
    expect(sql).toContain("'not_found'");
    expect(sql).toContain("'no_media'");
    expect(sql).toContain("'existing'");
  });

  it("uses INTEGER byte/dimension params matching v2_win_media", () => {
    expect(sql).toContain("p_byte_size INTEGER");
    expect(sql).toContain("p_card_byte_size INTEGER");
    expect(sql).toContain("p_width INTEGER");
    expect(sql).toContain("p_height INTEGER");
  });
});
