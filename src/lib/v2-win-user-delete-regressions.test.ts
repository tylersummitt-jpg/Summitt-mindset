import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Item #5 cross-cutting regressions: USER DELETE WINS + soft-hide architecture.
 * Source-level proofs; behavioral persist tests live in dedicated modules.
 */
describe("Delete Win architecture regressions", () => {
  const deleteHelper = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-win-user-delete.ts"),
    "utf8"
  );
  const persist = fs.readFileSync(path.join(process.cwd(), "src/lib/v2-win-persist.ts"), "utf8");
  const manualPersist = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-win-manual-persist.ts"),
    "utf8"
  );
  const publicRead = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-win-public-read.ts"),
    "utf8"
  );
  const seasonList = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-victory-season-list.ts"),
    "utf8"
  );
  const seasonWins = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-victory-season-wins.ts"),
    "utf8"
  );
  const editHelper = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-win-user-edit.ts"),
    "utf8"
  );
  const purgeMig = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260731120000_v2_win.sql"),
    "utf8"
  );

  it("delete helper soft-hides only with user_deleted and never reuses stale-recognition hide", () => {
    expect(deleteHelper).toContain('status: "hidden"');
    expect(deleteHelper).toContain("hidden_at");
    expect(deleteHelper).toContain('"user_deleted"');
    expect(deleteHelper).not.toContain("superseded_by_accountability_user_yes_win");
    expect(deleteHelper).not.toContain("hideStaleRecognition");
    expect(deleteHelper).not.toContain(".delete(");
    expect(deleteHelper).not.toContain("v2_win_revision");
    expect(deleteHelper).not.toContain("v2_commitment_event");
    expect(deleteHelper).not.toContain("openai");
  });

  it("recognition persist documents and implements no-reactivate on hidden existing", () => {
    expect(persist).toContain("Hidden existing rows are not restored");
    expect(persist).toContain("lookupExistingWinByKey");
    expect(persist).toMatch(/status:\s*"existing"/);
    const insertStart = persist.indexOf("async function insertV2WinRow");
    expect(insertStart).toBeGreaterThan(0);
    const insertBlock = persist.slice(insertStart, insertStart + 1200);
    expect(insertBlock).toContain("isUniqueViolation");
    expect(insertBlock).not.toContain(".update(");
  });

  it("accountability key remains win_v1:acc_yes and distinct from recognition ordinals", () => {
    expect(persist).toContain("buildAccountabilityWinIdempotencyKey");
    const merge = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-accountability-merge.ts"),
      "utf8"
    );
    expect(merge).toContain("win_v1:acc_yes:");
  });

  it("manual persist returns existing on unique conflict without update/reactivate", () => {
    expect(manualPersist).toContain("isUniqueViolation");
    expect(manualPersist).toContain('status: "existing"');
    expect(manualPersist).toContain("buildManualWinIdempotencyKey");
    const conflictStart = manualPersist.indexOf("if (isUniqueViolation(error))");
    expect(conflictStart).toBeGreaterThan(0);
    const conflictBlock = manualPersist.slice(conflictStart, conflictStart + 500);
    expect(conflictBlock).toContain('status: "existing"');
    expect(conflictBlock).not.toContain(".update(");
  });

  it("public + season readers filter status=active and expose updatedAt for delete concurrency", () => {
    expect(publicRead).toContain('eq("status", "active")');
    expect(publicRead).toContain("updated_at");
    expect(publicRead).toContain("updatedAt:");
    expect(publicRead).not.toContain("source_message_sid");
    expect(seasonWins).toContain('eq("status", "active")');
    expect(seasonList).toContain('eq("status", "active")');
    expect(seasonList).toContain("countActiveWinsByCommitmentIds");
  });

  it("Edit still requires active Win (delete naturally blocks edit)", () => {
    expect(editHelper).toContain('if (data.status !== "active") return null');
    expect(editHelper).toContain("loadOwnedActiveWinForEdit");
  });

  it("account purge still physically deletes v2_win (hidden rows included)", () => {
    expect(purgeMig).toContain("DELETE FROM public.v2_win WHERE clerk_user_id = v_clerk");
  });

  it("VictoryWinCard wires winId + expectedUpdatedAt + editHref for More menu", () => {
    const recent = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryRecentProofSection.tsx"),
      "utf8"
    );
    const all = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryAllProofSection.tsx"),
      "utf8"
    );
    const season = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictorySeasonWinsSection.tsx"),
      "utf8"
    );
    for (const src of [recent, all, season]) {
      expect(src).toContain("winId={w.id}");
      expect(src).toContain("expectedUpdatedAt={w.updatedAt}");
      expect(src).toContain("editHref=");
    }
  });
});
