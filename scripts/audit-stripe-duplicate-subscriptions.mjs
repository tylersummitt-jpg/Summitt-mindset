#!/usr/bin/env node
/**
 * Audit-only: find Stripe customers with more than one active OR trialing
 * subscription that looks like Summitt Mindset (same heuristics as checkout).
 *
 * Does NOT cancel, update, or mutate Stripe or any database.
 *
 * Usage (from repo root):
 *   node scripts/audit-stripe-duplicate-subscriptions.mjs
 *
 * Requires env (e.g. in .env.local — auto-loaded if file exists):
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_ID_MONTHLY (optional but improves matching)
 *   STRIPE_PRICE_ID_ANNUAL  (optional but improves matching)
 *   STRIPE_LEGACY_PRICE_IDS (optional comma-separated grandfathered Price IDs)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Stripe from "stripe";

function loadEnvLocal() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

const monthlyPriceId = process.env.STRIPE_PRICE_ID_MONTHLY || "";
const annualPriceId = process.env.STRIPE_PRICE_ID_ANNUAL || "";
const legacyPriceIdsCsv = process.env.STRIPE_LEGACY_PRICE_IDS || "";

/** Match src/lib/stripe-recognized-price-ids.ts parse + allowlist behavior. */
function parseStripePriceIdList(raw) {
  if (raw == null || typeof raw !== "string") return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function getRecognizedSummittPriceIds() {
  const ids = new Set();
  for (const raw of [monthlyPriceId, annualPriceId]) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id) ids.add(id);
  }
  for (const id of parseStripePriceIdList(legacyPriceIdsCsv)) {
    ids.add(id);
  }
  return ids;
}

const recognizedPriceIds = getRecognizedSummittPriceIds();

function isLikelySummittSubscription(sub) {
  const mdPlan = sub.metadata?.plan;
  if (mdPlan === "monthly" || mdPlan === "annual") return true;
  const mdUser = sub.metadata?.userId;
  if (typeof mdUser === "string" && mdUser.trim().length > 0) return true;
  const pid = sub.items?.data?.[0]?.price?.id;
  if (typeof pid === "string" && recognizedPriceIds.has(pid)) return true;
  return false;
}

function isActiveOrTrialing(sub) {
  return sub.status === "active" || sub.status === "trialing";
}

function customerIdOf(sub) {
  const c = sub.customer;
  return typeof c === "string" ? c : c && typeof c === "object" && "id" in c ? c.id : null;
}

function iso(ts) {
  if (ts == null || ts === "") return "—";
  try {
    return new Date(ts * 1000).toISOString();
  } catch {
    return String(ts);
  }
}

async function fetchAllSubscriptions(stripe, status) {
  const out = [];
  for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
    if (isActiveOrTrialing(sub) && isLikelySummittSubscription(sub)) {
      out.push(sub);
    }
  }
  return out;
}

function sortForRecommendation(subs) {
  return [...subs].sort((a, b) => {
    const rank = (s) => (s.status === "active" ? 0 : 1);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const endA = a.current_period_end ?? 0;
    const endB = b.current_period_end ?? 0;
    return endB - endA;
  });
}

function recommend(sortedSubs) {
  if (sortedSubs.length <= 1) return "No duplicate — single subscription.";
  const newest = sortedSubs[0];
  const oldest = sortedSubs[sortedSubs.length - 1];
  return [
    "MANUAL REVIEW REQUIRED: multiple active/trialing Summitt-like subs on one customer.",
    `Heuristic (not automatic): prefer keeping subscription ${newest.id} (status=${newest.status}, current_period_end=${iso(newest.current_period_end)}).`,
    `Oldest in this group: ${oldest.id} (created=${iso(oldest.created)}).`,
    "Cancel or merge extras only after confirming billing history, refunds, and Clerk user mapping in Stripe Dashboard.",
  ].join(" ");
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Missing STRIPE_SECRET_KEY (set in env or .env.local).");
    process.exit(1);
  }

  const stripe = new Stripe(key);

  console.log("Fetching active + trialing Summitt-like subscriptions (paginated)…");
  const [active, trialing] = await Promise.all([
    fetchAllSubscriptions(stripe, "active"),
    fetchAllSubscriptions(stripe, "trialing"),
  ]);

  const all = [...active, ...trialing];
  const byCustomer = new Map();

  for (const sub of all) {
    const cid = customerIdOf(sub);
    if (!cid) continue;
    if (!byCustomer.has(cid)) byCustomer.set(cid, []);
    byCustomer.get(cid).push(sub);
  }

  const duplicates = [...byCustomer.entries()].filter(
    ([, subs]) => subs.length > 1
  );

  console.log("\n=== Summitt duplicate-subscription audit (read-only) ===\n");
  console.log(`Summitt-like active: ${active.length}, trialing: ${trialing.length}`);
  console.log(`Unique customers (with ≥1 such sub): ${byCustomer.size}`);
  console.log(`Customers with >1 active/trialing Summitt-like sub: ${duplicates.length}\n`);

  if (duplicates.length === 0) {
    console.log("No duplicates found by this heuristic.");
    process.exit(0);
  }

  for (const [customerId, subs] of duplicates) {
    let email = "—";
    try {
      const cust = await stripe.customers.retrieve(customerId);
      if (!cust.deleted && cust.email) email = cust.email;
    } catch (e) {
      email = `(retrieve failed: ${e.message})`;
    }

    const activeIds = subs.filter((s) => s.status === "active").map((s) => s.id);
    const trialingIds = subs.filter((s) => s.status === "trialing").map((s) => s.id);
    const sorted = sortForRecommendation(subs);

    console.log("—".repeat(72));
    console.log(`Customer email:     ${email}`);
    console.log(`Stripe customer ID: ${customerId}`);
    console.log(`Active sub IDs:     ${activeIds.length ? activeIds.join(", ") : "(none)"}`);
    console.log(`Trialing sub IDs:   ${trialingIds.length ? trialingIds.join(", ") : "(none)"}`);
    console.log("");
    for (const s of sorted) {
      const trialEnd = s.trial_end ? iso(s.trial_end) : "—";
      console.log(
        `  • ${s.id}  status=${s.status}  created=${iso(s.created)}  current_period_end=${iso(s.current_period_end)}  trial_end=${trialEnd}  price=${s.items?.data?.[0]?.price?.id ?? "—"}  metadata.userId=${s.metadata?.userId ?? "—"}`
      );
    }
    console.log("");
    console.log(`Recommendation: ${recommend(sorted)}`);
    console.log("");
  }

  console.log("Done. No Stripe writes were performed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
