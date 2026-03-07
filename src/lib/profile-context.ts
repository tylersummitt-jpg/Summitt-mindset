import { supabaseServer } from "@/lib/supabase-server";

/**
 * ======================================================
 * Profile Context Builder
 * ======================================================
 *
 * Converts onboarding answers into structured AI context.
 *
 * Used by:
 * - Coach Pat Daily Notes
 * - Coach Reply
 * - Ask Pat
 *
 * Goal:
 * AI must see BOTH the question + the answer.
 * Otherwise answers like "When I meditate" become meaningless.
 */

export type ProfileContext = {
  identity?: string;
  relationships?: string;
  work?: string;
  health?: string;
  pressure?: string;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.replace(/\s+/g, " ");
}

/**
 * Builds readable AI context sentences
 */
export async function buildProfileContext(
  clerkUserId: string
): Promise<ProfileContext> {
  const { data, error } = await supabaseServer
    .from("user_profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error || !data) {
    return {};
  }

  const lifeDesires = clean(data.life_desires);
  const ninetyDayVision = clean(data.ninety_day_vision);
  const supportArea = clean(data.support_area);

  const peopleSummary = clean(data.people_summary);
  const relationshipStatus = clean(data.relationship_status);
  const partnerName = clean(data.partner_name);
  const childrenSummary = clean(data.children_summary);

  const responsibility = clean(data.responsibility);
  const financialGoals = clean(data.financial_goals);
  const workChallenge = clean(data.work_challenge);

  const physicalState = clean(data.physical_state);
  const healthGoal = clean(data.health_goal);
  const energyObstacles = clean(data.energy_obstacles);

  const pressureSummary = clean(data.pressure_summary);
  const proudOf = clean(data.proud_of);
  const bestSelfTrigger = clean(data.best_self_trigger);

  const context: ProfileContext = {};

  /**
   * ============================
   * Identity
   * ============================
   */

  const identityParts: string[] = [];

  if (lifeDesires) {
    identityParts.push(`Right now they say they want: ${lifeDesires}.`);
  }

  if (ninetyDayVision) {
    identityParts.push(
      `In the next 90 days they hope this becomes true: ${ninetyDayVision}.`
    );
  }

  if (supportArea) {
    identityParts.push(
      `They specifically want guidance from Coach Pat in this area: ${supportArea}.`
    );
  }

  if (identityParts.length > 0) {
    context.identity = identityParts.join(" ");
  }

  /**
   * ============================
   * Relationships
   * ============================
   */

  const relationshipParts: string[] = [];

  if (peopleSummary) {
    relationshipParts.push(
      `The people they say they show up for most are: ${peopleSummary}.`
    );
  }

  if (relationshipStatus) {
    relationshipParts.push(`Their relationship status is: ${relationshipStatus}.`);
  }

  if (partnerName) {
    relationshipParts.push(`Their partner's name is ${partnerName}.`);
  }

  if (childrenSummary) {
    relationshipParts.push(`They described their children like this: ${childrenSummary}.`);
  }

  if (relationshipParts.length > 0) {
    context.relationships = relationshipParts.join(" ");
  }

  /**
   * ============================
   * Work & Responsibility
   * ============================
   */

  const workParts: string[] = [];

  if (responsibility) {
    workParts.push(
      `They say this responsibility is currently on their shoulders: ${responsibility}.`
    );
  }

  if (financialGoals) {
    workParts.push(`Their financial goals right now include: ${financialGoals}.`);
  }

  if (workChallenge) {
    workParts.push(
      `The hardest part of work for them right now is: ${workChallenge}.`
    );
  }

  if (workParts.length > 0) {
    context.work = workParts.join(" ");
  }

  /**
   * ============================
   * Health & Energy
   * ============================
   */

  const healthParts: string[] = [];

  if (physicalState) {
    healthParts.push(
      `They described how they feel physically like this: ${physicalState}.`
    );
  }

  if (healthGoal) {
    healthParts.push(`They want to improve their health in this way: ${healthGoal}.`);
  }

  if (energyObstacles) {
    healthParts.push(
      `Things that tend to throw them off physically or mentally include: ${energyObstacles}.`
    );
  }

  if (healthParts.length > 0) {
    context.health = healthParts.join(" ");
  }

  /**
   * ============================
   * Pressure / Character
   * ============================
   */

  const pressureParts: string[] = [];

  if (pressureSummary) {
    pressureParts.push(
      `They say they are currently carrying this pressure: ${pressureSummary}.`
    );
  }

  if (proudOf) {
    pressureParts.push(`They are most proud of this: ${proudOf}.`);
  }

  if (bestSelfTrigger) {
    pressureParts.push(
      `They say the best version of themselves shows up when: ${bestSelfTrigger}.`
    );
  }

  if (pressureParts.length > 0) {
    context.pressure = pressureParts.join(" ");
  }

  return context;
}