import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("member app home routing (Package 5)", () => {
  it("MEMBER_APP_HOME_PATH is Victory Room in client-safe module", () => {
    const home = readSrc("src/lib/member-app-home-path.ts");
    expect(home).toContain('MEMBER_APP_HOME_PATH = "/dashboard/victory-room"');
    expect(home).not.toContain("server-only");
    expect(home).not.toContain("supabase-server");
  });

  it("onboarding-sob-gates re-exports MEMBER_APP_HOME_PATH without defining it inline", () => {
    const gates = readSrc("src/lib/onboarding-sob-gates.ts");
    expect(gates).toContain('from "@/lib/member-app-home-path"');
    expect(gates).toContain("export { MEMBER_APP_HOME_PATH }");
    expect(gates).not.toMatch(/export const MEMBER_APP_HOME_PATH\s*=/);
  });

  it("guided-resolution client imports MEMBER_APP_HOME_PATH from client-safe module", () => {
    const src = readSrc("src/app/dashboard/guided-resolution/guided-resolution-client.tsx");
    expect(src).toContain('from "@/lib/member-app-home-path"');
    expect(src).not.toContain('from "@/lib/onboarding-sob-gates"');
  });

  it("post-sign-in completed users route to Victory Room", () => {
    const src = readSrc("src/app/post-sign-in/page.tsx");
    expect(src).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(src).not.toMatch(/redirect\("\/dashboard"\)/);
  });

  it("CompleteOnboardingButton routes to Victory Room", () => {
    const src = readSrc("src/components/CompleteOnboardingButton.tsx");
    expect(src).toContain('router.push("/dashboard/victory-room")');
  });

  it("Navbar includes Victory Room but not Daily OS for app users", () => {
    const src = readSrc("src/components/Navbar.tsx");
    expect(src).toContain('href: "/dashboard/victory-room"');
    expect(src).toContain('label: "Victory Room"');
    expect(src).not.toContain('label: "Daily OS"');
    expect(src).not.toMatch(/href:\s*"\/dashboard"[^/]/);
  });

  it("VictoryRoomFooterNav links to Account without Daily OS", () => {
    const src = readSrc("src/components/VictoryRoomFooterNav.tsx");
    expect(src).not.toContain("Daily OS");
    expect(src).not.toContain('href="/dashboard"');
    expect(src).toContain('href="/user"');
  });

  it("Victory Room surfaces Update my goal with dashboard-aligned guards", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    const topCard = readSrc("src/components/VictoryRoomTopCard.tsx");
    expect(page).toContain("getActiveCommitment");
    expect(page).toContain("getPendingResolutionOrNull");
    expect(page).toContain("isSmsInboundPendingResolutionActionable");
    expect(page).toContain('accountability_phase !== "low_pressure_reactivation"');
    expect(page).toContain("showUpdateGoalLink");
    expect(page).toContain("showEditIdentityLink");
    expect(topCard).toContain('href="/dashboard/update-goal"');
    expect(topCard).toContain("Update goal");
    expect(topCard).toContain("vrFoundationBtn");
    expect(topCard).toContain('href="/dashboard/edit-identity"');
    expect(topCard).toContain("Edit identity");
  });

  it("edit-identity page uses app edit API and Victory Room home path", () => {
    const page = readSrc("src/app/dashboard/edit-identity/page.tsx");
    const client = readSrc("src/app/dashboard/edit-identity/edit-identity-client.tsx");
    expect(page).toContain("loadIdentityEditDraft");
    expect(page).not.toContain("/onboarding/identity");
    expect(client).toContain("/api/v2/identity/edit");
    expect(client).toContain("MEMBER_APP_HOME_PATH");
    expect(client).toContain("Does your current goal still fit");
    expect(client).toContain("Keep current goal");
    expect(client).toContain("Update my goal");
  });

  it("update-goal and guided-resolution clients point back to Victory Room", () => {
    const updateGoal = readSrc("src/app/dashboard/update-goal/update-goal-client.tsx");
    const guided = readSrc("src/app/dashboard/guided-resolution/guided-resolution-client.tsx");
    expect(updateGoal).toContain("MEMBER_APP_HOME_PATH");
    expect(updateGoal).toContain("Back to Victory Room");
    expect(updateGoal).not.toContain("Back to Daily OS");
    expect(guided).toContain("Back to Victory Room");
    expect(guided).not.toContain("Back to Daily OS");
    expect(guided).not.toContain("Daily OS");
  });

  it("dashboard layout does not redirect victory-room away from dashboard", () => {
    const layout = readSrc("src/app/dashboard/layout.tsx");
    expect(layout).toContain("getOnboardingSobStatus");
    expect(layout).not.toContain("/dashboard/victory-room");
    expect(layout).not.toMatch(/redirect\([^)]*victory-room/);
  });

  it("victory-room page does not redirect to dashboard on load", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    expect(page).not.toMatch(/redirect\("\/dashboard"\)/);
    expect(page).not.toContain("redirect('/dashboard')");
  });

  it("home and account CTAs route to Victory Room, not plain dashboard", () => {
    const home = readSrc("src/app/page.tsx");
    const user = readSrc("src/app/user/[[...user]]/page.tsx");
    expect(home).toContain("MEMBER_APP_HOME_PATH");
    expect(home).toContain("Open Victory Room");
    expect(home).not.toContain("Open dashboard");
    expect(user).toContain("MEMBER_APP_HOME_PATH");
    expect(user).toContain("Open Victory Room");
    expect(user).not.toContain("Open dashboard");
  });

  it("Account page does not surface legacy Life Context card", () => {
    const user = readSrc("src/app/user/[[...user]]/page.tsx");
    expect(user).not.toContain('href="/life-context"');
    expect(user).not.toContain("Update Life Context");
    expect(user).not.toContain("Keep Your Coaching Accurate");
    expect(user).toContain("MEMBER_APP_HOME_PATH");
    expect(user).toContain("Open Victory Room");
  });

  it("key product surfaces avoid user-facing SMS jargon", () => {
    const surfaces = [
      readSrc("src/app/page.tsx"),
      readSrc("src/app/user/[[...user]]/page.tsx"),
      readSrc("src/app/dashboard/victory-room/page.tsx"),
      readSrc("src/components/VictoryRoomSmsNotice.tsx"),
      readSrc("src/components/VictoryRoomFooterNav.tsx"),
      readSrc("src/lib/v2-evolution-surface-copy.ts"),
    ];
    for (const src of surfaces) {
      expect(src).not.toContain("SMS accountability");
      expect(src).not.toContain("SMS check-ins");
      expect(src).not.toContain("over SMS");
      expect(src).not.toContain("runs over SMS");
      expect(src).not.toContain("SMS is not fully connected");
    }
    const layout = readSrc("src/app/layout.tsx");
    expect(layout).toContain("SMS Disclosure");
    expect(layout).toContain("SMS Opt-In (Twilio)");
    expect(layout).not.toContain("SMS-first accountability");
  });

  it("Victory Room nudge copy avoids Daily OS branding", () => {
    const nudgeCopy = readSrc("src/lib/v2-evolution-surface-copy.ts");
    const nudgeSection = readSrc("src/components/VictoryEvolutionNudgeSection.tsx");
    expect(nudgeCopy).not.toContain("Open Daily OS");
    expect(nudgeSection).not.toContain("Daily OS");
    expect(nudgeSection).toContain("Review recommendation");
  });

  it("victory-room empty state links to commitment setup, not plain dashboard", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    expect(page).toContain('href="/dashboard/commitment-setup"');
    expect(page).toContain("Set up your commitment");
    expect(page).not.toContain("Return to the dashboard");
    expect(page).not.toMatch(/href="\/dashboard"\s+class/);
  });

  it("Victory Room does not surface text-check-ins connection notice", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    const topCard = readSrc("src/components/VictoryRoomTopCard.tsx");
    expect(page).not.toContain("VictoryRoomSmsNotice");
    expect(page).not.toContain("Text check-ins are not fully connected yet");
    expect(page).not.toContain("Coach Pat works best when texts are on");
    expect(page).not.toMatch(/Open Account/);
    expect(page).not.toContain("smsEnabled");
    expect(page).toContain("VictoryRoomTopCard");
    expect(topCard).toContain("Your Foundation");
    expect(topCard).toContain("My identity");
    expect(topCard).toContain("My current goal");
  });

  it("Victory Room does not surface Coach Leadership Kit shipping card", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    expect(page).not.toContain("CoachVictoryHandoffBanner");
    expect(page).not.toContain("Coach Leadership Kit");
    expect(page).not.toContain("Add Kit shipping address");
    expect(page).not.toContain('href="/coach/setup"');
    expect(page).not.toContain("acquisitionSource");
  });

  it("Victory Room does not surface day-zero notice card and uses shortened subtitle", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    const topCard = readSrc("src/components/VictoryRoomTopCard.tsx");
    expect(page).not.toContain("VictoryDayZeroNotice");
    expect(page).not.toContain("You have your identity, goal, and season in place");
    expect(page).not.toContain("Proof will start showing up here as you answer");
    expect(page).not.toContain("not a scoreboard");
    expect(page).toContain("saved from your");
    expect(page).toContain("real choices.");
    expect(page).toContain("VictoryRoomTopCard");
    expect(topCard).toContain("Your Foundation");
    expect(topCard).toContain("My identity");
    expect(topCard).toContain("My current goal");
  });

  it("Account still surfaces text check-ins settings block", () => {
    const user = readSrc("src/app/user/[[...user]]/page.tsx");
    const smsBlock = readSrc("src/components/text-check-ins-section.tsx");
    expect(user).toContain("AccountSmsBlock");
    expect(user).toContain("text-check-ins-section");
    expect(smsBlock).toContain("Text check-ins");
  });

  it("coach setup redirects address-collected coaches to Victory Room", () => {
    const coachSetup = readSrc("src/app/coach/setup/layout.tsx");
    const dayPage = readSrc("src/app/dashboard/day/[day]/page.tsx");
    const dayLayout = readSrc("src/app/dashboard/day/[day]/layout.tsx");
    expect(coachSetup).toContain("MEMBER_APP_HOME_PATH");
    expect(coachSetup).toContain("coachAddressCollected === true");
    expect(coachSetup).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(coachSetup).toContain("return <>{children}</>");
    expect(coachSetup).not.toMatch(/redirect\("\/dashboard"\)/);
    expect(dayPage).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(dayPage).not.toMatch(/redirect\("\/dashboard"\)/);
    expect(dayLayout).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(dayLayout).not.toMatch(/redirect\("\/dashboard"\)/);
  });

  it("commitment-setup page does not use Dashboard eyebrow label", () => {
    const page = readSrc("src/app/dashboard/commitment-setup/page.tsx");
    expect(page).toContain("Commitment");
    expect(page).not.toMatch(/>\s*Dashboard\s*</);
  });

  it("member fallbacks use MEMBER_APP_HOME_PATH instead of plain dashboard", () => {
    const updateGoal = readSrc("src/app/dashboard/update-goal/page.tsx");
    const commitmentSetup = readSrc("src/app/dashboard/commitment-setup/page.tsx");
    const commitmentClient = readSrc("src/app/dashboard/commitment-setup/commitment-setup-client.tsx");
    const cancelPage = readSrc("src/app/cancel/page.tsx");
    const cancelClient = readSrc("src/app/cancel/cancel-flow-client.tsx");
    expect(updateGoal).toContain("MEMBER_APP_HOME_PATH");
    expect(updateGoal).not.toMatch(/redirect\("\/dashboard"\)/);
    expect(commitmentSetup).toContain("MEMBER_APP_HOME_PATH");
    expect(commitmentClient).toContain("MEMBER_APP_HOME_PATH");
    expect(cancelPage).toContain("MEMBER_APP_HOME_PATH");
    expect(cancelClient).toContain("MEMBER_APP_HOME_PATH");
    expect(cancelClient).not.toContain("?paused=true");
    expect(cancelClient).not.toContain("?canceled=true");
  });

  it("evolution review href remains hidden utility route for now", () => {
    const nudge = readSrc("src/lib/v2-victory-evolution-nudge.ts");
    expect(nudge).toContain("EVOLUTION_REVIEW_HREF");
    expect(nudge).toContain('EVOLUTION_REVIEW_HREF = "/dashboard"');
  });

  it("dashboard frames Daily OS and demotes Victory Room primary CTA", () => {
    const dash = readSrc("src/app/dashboard/page.tsx");
    expect(dash).toContain("Daily OS");
    expect(dash).not.toContain("Open Victory Room");
    expect(dash).not.toContain("member-primary-cta mt-4");
    expect(dash).toContain('href="/dashboard/victory-room"');
    expect(dash).toContain("EvolutionRecommendationCard");
  });

  it("victory-room surfaces evolution nudge without full evolution card", () => {
    const page = readSrc("src/app/dashboard/victory-room/page.tsx");
    expect(page).toContain("loadVictoryEvolutionNudge");
    expect(page).toContain("evolutionNudge");
    expect(page).not.toContain("EvolutionRecommendationCard");
  });
});
