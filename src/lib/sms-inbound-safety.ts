/**
 * Narrow deterministic inbound SMS safety routing (high precision, not broad mental-health classification).
 */

import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

export type SmsInboundSafetyTier = "safe" | "crisis" | "harmful_request" | "brand_redirect";

export type SmsInboundSafetyCategory =
  | "self_harm"
  | "suicide"
  | "immediate_danger"
  | "medical_emergency"
  | "threat_to_others"
  | "abuse_victim"
  | "illegal_or_harmful_goal"
  | "dangerous_body_goal"
  | "brand_damaging"
  | null;

export type SmsInboundSafetyReplyVariant =
  | "crisis_us"
  | "crisis_non_us"
  | "threat_to_others"
  | "harmful_request_redirect"
  | "dangerous_body_goal"
  | "brand_redirect"
  | null;

export type ClassifyInboundSmsSafetyOptions = {
  fromPhone?: string | null;
  messageSid?: string | null;
};

export type ClassifyInboundSmsSafetyResult = {
  tier: SmsInboundSafetyTier;
  category: SmsInboundSafetyCategory;
  reasonCode: string;
  shouldEnqueueCoachJob: boolean;
  shouldSendSafetyReply: boolean;
  shouldSkipV3: boolean;
  replyVariant: SmsInboundSafetyReplyVariant;
  logSafe: {
    tier: SmsInboundSafetyTier;
    category: SmsInboundSafetyCategory;
    reason_code: string;
    body_len: number;
    body_hash: string | null;
    is_us_phone: boolean | null;
    message_sid: string | null;
  };
};

type SafetyRule = {
  tier: SmsInboundSafetyTier;
  category: SmsInboundSafetyCategory;
  reasonCode: string;
  replyVariant: SmsInboundSafetyReplyVariant;
  pattern: RegExp;
};

const CRISIS_RULES: SafetyRule[] = [
  {
    tier: "crisis",
    category: "suicide",
    reasonCode: "crisis_suicide",
    replyVariant: "crisis_us",
    pattern: /\b(kill\s+myself|suicide|end\s+my\s+life|want\s+to\s+die)\b/i,
  },
  {
    tier: "crisis",
    category: "suicide",
    reasonCode: "crisis_suicide_intent",
    replyVariant: "crisis_us",
    pattern: /\b(going\s+to\s+kill\s+myself|want\s+to\s+kill\s+myself)\b/i,
  },
  {
    tier: "crisis",
    category: "self_harm",
    reasonCode: "crisis_self_harm",
    replyVariant: "crisis_us",
    pattern: /\b(might\s+hurt\s+myself|hurt\s+myself|going\s+to\s+hurt\s+myself|self[- ]?harm)\b/i,
  },
  {
    tier: "crisis",
    category: "self_harm",
    reasonCode: "crisis_self_harm_cut",
    replyVariant: "crisis_us",
    pattern: /\bcut\s+myself\b/i,
  },
  {
    tier: "crisis",
    category: "suicide",
    reasonCode: "crisis_quit_life",
    replyVariant: "crisis_us",
    pattern: /\b(want\s+to\s+quit\s+life|quit\s+life)\b/i,
  },
  {
    tier: "crisis",
    category: "medical_emergency",
    reasonCode: "crisis_overdose",
    replyVariant: "crisis_us",
    pattern: /\b(took\s+too\s+many\s+pills|overdosed?)\b/i,
  },
  {
    tier: "crisis",
    category: "medical_emergency",
    reasonCode: "crisis_trouble_breathing",
    replyVariant: "crisis_us",
    pattern: /\bi'?m\s+having\s+trouble\s+breathing\b/i,
  },
  {
    tier: "crisis",
    category: "medical_emergency",
    reasonCode: "crisis_chest_pain",
    replyVariant: "crisis_us",
    pattern: /\bchest\s+pain\b.*\b(need\s+help|help)\b/i,
  },
  {
    tier: "crisis",
    category: "immediate_danger",
    reasonCode: "crisis_immediate_danger",
    replyVariant: "crisis_us",
    pattern: /\bin\s+danger\s+right\s+now\b/i,
  },
  {
    tier: "crisis",
    category: "abuse_victim",
    reasonCode: "crisis_abuse_active",
    replyVariant: "crisis_us",
    pattern: /\b(he|she|they)\s+(is|are)\s+hitting\s+me\s+right\s+now\b/i,
  },
  {
    tier: "crisis",
    category: "abuse_victim",
    reasonCode: "crisis_abuse_unsafe",
    replyVariant: "crisis_us",
    pattern: /\bbeing\s+abused\b.*\bnot\s+safe\b/i,
  },
  {
    tier: "crisis",
    category: "threat_to_others",
    reasonCode: "crisis_threat_harm",
    replyVariant: "threat_to_others",
    pattern: /\b(going\s+to\s+hurt\s+someone|hurt\s+someone)\b/i,
  },
  {
    tier: "crisis",
    category: "threat_to_others",
    reasonCode: "crisis_threat_kill",
    replyVariant: "threat_to_others",
    pattern: /\b(going\s+to\s+kill\s+(him|her|them|someone))\b/i,
  },
  {
    tier: "crisis",
    category: "threat_to_others",
    reasonCode: "crisis_threat_shoot",
    replyVariant: "threat_to_others",
    pattern: /\b(going\s+to\s+shoot\s+someone)\b/i,
  },
];

const HARMFUL_REQUEST_RULES: SafetyRule[] = [
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_stalk",
    replyVariant: "harmful_request_redirect",
    pattern: /\bhelp\s+me\s+stalk\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_harass",
    replyVariant: "harmful_request_redirect",
    pattern: /\bhelp\s+me\s+harass\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_cheat",
    replyVariant: "harmful_request_redirect",
    pattern: /\bhelp\s+me\s+cheat\b/i,
  },
  {
    tier: "harmful_request",
    category: "dangerous_body_goal",
    reasonCode: "harmful_restrict_eating",
    replyVariant: "dangerous_body_goal",
    pattern: /\b(not\s+eating\s+for\s+\d+\s+days|change\s+my\s+goal\s+to\s+not\s+eating)\b/i,
  },
  {
    tier: "harmful_request",
    category: "dangerous_body_goal",
    reasonCode: "harmful_starve_goal",
    replyVariant: "dangerous_body_goal",
    pattern: /\b(goal\s+is\s+to\s+starve|starve\s+myself|my\s+goal\s+is\s+to\s+starve)\b/i,
  },
  {
    tier: "harmful_request",
    category: "dangerous_body_goal",
    reasonCode: "harmful_purge",
    replyVariant: "dangerous_body_goal",
    pattern: /\b(purge\s+after\s+meals|want\s+to\s+purge)\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_coerce_afraid",
    replyVariant: "harmful_request_redirect",
    pattern: /\b(make\s+my\s+(wife|husband|kid|child|kids)\s+afraid|help\s+me\s+make\s+my\s+(wife|husband|kid|child)\s+afraid)\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_goal_harass_stalk",
    replyVariant: "harmful_request_redirect",
    pattern:
      /\b(change\s+my\s+goal\s+to|goal\s+is\s+to|my\s+goal\s+is\s+to)\s+[^.]{0,100}\b(harass|stalk|threaten|intimidate)\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_goal_cheat_steal",
    replyVariant: "harmful_request_redirect",
    pattern:
      /\b(change\s+my\s+goal\s+to|goal\s+is\s+to|my\s+goal\s+is\s+to)\s+[^.]{0,100}\b(cheat|steal|fraud)\b/i,
  },
  {
    tier: "harmful_request",
    category: "illegal_or_harmful_goal",
    reasonCode: "harmful_goal_scare",
    replyVariant: "harmful_request_redirect",
    pattern:
      /\b(change\s+my\s+goal\s+to|goal\s+is\s+to|my\s+goal\s+is\s+to)\s+[^.]{0,100}\b(make\s+.{0,50}\s+afraid|scare\s+.{0,30})\b/i,
  },
];

const BRAND_RULES: SafetyRule[] = [
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_fake_quote",
    replyVariant: "brand_redirect",
    pattern: /\b(make\s+up|fake|invent)\s+(?:a\s+)?(?:pat\s+summitt|coach\s+pat)\s+quote\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_fake_endorsement",
    replyVariant: "brand_redirect",
    pattern: /\b(?:pretend|say)\s+(?:that\s+)?(?:pat\s+summitt|coach\s+pat)\s+(?:endorsed|told\s+me\s+to)\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_endorse_product",
    replyVariant: "brand_redirect",
    pattern: /\bsay\s+pat\s+summitt\s+endorsed\s+my\s+product\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_use_to_sell",
    replyVariant: "brand_redirect",
    pattern: /\buse\s+pat\s+summitt\s+to\s+sell\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_fake_quote_help",
    replyVariant: "brand_redirect",
    pattern: /\bhelp\s+me\s+fake\s+a\s+coach\s+pat\s+quote\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_pretend_said",
    replyVariant: "brand_redirect",
    pattern: /\bpretend\s+coach\s+pat\s+said\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_write_fake_quote",
    replyVariant: "brand_redirect",
    pattern: /\b(?:write|make)\s+a\s+fake\s+quote\s+from\s+coach\s+pat\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_impersonate_said",
    replyVariant: "brand_redirect",
    pattern: /\bmake\s+it\s+sound\s+like\s+pat\s+summitt\s+personally\s+said\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_name_to_trick",
    replyVariant: "brand_redirect",
    pattern: /\buse\s+pat\s+summitt'?s?\s+name\s+to\s+trick\b/i,
  },
  {
    tier: "brand_redirect",
    category: "brand_damaging",
    reasonCode: "brand_false_claim_support",
    replyVariant: "brand_redirect",
    pattern: /\bhelp\s+me\s+falsely\s+claim\s+pat\s+summitt\s+supports\b/i,
  },
];

/** Workload/stress metaphor — not acute medical inability to breathe. */
function isFigurativeBreathingOrStressOverload(text: string): boolean {
  if (/\b(this\s+schedule\s+is\s+suffocating|work\s+is\s+choking\s+me|i\s+feel\s+buried)\b/i.test(text)) {
    return true;
  }
  if (!/\bi\s+can'?t\s+breathe\b/i.test(text) && !/\bi\s+cannot\s+breathe\b/i.test(text)) {
    return false;
  }
  return /\b(under\s+this\s+workload|with\s+all\s+this\s+pressure|because\s+this\s+deadline|at\s+work|crushing\s+me|deadline|workload|suffocating|pressure)\b/i.test(
    text
  );
}

function matchLiteralBreathingCrisis(normalized: string): SafetyRule | null {
  if (isFigurativeBreathingOrStressOverload(normalized)) return null;

  const literalPatterns: Array<{ reasonCode: string; pattern: RegExp }> = [
    {
      reasonCode: "crisis_cant_breathe_short",
      pattern: /^(?:i\s+can'?t\s+breathe|i\s+cannot\s+breathe)\s*[.!?]?\s*$/i,
    },
    {
      reasonCode: "crisis_cant_breathe_help",
      pattern: /\bi\s+can'?t\s+breathe\s*[,]?\s*(?:help|and\s+need\s+help|please\s+help)\b/i,
    },
    {
      reasonCode: "crisis_cant_breathe_need_help",
      pattern: /\bi\s+can'?t\s+breathe\s+and\s+need\s+help\b/i,
    },
  ];

  for (const p of literalPatterns) {
    if (p.pattern.test(normalized)) {
      return {
        tier: "crisis",
        category: "medical_emergency",
        reasonCode: p.reasonCode,
        replyVariant: "crisis_us",
        pattern: p.pattern,
      };
    }
  }
  return null;
}

function normalizeInboundSmsBody(body: string): string {
  return (body || "").trim().replace(/\s+/g, " ");
}

export function isUsE164Phone(phone: string | null | undefined): boolean {
  const p = (phone || "").trim().replace(/[^\d+]/g, "");
  return /^\+1\d{10}$/.test(p);
}

function isSafetyEnabled(): boolean {
  const v = process.env.SMS_INBOUND_SAFETY_ENABLED;
  if (v === undefined || v === "") return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

function resolveCrisisReplyVariant(
  category: SmsInboundSafetyCategory,
  isUs: boolean | null
): SmsInboundSafetyReplyVariant {
  if (category === "threat_to_others") return "threat_to_others";
  if (isUs === true) return "crisis_us";
  return "crisis_non_us";
}

function buildSafeResult(
  rule: SafetyRule,
  bodyLen: number,
  bodyHash: string | null,
  isUs: boolean | null,
  messageSid: string | null
): ClassifyInboundSmsSafetyResult {
  const replyVariant =
    rule.tier === "crisis"
      ? resolveCrisisReplyVariant(rule.category, isUs)
      : rule.replyVariant;

  return {
    tier: rule.tier,
    category: rule.category,
    reasonCode: rule.reasonCode,
    shouldEnqueueCoachJob: false,
    shouldSendSafetyReply: true,
    shouldSkipV3: true,
    replyVariant,
    logSafe: {
      tier: rule.tier,
      category: rule.category,
      reason_code: rule.reasonCode,
      body_len: bodyLen,
      body_hash: bodyHash,
      is_us_phone: isUs,
      message_sid: messageSid ?? null,
    },
  };
}

function buildSafeDefault(
  bodyLen: number,
  bodyHash: string | null,
  isUs: boolean | null,
  messageSid: string | null
): ClassifyInboundSmsSafetyResult {
  return {
    tier: "safe",
    category: null,
    reasonCode: "safe",
    shouldEnqueueCoachJob: true,
    shouldSendSafetyReply: false,
    shouldSkipV3: false,
    replyVariant: null,
    logSafe: {
      tier: "safe",
      category: null,
      reason_code: "safe",
      body_len: bodyLen,
      body_hash: bodyHash,
      is_us_phone: isUs,
      message_sid: messageSid ?? null,
    },
  };
}

/**
 * True when text must not become a pending/active commitment candidate.
 */
export function isUnsafeSmsGoalCandidateText(text: string): boolean {
  const r = classifyInboundSmsSafetyTier(text);
  return r.tier !== "safe";
}

export function classifyInboundSmsSafetyTier(
  body: string,
  options?: ClassifyInboundSmsSafetyOptions
): ClassifyInboundSmsSafetyResult {
  const normalized = normalizeInboundSmsBody(body);
  const bodyLen = normalized.length;
  const bodyHash = normalized ? hashSmsSnippet(normalized) : null;
  const isUs = options?.fromPhone != null ? isUsE164Phone(options.fromPhone) : null;
  const messageSid = options?.messageSid ?? null;

  if (!isSafetyEnabled() || !normalized) {
    return buildSafeDefault(bodyLen, bodyHash, isUs, messageSid);
  }

  try {
    const breathingCrisis = matchLiteralBreathingCrisis(normalized);
    if (breathingCrisis) {
      return buildSafeResult(breathingCrisis, bodyLen, bodyHash, isUs, messageSid);
    }

    for (const rule of CRISIS_RULES) {
      if (rule.pattern.test(normalized)) {
        return buildSafeResult(rule, bodyLen, bodyHash, isUs, messageSid);
      }
    }

    for (const rule of HARMFUL_REQUEST_RULES) {
      if (rule.pattern.test(normalized)) {
        return buildSafeResult(rule, bodyLen, bodyHash, isUs, messageSid);
      }
    }

    for (const rule of BRAND_RULES) {
      if (rule.pattern.test(normalized)) {
        return buildSafeResult(rule, bodyLen, bodyHash, isUs, messageSid);
      }
    }

    return buildSafeDefault(bodyLen, bodyHash, isUs, messageSid);
  } catch {
    return buildSafeDefault(bodyLen, bodyHash, isUs, messageSid);
  }
}

const SAFETY_COPY: Record<Exclude<SmsInboundSafetyReplyVariant, null>, string> = {
  crisis_us:
    "If you are in crisis or might hurt yourself, please call or text 988 (US). If you are in immediate danger, call 911 (US) or your local emergency number. Summitt Mindset cannot provide emergency or mental health care by text.",
  crisis_non_us:
    "If you are in crisis or might hurt yourself, contact your local emergency number or a crisis line in your country now. If you can, reach someone you trust nearby. Summitt Mindset cannot provide emergency or mental health care by text.",
  threat_to_others:
    "If you or someone else may be in immediate danger, contact local emergency services now. Summitt Mindset cannot help with threats or violence by text. Reply when things are safe and we can continue.",
  harmful_request_redirect:
    "Summitt Mindset cannot help with that request. Coach Pat’s check-ins are for safe, legal daily commitments. Send me a safe standard you want to practice, and we’ll work from there.",
  dangerous_body_goal:
    "Summitt Mindset cannot help with dangerous food or body goals. If this connects to your health or safety, please reach out to a qualified professional or someone you trust. Send me a safe daily commitment and we’ll work from there.",
  brand_redirect:
    "Summitt Mindset can help with safe daily accountability, but I can’t help with that request. Send me the safe standard you want Coach Pat to hold you to.",
};

export function buildInboundSmsSafetyReplyBody(
  result: ClassifyInboundSmsSafetyResult
): string | null {
  if (!result.shouldSendSafetyReply || !result.replyVariant) return null;
  return SAFETY_COPY[result.replyVariant] ?? null;
}

export function inboundSmsSafetyLastErrorPayload(
  result: ClassifyInboundSmsSafetyResult,
  tag: string,
  extras?: Record<string, unknown>
): string {
  try {
    return JSON.stringify({
      tag,
      ...result.logSafe,
      ...(extras ?? {}),
    }).slice(0, 1900);
  } catch {
    return tag;
  }
}
