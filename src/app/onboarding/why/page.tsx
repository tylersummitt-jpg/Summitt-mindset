import { redirect } from "next/navigation";

export default function OnboardingWhyRedirect() {
  redirect("/onboarding/identity");
}
