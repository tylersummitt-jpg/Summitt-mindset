import type { ReactElement } from "react";

import { AuthMarketingShell } from "@/components/auth-marketing-shell";
import { CoachCompletionPanel } from "@/components/coach-completion-panel";

/**
 * Coach funnel completion — shown after onboarding when acquisitionSource is coach.
 * Normal flow shows this content on /onboarding/complete; this route remains a fallback/bookmark.
 */

export default function CoachCompletePage(): ReactElement {
  return (
    <AuthMarketingShell authPage="coach-complete" contentClassName="w-full max-w-lg">
      <CoachCompletionPanel />
    </AuthMarketingShell>
  );
}
