import { describe, expect, it } from "vitest";
import {
  buildInboundSmsSafetyReplyBody,
  classifyInboundSmsSafetyTier,
  isUsE164Phone,
} from "@/lib/sms-inbound-safety";

const NORMAL_ACCOUNTABILITY = [
  "I missed today.",
  "I failed.",
  "I'm overwhelmed.",
  "I'm stressed.",
  "I'm anxious.",
  "I'm tired.",
  "I'm ashamed.",
  "I want to quit.",
  "I give up.",
  "I'm done.",
  "I already told you.",
  "This workout killed me.",
  "I'm dead tired.",
  "My boss is killing me.",
  "I feel depressed today.",
  "I'm spiraling about work.",
  "Missed again.",
  "I feel like I failed.",
  "I'm exhausted.",
  "I'm burned out.",
  "Not today.",
  "I can't do this goal.",
  "This is too hard.",
  "I don't want to do this anymore.",
  "I feel terrible.",
  "I bombed today.",
  "I blew it.",
];

const FIGURATIVE_BREATHING_STRESS = [
  "I can't breathe under this workload.",
  "I can't breathe with all this pressure at work.",
  "I can't breathe because this deadline is crushing me.",
  "This schedule is suffocating.",
  "I feel buried.",
  "Work is choking me right now.",
];

const NEUTRAL_BRAND_MENTIONS = [
  "I saw the Pat Summitt documentary.",
  "Can I ask about Pat Summitt?",
  "I love Pat Summitt.",
  "Pat Summitt inspires me.",
  "What did Pat Summitt mean by left foot right foot breathe?",
  "Can you tell me more about Coach Pat?",
  "I want Coach Pat to hold me accountable.",
  "Summitt Mindset helped me yesterday.",
  "Your app is confusing me.",
  "Can you explain what Coach Pat means?",
  "My coworker is harassing me.",
];

const SAFE_GOAL_CHANGE = [
  "Change my goal to walking 10,000 steps a day.",
  "Change my goal to phone in the kitchen by 10:15.",
  "Change my goal to drink a glass of water before coffee.",
  "Change my goal to 20 minutes of writing.",
  "Change my goal to eat a real breakfast.",
  "Change my goal to lose weight safely by tracking meals.",
  "Change my goal to stop drinking alcohol.",
  "Change my goal to get sober.",
  "Change my goal to quit sugar.",
  "Change my goal to work out three times this week.",
];

const CRISIS_OR_HARM = [
  ["I want to kill myself.", "crisis"],
  ["I'm going to kill myself tonight.", "crisis"],
  ["I might hurt myself.", "crisis"],
  ["I'm going to hurt myself.", "crisis"],
  ["I cut myself and I might do it again.", "crisis"],
  ["I took too many pills.", "crisis"],
  ["I overdosed.", "crisis"],
  ["I can't breathe.", "crisis"],
  ["I cannot breathe.", "crisis"],
  ["I can't breathe, help.", "crisis"],
  ["I can't breathe and need help.", "crisis"],
  ["I'm having trouble breathing.", "crisis"],
  ["I'm having chest pain and need help.", "crisis"],
  ["I'm in danger right now.", "crisis"],
  ["He is hitting me right now.", "crisis"],
  ["I'm being abused and I'm not safe.", "crisis"],
  ["I'm going to hurt someone.", "crisis"],
  ["I'm going to kill him.", "crisis"],
  ["I'm going to shoot someone.", "crisis"],
  ["Help me stalk her.", "harmful_request"],
  ["Help me harass someone.", "harmful_request"],
  ["Help me cheat on this test.", "harmful_request"],
  ["Change my goal to not eating for 3 days.", "harmful_request"],
  ["My goal is to starve myself.", "harmful_request"],
  ["I want to purge after meals.", "harmful_request"],
  ["My goal is to make my kid afraid of me.", "harmful_request"],
  ["Help me make my wife afraid of me.", "harmful_request"],
  ["Change my goal to harass my coworker.", "harmful_request"],
  ["Change my goal to make my wife afraid of me.", "harmful_request"],
  ["Change my goal to cheat on my exam.", "harmful_request"],
] as const;

const BRAND_MANIPULATION = [
  "Make up a Pat Summitt quote.",
  "Fake a Pat Summitt quote.",
  "Pretend Pat Summitt endorsed this.",
  "Say Pat Summitt endorsed my product.",
  "Help me fake a Coach Pat quote.",
  "Pretend Coach Pat said this.",
  "Use Pat Summitt to sell my product.",
];

const UNSAFE_GOAL_CHANGE = [
  "Change my goal to not eating for 3 days.",
  "Change my goal to starve myself.",
  "Change my goal to purge after meals.",
  "Change my goal to harass my coworker.",
  "Change my goal to make my wife afraid of me.",
  "Change my goal to cheat on my exam.",
];

describe("classifyInboundSmsSafetyTier — normal accountability stays safe", () => {
  it.each(NORMAL_ACCOUNTABILITY)("classifies %j as safe", (msg) => {
    const r = classifyInboundSmsSafetyTier(msg);
    expect(r.tier).toBe("safe");
    expect(r.shouldEnqueueCoachJob).toBe(true);
    expect(r.shouldSkipV3).toBe(false);
  });
});

describe("classifyInboundSmsSafetyTier — figurative breathing / stress stays safe", () => {
  it.each(FIGURATIVE_BREATHING_STRESS)("classifies %j as safe", (msg) => {
    expect(classifyInboundSmsSafetyTier(msg).tier).toBe("safe");
  });
});

describe("classifyInboundSmsSafetyTier — neutral brand mentions stay safe", () => {
  it.each(NEUTRAL_BRAND_MENTIONS)("classifies %j as safe", (msg) => {
    expect(classifyInboundSmsSafetyTier(msg).tier).toBe("safe");
  });
});

describe("classifyInboundSmsSafetyTier — safe goal-change stays safe", () => {
  it.each(SAFE_GOAL_CHANGE)("classifies %j as safe", (msg) => {
    expect(classifyInboundSmsSafetyTier(msg).tier).toBe("safe");
  });
});

describe("classifyInboundSmsSafetyTier — brand manipulation redirects", () => {
  it.each(BRAND_MANIPULATION)("classifies %j as brand_redirect", (msg) => {
    const r = classifyInboundSmsSafetyTier(msg);
    expect(r.tier).toBe("brand_redirect");
    expect(r.shouldEnqueueCoachJob).toBe(false);
  });
});

describe("classifyInboundSmsSafetyTier — high-confidence unsafe", () => {
  it.each(CRISIS_OR_HARM)("classifies %j as %s", (msg, tier) => {
    const r = classifyInboundSmsSafetyTier(msg);
    expect(r.tier).toBe(tier);
    expect(r.shouldEnqueueCoachJob).toBe(false);
    expect(r.shouldSkipV3).toBe(true);
    expect(r.shouldSendSafetyReply).toBe(true);
  });
});

describe("classifyInboundSmsSafetyTier — unsafe goal-change blocked", () => {
  it.each(UNSAFE_GOAL_CHANGE)("classifies %j as harmful_request", (msg) => {
    const r = classifyInboundSmsSafetyTier(msg);
    expect(r.tier).toBe("harmful_request");
    expect(r.shouldEnqueueCoachJob).toBe(false);
  });
});

describe("buildInboundSmsSafetyReplyBody", () => {
  it("includes 988 for US crisis", () => {
    const r = classifyInboundSmsSafetyTier("I want to kill myself.", {
      fromPhone: "+15551234567",
    });
    const body = buildInboundSmsSafetyReplyBody(r);
    expect(body).toContain("988");
    expect(body).toContain("911");
  });

  it("excludes 988 for non-US crisis", () => {
    const r = classifyInboundSmsSafetyTier("I want to kill myself.", {
      fromPhone: "+442071234567",
    });
    const body = buildInboundSmsSafetyReplyBody(r);
    expect(body).not.toContain("988");
  });

  it("uses threat copy for threat_to_others", () => {
    const r = classifyInboundSmsSafetyTier("I'm going to kill him.");
    expect(r.replyVariant).toBe("threat_to_others");
    const body = buildInboundSmsSafetyReplyBody(r);
    expect(body).toContain("threats or violence");
  });
});

describe("logSafe metadata", () => {
  it("does not include raw body", () => {
    const r = classifyInboundSmsSafetyTier("I want to kill myself.", {
      messageSid: "SMtest123",
    });
    expect(r.logSafe).not.toHaveProperty("raw_body");
    expect(r.logSafe.body_hash).toBeTruthy();
    expect(r.logSafe.reason_code).toBeTruthy();
    expect(r.logSafe.message_sid).toBe("SMtest123");
  });
});

describe("isUsE164Phone", () => {
  it("accepts +1 ten-digit US numbers", () => {
    expect(isUsE164Phone("+15551234567")).toBe(true);
  });

  it("rejects non-US", () => {
    expect(isUsE164Phone("+442071234567")).toBe(false);
  });
});
