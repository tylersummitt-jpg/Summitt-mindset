import type { SmsReviewPersona } from "@/sms-review-place/types";

export const PERSONAS: Record<string, SmsReviewPersona> = {
  alex: {
    id: "alex",
    preferredName: "Alex",
    clerkUserId: "sim_alex",
    identityLabel: "Competitive athlete building morning discipline",
  },
  jordan: {
    id: "jordan",
    preferredName: "Jordan",
    clerkUserId: "sim_jordan",
    identityLabel: "Professional reclaiming evenings without shame",
  },
  sam: {
    id: "sam",
    preferredName: "Sam",
    clerkUserId: "sim_sam",
    identityLabel: "Student protecting focused study blocks",
  },
  riley: {
    id: "riley",
    preferredName: "Riley",
    clerkUserId: "sim_riley",
    identityLabel: "Parent fitting workouts around family",
  },
  casey: {
    id: "casey",
    preferredName: "Casey",
    clerkUserId: "sim_casey",
    identityLabel: "Founder staying accountable on sales outreach",
  },
  tyler: {
    id: "tyler",
    preferredName: "Tyler",
    clerkUserId: "sim_tyler",
    identityLabel: "Operator tracking honest daily execution",
  },
  morgan: {
    id: "morgan",
    preferredName: "Morgan",
    clerkUserId: "sim_morgan",
    identityLabel: "Member building a hydration habit",
  },
  pat: {
    id: "pat",
    preferredName: "Pat",
    clerkUserId: "sim_pat",
    identityLabel: "Leader running team accountability",
  },
  jamie: {
    id: "jamie",
    preferredName: "Jamie",
    clerkUserId: "sim_jamie",
    identityLabel: "Member who recently changed their goal",
  },
  brooke: {
    id: "brooke",
    preferredName: "Brooke",
    clerkUserId: "sim_brooke",
    identityLabel: "Member closing plan loops after workouts",
  },
};

export function getPersona(personaId: string): SmsReviewPersona {
  const p = PERSONAS[personaId];
  if (!p) throw new Error(`Unknown SMS Review Place persona: ${personaId}`);
  return p;
}
