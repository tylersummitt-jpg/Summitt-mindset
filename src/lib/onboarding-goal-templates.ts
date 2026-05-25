/**
 * Goal focus areas + daily templates for SoB onboarding.
 */

import { ARENAS, type Arena } from "@/lib/onboarding-config";
import { sanitizeGoalOptions, isValidRecommendedGoalOption } from "@/lib/onboarding-goal-quality";
import {
  applyGoalPersonalization,
  personalizeGoalTemplateBehavior,
  resolveGoalRelationshipTerms,
  type GoalPersonalizationInput,
} from "@/lib/onboarding-goal-personalization";

export type { GoalPersonalizationInput } from "@/lib/onboarding-goal-personalization";

/** Legacy coarse areas (resume / arena mapping). */
export const LEGACY_GOAL_AREA_IDS = [
  "family_parenting",
  "marriage_relationships",
  "faith_spiritual",
  "health_energy",
  "career_leadership",
  "calm_emotional",
  "confidence_identity",
  "discipline_consistency",
] as const;

/** Human-facing focus chips shown on Current Goal page. */
export const GOAL_FOCUS_AREA_IDS = [
  "parenting",
  "family",
  "presence",
  "phone_distraction",
  "emotional_control",
  "health",
  "work_boundaries",
  "relationship",
  "communication",
  "home_household",
  "business",
  "deep_work",
  "work_focus",
  "planning",
  "sales_outreach",
  "decision_making",
  "money_finances",
  "leadership",
  "coaching",
  "hard_conversations",
  "team_culture",
  "follow_through",
  "faith",
  "morning_routine",
  "evening_routine",
  "gratitude",
  "service",
  "discipline",
  "family_presence",
  "something_else",
] as const;

export const GOAL_AREA_IDS = [...LEGACY_GOAL_AREA_IDS, ...GOAL_FOCUS_AREA_IDS] as const;

export type GoalAreaId = (typeof GOAL_AREA_IDS)[number];
export type GoalFocusAreaId = (typeof GOAL_FOCUS_AREA_IDS)[number];

export const SOMETHING_ELSE_AREA_ID: GoalFocusAreaId = "something_else";

const ARENA_TO_AREA: Record<Arena, GoalAreaId> = {
  "Family & Parenting": "family_parenting",
  "Marriage & Relationships": "marriage_relationships",
  "Faith & Spiritual Strength": "faith_spiritual",
  "Health & Energy": "health_energy",
  "Career & Leadership": "career_leadership",
  "Calm & Emotional Control": "calm_emotional",
  "Confidence & Identity": "confidence_identity",
  "Discipline & Consistency": "discipline_consistency",
};

const LEGACY_GOAL_AREA_LABELS: Record<(typeof LEGACY_GOAL_AREA_IDS)[number], string> = {
  family_parenting: "Family & Parenting",
  marriage_relationships: "Marriage & Relationships",
  faith_spiritual: "Faith & Spiritual Strength",
  health_energy: "Health & Energy",
  career_leadership: "Career & Leadership",
  calm_emotional: "Calm & Emotional Control",
  confidence_identity: "Confidence & Identity",
  discipline_consistency: "Discipline & Consistency",
};

export const GOAL_FOCUS_AREA_LABELS: Record<GoalFocusAreaId, string> = {
  parenting: "Parenting",
  family: "Family",
  presence: "Presence",
  phone_distraction: "Phone / Distraction",
  emotional_control: "Emotional Control",
  health: "Health",
  work_boundaries: "Work / Boundaries",
  relationship: "Relationship",
  communication: "Communication",
  home_household: "Home / Household",
  business: "Business",
  deep_work: "Deep Work",
  work_focus: "Work Focus",
  planning: "Planning",
  sales_outreach: "Sales / Outreach",
  decision_making: "Decision-Making",
  money_finances: "Money / Finances",
  leadership: "Leadership",
  coaching: "Coaching",
  hard_conversations: "Hard Conversations",
  team_culture: "Team Culture",
  follow_through: "Follow-Through",
  faith: "Faith",
  morning_routine: "Morning Routine",
  evening_routine: "Evening Routine",
  gratitude: "Gratitude",
  service: "Service",
  discipline: "Discipline",
  family_presence: "Family / Presence",
  something_else: "Something else",
};

export function getGoalAreaLabel(id: GoalAreaId): string {
  if (id in GOAL_FOCUS_AREA_LABELS) {
    return GOAL_FOCUS_AREA_LABELS[id as GoalFocusAreaId];
  }
  return LEGACY_GOAL_AREA_LABELS[id as (typeof LEGACY_GOAL_AREA_IDS)[number]];
}

export const GOAL_AREAS: { id: GoalAreaId; label: string }[] = GOAL_AREA_IDS.map((id) => ({
  id,
  label: getGoalAreaLabel(id),
}));

export const GOAL_FOCUS_AREAS: { id: GoalFocusAreaId; label: string }[] =
  GOAL_FOCUS_AREA_IDS.map((id) => ({ id, label: GOAL_FOCUS_AREA_LABELS[id] }));

export function isGoalAreaId(value: unknown): value is GoalAreaId {
  return typeof value === "string" && (GOAL_AREA_IDS as readonly string[]).includes(value);
}

export function isGoalFocusAreaId(value: unknown): value is GoalFocusAreaId {
  return typeof value === "string" && (GOAL_FOCUS_AREA_IDS as readonly string[]).includes(value);
}

export type GoalTemplate = {
  id: string;
  areaId: GoalAreaId;
  title: string;
  behaviorStatement: string;
};

function t(
  id: string,
  areaId: GoalAreaId,
  title: string,
  behaviorStatement: string
): GoalTemplate {
  return { id, areaId, title, behaviorStatement };
}

const FOCUS_TEMPLATES: Record<GoalFocusAreaId, GoalTemplate[]> = {
  parenting: [
    t("parenting_present_after_work", "parenting", "Be present after work", "I will put my phone away for the first 30 minutes after I get home."),
    t("parenting_bedtime_moment", "parenting", "One meaningful moment", "I will spend 10 uninterrupted minutes with {childObject} before bedtime."),
    t("parenting_follow_through_promise", "parenting", "Follow through on one promise", "I will complete one specific promise I already made to {childObject} today."),
    t("parenting_morning_connection", "parenting", "Start the day connected", "I will give {eachChild} a calm good-morning greeting before screens or rushing."),
    t("parenting_evening_checkin", "parenting", "Evening check-in", "I will ask {childObject} one specific question about their day and listen without interrupting."),
  ],
  family: [
    t("family_dinner_together", "family", "Protect family dinner", "I will eat one meal today sitting down with my family without my phone."),
    t("family_weekly_plan", "family", "Plan one family moment", "I will schedule one specific family activity on the calendar today."),
    t("family_help_at_home", "family", "Help at home", "I will complete one household task that makes home easier for my family today."),
    t("family_encouragement", "family", "Encourage someone at home", "I will say one specific encouraging sentence to {familyMemberAtHome} today."),
    t("family_evening_reset", "family", "Evening reset", "I will spend 15 minutes tidying one shared space before the end of the day."),
  ],
  presence: [
    t("presence_phone_free_block", "presence", "Phone-free block", "I will keep my phone in another room for the first 30 minutes after I get home."),
    t("presence_eye_contact", "presence", "Be fully there", "I will make eye contact and listen without multitasking in one important conversation today."),
    t("presence_single_task", "presence", "One thing at a time", "I will finish one conversation before checking messages or switching tasks."),
    t("presence_walk_without_phone", "presence", "Walk without scrolling", "I will take one 10-minute walk today without looking at my phone."),
    t("presence_bedtime_presence", "presence", "Present at bedtime", "I will be off screens for the last 30 minutes before bed."),
  ],
  phone_distraction: [
    t("phone_first_hour", "phone_distraction", "Protect the first hour", "I will avoid social media until one hour after I wake up."),
    t("phone_meal_free", "phone_distraction", "Phone-free meals", "I will keep my phone away during every meal today."),
    t("phone_car_pocket", "phone_distraction", "Phone stays put", "I will keep my phone out of reach while driving and during my first work block."),
    t("phone_notification_batch", "phone_distraction", "Batch notifications", "I will check messages at three set times today instead of all day."),
    t("phone_evening_cutoff", "phone_distraction", "Evening cutoff", "I will stop checking work messages after 7 PM today."),
  ],
  emotional_control: [
    t("emotional_pause", "emotional_control", "Pause before reacting", "I will take one breath and pause before I respond when I feel triggered."),
    t("emotional_name_it", "emotional_control", "Name the feeling", "I will name what I am feeling out loud once before I react in a tense moment."),
    t("emotional_reset_walk", "emotional_control", "Short reset", "I will take a two-minute walk before continuing after I feel stress rising."),
    t("emotional_lower_voice", "emotional_control", "Lower my voice", "I will speak more slowly and quietly in the first tense conversation I have today."),
    t("emotional_apology_fast", "emotional_control", "Repair quickly", "I will apologize the same day if I speak sharply to someone I care about."),
  ],
  health: [
    t("health_movement", "health", "Daily movement", "I will move intentionally for at least 20 minutes today."),
    t("health_water", "health", "Hydrate on purpose", "I will drink one full glass of water before each meal today."),
    t("health_sleep_cutoff", "health", "Protect sleep", "I will start my bedtime routine by 10 PM tonight."),
    t("health_protein_breakfast", "health", "Fuel the morning", "I will eat a protein-rich breakfast before I start work today."),
    t("health_stretch_break", "health", "Midday reset", "I will stand and stretch for five minutes at lunch today."),
  ],
  work_boundaries: [
    t("boundaries_stop_time", "work_boundaries", "Stop on time", "I will shut down work at my planned end time today."),
    t("boundaries_no_email_bed", "work_boundaries", "No late email", "I will not send work emails after 7 PM today."),
    t("boundaries_lunch_away", "work_boundaries", "Real lunch break", "I will take a 20-minute lunch away from my desk today."),
    t("boundaries_one_no", "work_boundaries", "Protect the calendar", "I will decline or defer one non-essential meeting request today."),
    t("boundaries_commute_reset", "work_boundaries", "Commute reset", "I will take five minutes of silence before I walk in the door at home."),
  ],
  relationship: [
    t("relationship_appreciation", "relationship", "Show appreciation", "I will tell {partnerObject} one specific thing I appreciate about {partnerPronounObject} today."),
    t("relationship_checkin", "relationship", "Daily check-in", "I will ask {partnerObject} one open question and listen for five minutes."),
    t("relationship_small_kindness", "relationship", "One small kindness", "I will do one small helpful act for {partnerObject} today without being asked."),
    t("relationship_date_plan", "relationship", "Plan connection", "I will suggest one specific time to connect with {partnerObject} this week before the day ends."),
    t("relationship_no_phone_talk", "relationship", "Talk without screens", "I will have one 10-minute conversation with {partnerObject} today with my phone in another room."),
  ],
  communication: [
    t("communication_clear_ask", "communication", "Ask clearly", "I will make one direct request instead of hinting today."),
    t("communication_listen_back", "communication", "Listen first", "I will repeat back what I heard before I respond in one important conversation."),
    t("communication_praise_specific", "communication", "Specific praise", "I will give one piece of specific positive feedback face-to-face today."),
    t("communication_hard_truth_kind", "communication", "Kind honesty", "I will say one true thing I have been avoiding, kindly and directly, today."),
    t("communication_follow_up_message", "communication", "Close the loop", "I will send one follow-up message to confirm what we agreed to today."),
  ],
  home_household: [
    t("home_one_chore", "home_household", "One home win", "I will complete one household task I have been putting off today."),
    t("home_tidy_zone", "home_household", "Tidy one zone", "I will reset one room for 10 minutes before dinner."),
    t("home_plan_meal", "home_household", "Plan dinner", "I will decide what we are eating for dinner before 3 PM today."),
    t("home_team_huddle", "home_household", "Quick home huddle", "I will ask what everyone needs from me at home before I start work tomorrow morning."),
    t("home_put_away", "home_household", "Put things back", "I will put away everything I use in the kitchen before bed tonight."),
  ],
  business: [
    t("business_top_priority", "business", "Lead with discipline", "I will complete my top business priority before checking messages today."),
    t("business_revenue_action", "business", "Move revenue forward", "I will take one concrete action that moves revenue or delivery forward today."),
    t("business_morning_review", "business", "Morning business review", "I will review my top three business priorities for five minutes before I start work."),
    t("business_one_hard_task", "business", "Do the hard thing", "I will finish one business task I have been avoiding before noon today."),
    t("business_end_day_plan", "business", "Plan tomorrow", "I will write tomorrow's top business priority before I stop work today."),
  ],
  deep_work: [
    t("deep_work_first_block", "deep_work", "Protect the first hour", "I will spend the first hour of my workday on my highest-priority task."),
    t("deep_work_no_meetings", "deep_work", "Deep block", "I will work for 45 uninterrupted minutes on one important project today."),
    t("deep_work_close_tabs", "deep_work", "Close the noise", "I will close email and chat during my first deep work block today."),
    t("deep_work_single_project", "deep_work", "One project only", "I will advance one project by one visible step before I switch tasks today."),
    t("deep_work_shutdown_ritual", "deep_work", "Shutdown ritual", "I will write where I left off before I end my last work block today."),
  ],
  work_focus: [
    t("work_focus_top_three", "work_focus", "Top three list", "I will write my top three work priorities before I open my inbox today."),
    t("work_focus_timer", "work_focus", "Focused sprint", "I will use a 25-minute timer on one task before I check messages."),
    t("work_focus_one_tab", "work_focus", "One tab rule", "I will keep only one work tab open during my first focused block today."),
    t("work_focus_hard_first", "work_focus", "Hard thing first", "I will start my workday with the task I am most likely to avoid."),
    t("work_focus_end_review", "work_focus", "End-of-day review", "I will review what I finished and pick tomorrow's first task before I log off."),
  ],
  planning: [
    t("planning_daily_plan", "planning", "Plan the day", "I will write a simple plan for today before I start my first task."),
    t("planning_weekly_preview", "planning", "Preview the week", "I will spend 10 minutes reviewing this week's commitments before Monday ends."),
    t("planning_calendar_block", "planning", "Block the calendar", "I will put one important task on my calendar with a start time today."),
    t("planning_next_action", "planning", "Define next action", "I will write the very next physical action for my most important project today."),
    t("planning_evening_prep", "planning", "Prep tomorrow", "I will prepare what I need for tomorrow's first task before bed tonight."),
  ],
  sales_outreach: [
    t("sales_five_outreach", "sales_outreach", "Five touches", "I will make five sales outreach attempts before I do lower-priority work today."),
    t("sales_follow_up", "sales_outreach", "Follow up today", "I will follow up with every prospect I promised to contact today."),
    t("sales_pipeline_review", "sales_outreach", "Pipeline review", "I will review my pipeline and pick the top three deals to move today."),
    t("sales_one_ask", "sales_outreach", "Make the ask", "I will make one clear sales ask in a live conversation or call today."),
    t("sales_crm_update", "sales_outreach", "Update CRM", "I will log every sales conversation in my CRM before I stop work today."),
  ],
  decision_making: [
    t("decision_one_pending", "decision_making", "Decide one thing", "I will make one decision I have been postponing before noon today."),
    t("decision_write_options", "decision_making", "Write options down", "I will write three options for one pending decision before I ask for input."),
    t("decision_deadline", "decision_making", "Set a deadline", "I will set a decision deadline for one open issue and share it today."),
    t("decision_small_test", "decision_making", "Test small", "I will run one small test instead of debating a decision all day."),
    t("decision_communicate", "decision_making", "Communicate the call", "I will tell the people affected by one decision what we are doing today."),
  ],
  money_finances: [
    t("money_review_accounts", "money_finances", "Review cash", "I will review my business cash position for five minutes today."),
    t("money_one_expense", "money_finances", "Cut one leak", "I will cancel or pause one unnecessary expense today."),
    t("money_invoice", "money_finances", "Send invoices", "I will send every invoice that is ready to go before I stop work today."),
    t("money_budget_check", "money_finances", "Check the budget", "I will compare today's spending against my budget before I make a purchase over $50."),
    t("money_savings_move", "money_finances", "Move savings", "I will transfer one planned amount to savings or reserves today."),
  ],
  leadership: [
    t("leadership_clear_expectation", "leadership", "Set one expectation", "I will tell {leadMemberObject} exactly what good looks like on a task today."),
    t("leadership_feedback", "leadership", "Give feedback", "I will give {leadMemberObject} one piece of specific feedback face-to-face today."),
    t("leadership_lead_meeting", "leadership", "Run the meeting", "I will start one meeting on time with a clear agenda and desired outcome."),
    t("leadership_remove_blocker", "leadership", "Remove a blocker", "I will remove one blocker for {leadMemberObject} today."),
    t("leadership_model_calm", "leadership", "Model calm", "I will stay composed in the first stressful leadership moment I face today."),
  ],
  coaching: [
    t("coaching_one_question", "coaching", "Coach with questions", "I will ask three questions before I give advice in one coaching conversation today."),
    t("coaching_praise_effort", "coaching", "Praise effort", "I will give {leadMemberObject} specific praise for their effort today."),
    t("coaching_skill_rep", "coaching", "One skill rep", "I will run one deliberate practice rep with {leadMemberObject} today."),
    t("coaching_feedback_fast", "coaching", "Quick correction", "I will give one immediate correction and one encouragement in practice today."),
    t("coaching_check_understanding", "coaching", "Check understanding", "I will ask {leadMemberObject} to teach back what we covered today."),
  ],
  hard_conversations: [
    t("hard_prep_ten_minutes", "hard_conversations", "Prepare for the hard conversation", "I will spend 10 minutes writing what I need to say before I avoid it."),
    t("hard_send_message", "hard_conversations", "Set up the conversation", "I will send the message to schedule the hard conversation today."),
    t("hard_one_truth", "hard_conversations", "Say one hard truth", "I will say one necessary hard truth kindly and directly today."),
    t("hard_listen_first", "hard_conversations", "Listen in the hard talk", "I will listen without defending for the first five minutes of a hard conversation today."),
    t("hard_follow_up_written", "hard_conversations", "Confirm in writing", "I will send a brief follow-up confirming what we agreed to after a hard conversation today."),
  ],
  team_culture: [
    t("culture_thank_team", "team_culture", "Thank the team", "I will thank {leadMemberObject} publicly for a specific contribution today."),
    t("culture_standard", "team_culture", "Reinforce the standard", "I will address one small standards slip the same day it happens."),
    t("culture_start_on_time", "team_culture", "Start on time", "I will start every meeting I lead on time today."),
    t("culture_recognize_win", "team_culture", "Recognize a win", "I will share one team win with the group before the day ends."),
    t("culture_one_on_one", "team_culture", "Check in with one person", "I will ask {leadMemberObject} what support they need today."),
  ],
  follow_through: [
    t("follow_one_promise", "follow_through", "Keep one promise", "I will complete one promise I already made before I take on anything new today."),
    t("follow_close_loop", "follow_through", "Close the loop", "I will reply to every commitment message I owe an answer to today."),
    t("follow_finish_started", "follow_through", "Finish what I started", "I will finish one task I started instead of opening a new one today."),
    t("follow_deadline_hit", "follow_through", "Hit a deadline", "I will deliver one promised item by the time I said I would today."),
    t("follow_evening_review", "follow_through", "Review open loops", "I will list every open promise and pick the top one to finish tonight."),
  ],
  faith: [
    t("faith_morning_prayer", "faith", "Morning prayer", "I will spend five quiet minutes in prayer or reflection before I start my day."),
    t("faith_scripture", "faith", "Read and reflect", "I will read one short passage and write one sentence about how it applies today."),
    t("faith_gratitude_prayer", "faith", "Gratitude prayer", "I will name three specific things I am grateful for in prayer today."),
    t("faith_serve_someone", "faith", "Serve someone", "I will do one act of service for someone else today."),
    t("faith_evening_examine", "faith", "Evening examen", "I will spend five minutes reviewing my day with honesty before bed tonight."),
  ],
  morning_routine: [
    t("morning_wake_time", "morning_routine", "Wake on time", "I will get out of bed at my planned wake time without snoozing today."),
    t("morning_no_phone", "morning_routine", "Phone-free morning", "I will avoid my phone for the first 20 minutes after I wake up."),
    t("morning_hydrate_move", "morning_routine", "Move and hydrate", "I will drink water and move for five minutes before I start work today."),
    t("morning_plan_three", "morning_routine", "Plan three wins", "I will write three priorities for today before I check messages."),
    t("morning_make_bed", "morning_routine", "Start with order", "I will make my bed and tidy my bedroom before I leave home today."),
  ],
  evening_routine: [
    t("evening_shutdown", "evening_routine", "Work shutdown", "I will write tomorrow's first task and close my work apps by 8 PM tonight."),
    t("evening_family_time", "evening_routine", "Protect evening family time", "I will be off work messages by 7 PM and present at home tonight."),
    t("evening_prep", "evening_routine", "Prep for morning", "I will lay out what I need for tomorrow before I go to bed tonight."),
    t("evening_tidy", "evening_routine", "Ten-minute tidy", "I will reset one shared space for 10 minutes before bed tonight."),
    t("evening_journal", "evening_routine", "Evening journal", "I will write three sentences about what mattered today before bed tonight."),
  ],
  gratitude: [
    t("gratitude_text_one", "gratitude", "Send thanks", "I will send one thank-you message to someone who helped me recently today."),
    t("gratitude_say_three", "gratitude", "Say three gratitudes", "I will tell someone at home three specific things I am grateful for today."),
    t("gratitude_note", "gratitude", "Write it down", "I will write down three specific things I am grateful for today."),
    t("gratitude_public_praise", "gratitude", "Public praise", "I will praise one person by name for something specific in front of others today."),
    t("gratitude_pause", "gratitude", "Gratitude pause", "I will pause for one minute to notice something good before dinner today."),
  ],
  service: [
    t("service_help_one", "service", "Help without being asked", "I will help one person with a task they did not ask me to do today."),
    t("service_check_neighbor", "service", "Check on someone", "I will check on one person who may need support with a short message today."),
    t("service_volunteer_block", "service", "Serve in action", "I will spend 15 minutes serving my family, team, or community today."),
    t("service_encourage", "service", "Encourage someone", "I will send one encouraging message to {grandchildObject} today."),
    t("service_follow_through_help", "service", "Follow through on help", "I will finish one act of service I offered instead of forgetting it today."),
  ],
  discipline: [
    t("discipline_one_commitment", "discipline", "Follow through today", "I will do the one commitment I already told myself I would do today."),
    t("discipline_start_on_time", "discipline", "Start on time", "I will begin my first important task at the time I planned today."),
    t("discipline_no_snooze", "discipline", "No snooze", "I will get up on my first alarm and start my morning routine today."),
    t("discipline_finish_hard", "discipline", "Finish the hard thing", "I will complete one difficult task before I reward myself today."),
    t("discipline_track_it", "discipline", "Track the habit", "I will mark whether I kept my commitment before I go to bed tonight."),
  ],
  family_presence: [
    t("family_presence_after_work", "family_presence", "Be present after work", "I will put my phone away for the first 30 minutes after I get home."),
    t("family_presence_dinner", "family_presence", "Present at dinner", "I will eat dinner with my family with my phone in another room today."),
    t("family_presence_kid_time", "family_presence", "Ten focused minutes", "I will give {childObject} ten uninterrupted minutes today."),
    t("family_presence_weekend_plan", "family_presence", "Plan presence", "I will put one family connection on the calendar before the day ends."),
    t("family_presence_goodnight", "family_presence", "Goodnight connection", "I will say goodnight to each person at home before I go to bed tonight."),
  ],
  something_else: [
    t("else_phone_after_work", "something_else", "Be present after work", "I will put my phone away for the first 30 minutes after I get home."),
    t("else_health_walk", "something_else", "Move today", "I will walk for at least 15 minutes today."),
    t("else_work_priority", "something_else", "Protect the first hour", "I will spend the first hour of my workday on my highest-priority task."),
    t("else_family_moment", "something_else", "One family moment", "I will create one intentional moment of connection at home today."),
    t("else_discipline_one", "something_else", "One clear follow-through", "I will complete one specific commitment I already made today."),
  ],
};

const LEGACY_TEMPLATES: GoalTemplate[] = [
  t("legacy_family_present", "family_parenting", "Be present after work", "I will put my phone away for the first 30 minutes after I get home."),
  t("legacy_marriage_thanks", "marriage_relationships", "Show appreciation", "I will tell {partnerObject} one specific thing I appreciate about {partnerPronounObject} today."),
  t("legacy_faith_morning", "faith_spiritual", "Morning reflection", "I will spend five quiet minutes in prayer or reflection before I start my day."),
  t("legacy_health_move", "health_energy", "Daily movement", "I will move intentionally for at least 20 minutes today."),
  t("legacy_career_hard", "career_leadership", "Do the hard thing first", "I will complete one important task I have been avoiding before noon today."),
  t("legacy_calm_pause", "calm_emotional", "Pause before reacting", "I will take one breath and pause before I respond when I feel triggered."),
  t("legacy_confidence_speak", "confidence_identity", "Speak up once", "I will share one clear opinion or decision in an important conversation today."),
  t("legacy_discipline_follow", "discipline_consistency", "Follow through today", "I will do the one commitment I already told myself I would do today."),
];

export const GOAL_TEMPLATES: GoalTemplate[] = [
  ...LEGACY_TEMPLATES,
  ...Object.values(FOCUS_TEMPLATES).flat(),
];

export function getTemplatesForArea(areaId: GoalAreaId): GoalTemplate[] {
  if (isGoalFocusAreaId(areaId)) {
    return FOCUS_TEMPLATES[areaId] ?? [];
  }
  return GOAL_TEMPLATES.filter((template) => template.areaId === areaId);
}

export function getTemplateById(id: string | null | undefined): GoalTemplate | null {
  if (!id) return null;
  return GOAL_TEMPLATES.find((template) => template.id === id) ?? null;
}

function bump(scores: Map<GoalFocusAreaId, number>, id: GoalFocusAreaId, n = 1) {
  scores.set(id, (scores.get(id) ?? 0) + n);
}

export function inferFocusAreasFromIdentity(anchorLower: string): GoalFocusAreaId[] {
  const scores = new Map<GoalFocusAreaId, number>();

  if (/\b(mom|dad|parent|child|kid|children|family)\b/.test(anchorLower)) {
    bump(scores, "parenting", 3);
    bump(scores, "family", 2);
    bump(scores, "presence", 2);
    bump(scores, "phone_distraction", 2);
    bump(scores, "emotional_control", 1);
    bump(scores, "health", 1);
    bump(scores, "work_boundaries", 1);
    bump(scores, "family_presence", 2);
  }
  if (/\b(wife|husband|spouse|partner|marriage)\b/.test(anchorLower)) {
    bump(scores, "relationship", 3);
    bump(scores, "presence", 2);
    bump(scores, "communication", 2);
    bump(scores, "phone_distraction", 2);
    bump(scores, "home_household", 1);
    bump(scores, "emotional_control", 1);
    bump(scores, "work_boundaries", 1);
  }
  if (/\b(entrepreneur|business owner|business)\b/.test(anchorLower)) {
    bump(scores, "business", 3);
    bump(scores, "deep_work", 2);
    bump(scores, "work_focus", 2);
    bump(scores, "planning", 2);
    bump(scores, "sales_outreach", 1);
    bump(scores, "decision_making", 1);
    bump(scores, "money_finances", 1);
    bump(scores, "phone_distraction", 1);
  }
  if (/\b(leader|leadership|coach|teacher|mentor)\b/.test(anchorLower)) {
    bump(scores, "leadership", 3);
    bump(scores, "coaching", 2);
    bump(scores, "hard_conversations", 2);
    bump(scores, "communication", 2);
    bump(scores, "team_culture", 1);
    bump(scores, "planning", 1);
    bump(scores, "follow_through", 2);
  }
  if (/\b(faith|god|prayer|spiritual)\b/.test(anchorLower)) {
    bump(scores, "faith", 3);
    bump(scores, "morning_routine", 2);
    bump(scores, "evening_routine", 1);
    bump(scores, "gratitude", 2);
    bump(scores, "service", 2);
    bump(scores, "discipline", 1);
    bump(scores, "family", 1);
  }
  if (/\b(discipline|disciplined|consistent|consistency|focus|follow through)\b/.test(anchorLower)) {
    bump(scores, "discipline", 3);
    bump(scores, "work_focus", 2);
    bump(scores, "deep_work", 2);
    bump(scores, "phone_distraction", 2);
    bump(scores, "morning_routine", 1);
    bump(scores, "evening_routine", 1);
    bump(scores, "planning", 1);
    bump(scores, "follow_through", 2);
  }
  if (/\b(health|fit|fitness|energy|strong)\b/.test(anchorLower)) {
    bump(scores, "health", 3);
  }
  if (/\b(calm|steady|patient|react|stress|emotional)\b/.test(anchorLower)) {
    bump(scores, "emotional_control", 3);
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const mustInclude: GoalFocusAreaId[] = [];
  if (/\b(mom|dad|parent|child|kid|children)\b/.test(anchorLower)) {
    mustInclude.push("parenting");
  }
  if (/\b(wife|husband|spouse|partner|marriage)\b/.test(anchorLower)) {
    mustInclude.push("relationship");
  }
  if (/\b(entrepreneur|business owner|business)\b/.test(anchorLower)) {
    mustInclude.push("business");
  }
  if (/\b(leader|leadership|coach|teacher|mentor)\b/.test(anchorLower)) {
    mustInclude.push("leadership");
  }
  if (/\b(faith|god|prayer|spiritual)\b/.test(anchorLower)) {
    mustInclude.push("faith");
  }

  const fallback: GoalFocusAreaId[] = [
    "phone_distraction",
    "health",
    "work_focus",
    "family_presence",
    "discipline",
    "morning_routine",
  ];

  const merged = [...mustInclude];
  for (const id of ranked) {
    if (!merged.includes(id)) merged.push(id);
  }
  for (const id of fallback) {
    if (!merged.includes(id)) merged.push(id);
  }

  const withoutSomethingElse = merged.filter((id) => id !== SOMETHING_ELSE_AREA_ID);
  return withoutSomethingElse.slice(0, 7);
}

/** @deprecated use inferFocusAreasFromIdentity */
export function inferGoalAreasFromIdentity(anchorLower: string): GoalAreaId[] {
  return inferFocusAreasFromIdentity(anchorLower);
}

function personalizeBehaviorForTemplate(
  template: GoalTemplate,
  context: GoalPersonalizationInput
): string {
  const ids = context.ingredientIds ?? [];
  const terms = resolveGoalRelationshipTerms(context);
  const tailored = personalizeGoalTemplateBehavior(template.id, template.behaviorStatement, ids);
  const personalized = applyGoalPersonalization(tailored, terms);
  if (isValidPersonalizedBehavior(personalized, context.identityAnchor ?? "")) {
    return personalized;
  }
  return applyGoalPersonalization(template.behaviorStatement, terms);
}

function isValidPersonalizedBehavior(behavior: string, identityAnchor: string): boolean {
  return isValidRecommendedGoalOption(
    { title: "Goal", behaviorStatement: behavior },
    identityAnchor
  );
}

export function buildRecommendedGoalsForArea(
  areaId: GoalAreaId,
  context: GoalPersonalizationInput = {}
): { title: string; behaviorStatement: string; templateId: string | null }[] {
  const identityAnchor = context.identityAnchor ?? "";
  const templates = getTemplatesForArea(areaId);
  const rawWithIds = templates.map((template) => ({
    templateId: template.id,
    title: template.title,
    behaviorStatement: personalizeBehaviorForTemplate(template, context),
  }));

  const valid = sanitizeGoalOptions(
    rawWithIds.map(({ title, behaviorStatement }) => ({ title, behaviorStatement })),
    identityAnchor,
    5
  );

  return valid.map((goal) => {
    const match = rawWithIds.find(
      (row) => row.title === goal.title && row.behaviorStatement === goal.behaviorStatement
    );
    return {
      ...goal,
      templateId: match?.templateId ?? null,
    };
  });
}

export function arenaToGoalArea(arena: Arena): GoalAreaId {
  return ARENA_TO_AREA[arena];
}

export function getVisibleFocusAreas(
  anchorLower: string,
  showAll: boolean
): { id: GoalFocusAreaId; label: string }[] {
  if (showAll) {
    return GOAL_FOCUS_AREAS;
  }
  const suggested = inferFocusAreasFromIdentity(anchorLower);
  const chips = suggested.map((id) => ({ id, label: GOAL_FOCUS_AREA_LABELS[id] }));
  if (!chips.some((chip) => chip.id === SOMETHING_ELSE_AREA_ID)) {
    chips.push({
      id: SOMETHING_ELSE_AREA_ID,
      label: GOAL_FOCUS_AREA_LABELS[SOMETHING_ELSE_AREA_ID],
    });
  }
  return chips;
}
