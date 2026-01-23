import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import TrainingFocusClient from "./training-focus-client";

export default async function TrainingFocusPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const metadata = user.publicMetadata as any;

  // Optional guard: require goal first (keeps onboarding clean)
  const hasGoal = typeof metadata?.summittGoal === "string" && metadata.summittGoal.length > 0;
  if (!hasGoal) redirect("/onboarding/goal");

  return (
    <div className="max-w-3xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-bold mb-3">Choose what you want to train.</h1>
      <p className="text-gray-600 mb-10">
        Pick <strong>five</strong>. This will shape your Training Camp (Days 2–29).
      </p>

      <TrainingFocusClient />
    </div>
  );
}
