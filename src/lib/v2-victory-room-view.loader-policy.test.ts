import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const VIEW_SRC = readFileSync(join(process.cwd(), "src/lib/v2-victory-room-view.ts"), "utf8");
const PAGE_SRC = readFileSync(join(process.cwd(), "src/app/dashboard/victory-room/page.tsx"), "utf8");
const ALL_PROOF_PAGE_SRC = readFileSync(
  join(process.cwd(), "src/app/dashboard/victory-room/all-proof/page.tsx"),
  "utf8"
);
const ALL_PROOF_VIEW_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-all-proof-view.ts"),
  "utf8"
);
const WIN_PUBLIC_SRC = readFileSync(join(process.cwd(), "src/lib/v2-win-public-read.ts"), "utf8");
const PAT_READ_SRC = readFileSync(join(process.cwd(), "src/lib/v2-victory-pat-read.ts"), "utf8");
const PERSIST_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-pat-read-persist.ts"),
  "utf8"
);
const PRINCIPLES_PERSIST_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-principles-persist.ts"),
  "utf8"
);
const PRINCIPLES_MAP_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-principles-map.ts"),
  "utf8"
);
const COMPLETE_BTN = readFileSync(
  join(process.cwd(), "src/components/CompleteOnboardingButton.tsx"),
  "utf8"
);
const SEASON_PAGE_SRC = readFileSync(
  join(process.cwd(), "src/app/dashboard/victory-room/seasons/[seasonId]/page.tsx"),
  "utf8"
);
const SEASON_PROOF_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-season-proof-view.ts"),
  "utf8"
);
const SEASON_LIST_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-season-list.ts"),
  "utf8"
);
const SEASON_SUMMARY_PERSIST_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-season-summary-persist.ts"),
  "utf8"
);
const EARLIER_INDEX_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-earlier-chapter-index.ts"),
  "utf8"
);
const EARLIER_PROOF_SRC = readFileSync(
  join(process.cwd(), "src/lib/v2-victory-earlier-chapter-proof-view.ts"),
  "utf8"
);
const HISTORY_PAGE_SRC = readFileSync(
  join(process.cwd(), "src/app/dashboard/victory-room/history/page.tsx"),
  "utf8"
);
const CHAPTER_PAGE_SRC = readFileSync(
  join(process.cwd(), "src/app/dashboard/victory-room/chapters/[commitmentId]/page.tsx"),
  "utf8"
);

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

describe("Victory Room loader policy", () => {
  it("uses reduced active event fetch limit instead of 2500 on default load", () => {
    expect(VIEW_SRC).toContain("ACTIVE_EVENT_FETCH_LIMIT = 400");
    expect(VIEW_SRC).toMatch(/\.limit\(ACTIVE_EVENT_FETCH_LIMIT\)/);
    const loadSection = VIEW_SRC.slice(VIEW_SRC.indexOf("export async function loadVictoryRoomView"));
    expect(loadSection).not.toMatch(/loadPriorChaptersView\(/);
    expect(loadSection).not.toContain("loadV2CoachingMemoryForPrompt");
    expect(loadSection).toContain("buildChronologicalProofList");
    expect(loadSection).toContain("buildHomeDisplayWinsList");
    expect(loadSection).toContain("PROOF_FEED_MOMENTS_LIMIT");
    expect(loadSection).toContain("RECENT_WINS_DISPLAY_LIMIT");
    expect(loadSection).not.toContain("curateRecentProofMoments(merged");
  });

  it("Victory Room and All Proof pages are force-dynamic and avoid OpenAI", () => {
    expect(PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(ALL_PROOF_PAGE_SRC).toContain('export const dynamic = "force-dynamic"');
    expect(PAGE_SRC).not.toContain("openai");
    expect(ALL_PROOF_PAGE_SRC).not.toContain("openai");
    expect(ALL_PROOF_VIEW_SRC).not.toContain("openai");
  });

  it("All Wins loader uses v2_win public read (not commitment-event scan)", () => {
    expect(ALL_PROOF_VIEW_SRC).toContain("loadPublicAllWinsForUser");
    expect(ALL_PROOF_VIEW_SRC).toContain("v2-win-public-read");
    expect(ALL_PROOF_VIEW_SRC).not.toContain("ALL_PROOF_EVENT_FETCH_LIMIT");
    expect(ALL_PROOF_VIEW_SRC).not.toContain("groupEventRowsByCommitmentId");
    expect(ALL_PROOF_VIEW_SRC).not.toContain("v2_commitment_event");
  });

  it("public v2_win read is server-only, clerk-scoped, active-only", () => {
    expect(WIN_PUBLIC_SRC).toContain('import "server-only"');
    expect(WIN_PUBLIC_SRC).toContain('eq("clerk_user_id"');
    expect(WIN_PUBLIC_SRC).toContain('eq("status", "active")');
    expect(WIN_PUBLIC_SRC).toContain("PUBLIC_WINS_RECENT_LIMIT = 7");
    expect(WIN_PUBLIC_SRC).toContain("PUBLIC_WINS_PAGE_LIMIT = 50");
    expect(WIN_PUBLIC_SRC).not.toContain("GRANT");
    expect(WIN_PUBLIC_SRC).not.toContain("DISABLE ROW LEVEL SECURITY");
  });

  it("page does not call OpenAI summary on render", () => {
    expect(PAGE_SRC).not.toContain("resolveVictoryRoomSummaryParagraph");
    expect(PAGE_SRC).not.toContain("generateVictorySummaryParagraph");
    expect(PAGE_SRC).not.toContain("v2-victory-room-summary");
    expect(PAGE_SRC).not.toContain("openai");
    expect(PAGE_SRC).not.toContain("OPENAI_API_KEY");
    expect(PAGE_SRC).toContain("loadVictoryRoomView(user.id, { timeZone })");
    expect(PAGE_SRC).toContain("loadPublicVictoryWinsForUser");
    expect(PAGE_SRC).toContain("v2-win-public-read");
    expect(PAGE_SRC).not.toContain("VictoryEvidenceSection");
    expect(PAGE_SRC).not.toContain("view.recentWins");
    expect(PAGE_SRC).not.toContain("getRecentProofCategoryLabel");
    expect(PAGE_SRC).not.toContain("VictoryRoomProofShareSection");
    expect(PAGE_SRC).toContain("VictoryRoomTopCard");
    expect(PAGE_SRC).toContain("loadPatReadForVictoryRoom");
    expect(PAGE_SRC).toContain("loadPatPrinciplesForVictoryRoom");
    expect(PAGE_SRC).toContain("v2-victory-pat-read-persist");
    expect(PAGE_SRC).toContain("v2-victory-principles-persist");
    expect(PAGE_SRC).toContain("VictoryPatPrinciplesSection");
    expect(PAGE_SRC).toContain("VictoryPatReadSection");
    expect(PAGE_SRC).not.toContain("VictoryPatPrinciplesPlaceholder");
    expect(PAGE_SRC).not.toContain("buildDeterministicPatRead");
    expect(PAGE_SRC).toContain("loadVictorySeasonListForRoom");
    expect(PAGE_SRC).toContain("VictorySeasonsSection");
    expect(PAGE_SRC).not.toContain("VictorySeasonsPreviewSection");
    expect(PAGE_SRC).not.toContain("loadPriorChaptersView");
    expect(PAGE_SRC).not.toContain("VictoryArchiveSection");
    expect(PAGE_SRC).not.toContain("hasEarlierChapterHistory");
    expect(PAGE_SRC).not.toContain("VictoryEarlierHistoryLinkSection");
    expect(PAGE_SRC).not.toContain("loadVictoryEarlierChapterIndex");
    expect(PAGE_SRC).not.toContain("loadVictoryEarlierChapterProofView");
    expect(PAGE_SRC).not.toContain("VictoryRoomSmsNotice");
    expect(PAGE_SRC).toContain("loadVictoryEvolutionNudge");
    expect(PAGE_SRC).toContain("loadVictoryEvolutionNudge");
    expect(PAGE_SRC).toContain("evolutionNudge");
    expect(PAGE_SRC).not.toContain("EvolutionRecommendationCard");
  });

  it("deterministic Pat read module stays pure (no OpenAI import)", () => {
    expect(PAT_READ_SRC).not.toContain("openai");
    expect(PAT_READ_SRC).not.toContain("OPENAI_API_KEY");
    expect(PERSIST_SRC).not.toContain("openai");
    expect(PERSIST_SRC).not.toContain("OPENAI_API_KEY");
    expect(PERSIST_SRC).not.toContain("v2-victory-room-summary");
    expect(PRINCIPLES_PERSIST_SRC).not.toContain("openai");
    expect(PRINCIPLES_PERSIST_SRC).not.toContain("OPENAI_API_KEY");
    expect(PRINCIPLES_MAP_SRC).not.toContain("openai");
  });

  it("skips past season queries when there is no active commitment", () => {
    const loadFn = VIEW_SRC.slice(VIEW_SRC.indexOf("export async function loadVictoryRoomView"));
    const noCommitReturn = loadFn.indexOf("if (!commitment)");
    const pastSeasonLoad = loadFn.indexOf("loadPastAccountabilitySeasons");
    expect(noCommitReturn).toBeGreaterThan(-1);
    expect(pastSeasonLoad).toBeGreaterThan(-1);
    expect(pastSeasonLoad).toBeGreaterThan(noCommitReturn);
  });

  it("CompleteOnboardingButton still routes to victory room", () => {
    expect(COMPLETE_BTN).toContain('router.push("/dashboard/victory-room")');
  });

  it("gates module uses Victory Room as member home", () => {
    const GATES_SRC = readFileSync(
      join(process.cwd(), "src/lib/onboarding-sob-gates.ts"),
      "utf8"
    );
    expect(GATES_SRC).toContain('from "@/lib/member-app-home-path"');
    expect(GATES_SRC).toContain("export { MEMBER_APP_HOME_PATH }");
    expect(GATES_SRC).toContain("redirectTo: MEMBER_APP_HOME_PATH");
  });

  it("season detail uses 400 event cap and not archive 2500", () => {
    expect(SEASON_PROOF_SRC).toContain("ACTIVE_EVENT_FETCH_LIMIT");
    expect(SEASON_PROOF_SRC).not.toContain("ARCHIVE_EVENT_LIMIT");
    expect(SEASON_PROOF_SRC).not.toContain("2500");
    expect(SEASON_LIST_SRC).not.toContain("ARCHIVE_EVENT_LIMIT");
    expect(SEASON_LIST_SRC).not.toContain("loadPriorChaptersView");
  });

  it("season pages and libs do not use OpenAI", () => {
    expect(SEASON_PAGE_SRC).not.toContain("openai");
    expect(SEASON_PROOF_SRC).not.toContain("openai");
    expect(SEASON_LIST_SRC).not.toContain("openai");
    expect(SEASON_SUMMARY_PERSIST_SRC).not.toContain("openai");
  });

  it("earlier chapter history uses metadata index and 400 capped proof only on chapter page", () => {
    expect(EARLIER_INDEX_SRC).not.toContain("ARCHIVE_EVENT_LIMIT");
    expect(EARLIER_INDEX_SRC).not.toContain("2500");
    expect(EARLIER_INDEX_SRC).not.toContain("v2_commitment_event");
    expect(EARLIER_PROOF_SRC).toContain("ACTIVE_EVENT_FETCH_LIMIT");
    expect(EARLIER_PROOF_SRC).not.toContain("ARCHIVE_EVENT_LIMIT");
    expect(EARLIER_PROOF_SRC).not.toContain("2500");
    expect(EARLIER_PROOF_SRC).not.toContain("openai");
    expect(HISTORY_PAGE_SRC).not.toContain("openai");
    expect(HISTORY_PAGE_SRC).not.toContain("loadVictoryEarlierChapterProofView");
    expect(CHAPTER_PAGE_SRC).not.toContain("openai");
    expect(CHAPTER_PAGE_SRC).toContain("loadVictoryEarlierChapterProofView");
  });
});
