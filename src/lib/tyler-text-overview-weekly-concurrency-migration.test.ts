import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260927120000_weekly_tto_apply_same_text_locks.sql"),
  "utf8"
);

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = MIGRATION.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  const end = next === -1 ? MIGRATION.length : next;
  return MIGRATION.slice(start, end);
}

describe("weekly TTO lock migration", () => {
  it("locks the same current weekly rows in id order and checks events after the lock", () => {
    for (const name of ["weekly_tto_reserve_send", "weekly_tto_apply_tyler_body"]) {
      const body = functionBody(name);
      expect(body).toContain("FOR UPDATE");
      expect(body).toContain("ORDER BY d.id");
      expect(body).toContain("send_slot = 'weekly_review'");
      expect(body).toContain("status = 'current'");
      const lockAt = body.indexOf("FOR UPDATE");
      const eventAt = body.indexOf("sms_weekly_send_events");
      expect(lockAt).toBeGreaterThan(-1);
      expect(eventAt).toBeGreaterThan(lockAt);
    }
    const reserve = functionBody("weekly_tto_reserve_send");
    const insertAt = reserve.indexOf("INSERT INTO public.sms_weekly_send_events");
    const eventAt = reserve.indexOf("sms_weekly_send_events e");
    expect(eventAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(eventAt);
    expect(reserve).toContain("reserved_by_weekly_tto_cron");
    expect(reserve).toContain("reserved_by_weekly_tto_manual_send");
    expect(reserve).toContain("'send_source'");
    expect(reserve).toContain("'draft_id'");
    expect(reserve).toContain("'generation_id'");
    expect(reserve).not.toContain("updated_at");

    const apply = functionBody("weekly_tto_apply_tyler_body");
    expect(apply).toContain("current_body_source = 'tyler_edit'");
    expect(apply).toContain("edited_by_tyler = true");
    expect(apply).not.toContain("machine_should_send");
    expect(apply).not.toContain("INSERT INTO public.sms_daily_drafts");
    const updateAt = apply.indexOf("UPDATE public.sms_daily_drafts");
    expect(updateAt).toBeGreaterThan(apply.indexOf("FOR UPDATE"));
  });

  it("finishes generation only after locking the current draft", () => {
    const body = functionBody("tto_finish_generation_persistence");
    expect(body).toContain("FOR UPDATE");
    const lockAt = body.indexOf("FOR UPDATE");
    const supersedeAt = body.indexOf("superseded_by_generation_id = p_new_generation_id");
    expect(supersedeAt).toBeGreaterThan(lockAt);
    expect(body).toContain("current_body_source = 'tyler_edit'");
    expect(body).toContain("p_protect_tyler_provenance_only");
  });

  it("uses the approved security posture and does not change schema", () => {
    expect(MIGRATION.match(/SECURITY INVOKER/g)?.length).toBe(3);
    expect(MIGRATION.match(/SET search_path = public/g)?.length).toBe(3);
    for (const signature of [
      "weekly_tto_reserve_send(text, text, text)",
      "weekly_tto_apply_tyler_body(uuid, text, text, text, text, text, integer, timestamptz)",
      "tto_finish_generation_persistence(text, text, text, uuid, text, text, timestamptz, boolean)",
    ]) {
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`);
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM anon`);
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM authenticated`);
      expect(MIGRATION).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`);
    }
    expect(MIGRATION).not.toContain("sms_daily_draft_generations.status");
    expect(MIGRATION).not.toContain("sms_weekly_send_events.updated_at");
    expect(MIGRATION).not.toMatch(/\bALTER TABLE\b/);
    expect(MIGRATION).not.toMatch(/\bCREATE TABLE\b/);
    expect(MIGRATION).not.toMatch(/\bADD COLUMN\b/);
    expect(MIGRATION).not.toMatch(/\bCREATE INDEX\b/);
  });
});
