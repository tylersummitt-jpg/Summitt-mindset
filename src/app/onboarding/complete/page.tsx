import { currentUser } from "@clerk/nextjs/server";
import CompleteOnboardingButton from "@/components/CompleteOnboardingButton";

export default async function CompletePage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p>You must be signed in to continue.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-16 px-6 text-center">
      <h1 className="text-3xl font-bold mb-4">Training Camp Complete!</h1>
      <p className="text-gray-600 mb-8">
        You’re all set. Your Summitt Mindset dashboard is now personalized for
        your journey. Great work!
      </p>

      <CompleteOnboardingButton />
    </div>
  );
}
