import { redirect } from "next/navigation";

/**
 * Legacy URL: pressure step was replaced by /onboarding/commitment.
 */
export default function OnboardingPressureRedirect() {
  redirect("/onboarding/commitment");
}
