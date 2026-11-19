import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscriptionRetryEffect } from "@/lib/acquisition/model";
import { noteAcquisitionPaid, noteAcquisitionTrial } from "@/lib/acquisition/store";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  people: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  blocks: [] as Record<string, unknown>[],
  actions: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from(table: string) {
      return query(table);
    },
  },
}));

const people = db.people;
const events = db.events;
const blocks = db.blocks;
const actions = db.actions;

function query(table: string) {
  const op: {
    action: "select" | "insert" | "update";
    payload: Row | null;
    filters: Array<{ kind: "eq" | "is" | "contains"; column: string; value: unknown }>;
    single: boolean;
  } = { action: "select", payload: null, filters: [], single: false };
  const rows = () => (
    table === "acquisition_people" ? db.people
      : table === "acquisition_events" ? db.events
        : table === "acquisition_instantly_blocks" ? db.blocks
          : db.actions
  );
  const matches = (row: Row) => op.filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    if (filter.kind === "is") return row[filter.column] == null;
    const metadata = row[filter.column];
    if (!metadata || typeof metadata !== "object" || !filter.value || typeof filter.value !== "object") return false;
    return Object.entries(filter.value as Row).every(([key, value]) => (metadata as Row)[key] === value);
  });
  const run = () => {
    if (op.action === "insert") {
      const payload = { ...op.payload };
      if (table === "acquisition_events") {
        const duplicate = events.some((row) => row.provider === payload.provider && row.provider_event_id === payload.provider_event_id);
        if (duplicate) return { data: null, error: { code: "23505" } };
        events.push(payload);
        return { data: null, error: null };
      }
      if (table === "acquisition_instantly_blocks") {
        const duplicate = blocks.some((row) => row.email_normalized === payload.email_normalized || row.source_event_id === payload.source_event_id);
        if (duplicate) return { data: null, error: { code: "23505" } };
        blocks.push({ id: `block-${blocks.length + 1}`, provider_entry_id: null, ...payload });
        return { data: null, error: null };
      }
      return { data: null, error: { code: "unsupported" } };
    }
    if (op.action === "update") {
      const matched = rows().filter(matches);
      for (const row of matched) Object.assign(row, op.payload);
      return { data: matched.map((row) => ({ id: row.id })), error: null };
    }
    const matched = rows().filter(matches);
    return { data: op.single ? matched[0] ?? null : matched, error: null };
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (payload: Row) => {
      op.action = "insert";
      op.payload = payload;
      return builder;
    },
    update: (payload: Row) => {
      op.action = "update";
      op.payload = payload;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      op.filters.push({ kind: "eq", column, value });
      return builder;
    },
    is: (column: string, value: unknown) => {
      op.filters.push({ kind: "is", column, value });
      return builder;
    },
    contains: (column: string, value: unknown) => {
      op.filters.push({ kind: "contains", column, value });
      return builder;
    },
    limit: () => builder,
    maybeSingle: () => {
      op.single = true;
      return Promise.resolve(run());
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

function reset() {
  people.length = 0;
  events.length = 0;
  blocks.length = 0;
  actions.length = 0;
}

function person(lifecycle: string, subscriptionId: string | null = null): Row {
  return {
    id: "person-1",
    email_normalized: "coach@example.com",
    first_name: null,
    last_name: null,
    lifecycle_state: lifecycle,
    requested_asset: null,
    offer_key: null,
    clerk_user_id: null,
    stripe_customer_id: null,
    stripe_subscription_id: subscriptionId,
    source_campaign: "camp_direct",
    source_sender: null,
    sport: null,
    role: null,
    geography: null,
    close_reason: null,
    next_action_type: "send_asset",
    next_action_at: "2026-11-20T00:00:00.000Z",
  };
}

function linkedEvent(eventType: "trial_started" | "paid_member", subscriptionId = "sub_1") {
  events.push({
    id: `event-${events.length + 1}`,
    person_id: "person-1",
    provider: "stripe",
    provider_event_id: `${eventType === "trial_started" ? "trial" : "paid"}:subscription:${subscriptionId}`,
    event_type: eventType,
    occurred_at: "2026-11-19T12:00:00.000Z",
    campaign_id: "camp_direct",
    journey_id: null,
    metadata: {
      subscription_id: subscriptionId,
      stripe_event_id: "evt_first",
      acquisition_attribution: "campaign_link",
      checkout_email: "coach@example.com",
    },
  });
}

function scheduledAction() {
  actions.push({ id: "action-1", person_id: "person-1", status: "scheduled", journey_id: null });
}

beforeEach(() => {
  reset();
});

describe("subscription retry effect", () => {
  it("applies a trial only from a live sales state", () => {
    expect(subscriptionRetryEffect({ signal: "trial_started", lifecycle: "cold_active" }).applySignal).toBe(true);
    expect(subscriptionRetryEffect({ signal: "trial_started", lifecycle: "not_interested" }).applySignal).toBe(true);
    for (const lifecycle of ["trial_started", "paid_member", "trial_expired", "unsubscribed", "suppressed"]) {
      expect(subscriptionRetryEffect({ signal: "trial_started", lifecycle }).applySignal).toBe(false);
    }
  });

  it("applies a payment from a trial or an expired trial, and not from a hard stop", () => {
    expect(subscriptionRetryEffect({ signal: "paid_member", lifecycle: "trial_started" }).applySignal).toBe(true);
    expect(subscriptionRetryEffect({ signal: "paid_member", lifecycle: "trial_expired" }).applySignal).toBe(true);
    for (const lifecycle of ["paid_member", "unsubscribed", "suppressed"]) {
      expect(subscriptionRetryEffect({ signal: "paid_member", lifecycle }).applySignal).toBe(false);
    }
  });
});

describe("stripe acquisition retry after a crash", () => {
  it("finishes the trial block, lifecycle, and cancellation when the linked event already exists", async () => {
    people.push(person("cold_active"));
    linkedEvent("trial_started");
    scheduledAction();

    await noteAcquisitionTrial({
      email: "coach@example.com",
      clerkUserId: "user_1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      eventId: "evt_retry",
      campaignId: "camp_direct",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.person_id).toBe("person-1");
    expect(blocks).toEqual([
      expect.objectContaining({
        email_normalized: "coach@example.com",
        person_id: "person-1",
        reason: "trial_started",
        status: "pending",
        source_event_id: "stripe:trial:evt_retry",
      }),
    ]);
    expect(people[0]?.lifecycle_state).toBe("trial_started");
    expect(people[0]?.stripe_subscription_id).toBe("sub_1");
    expect(actions[0]?.status).toBe("canceled");
    expect(people[0]?.next_action_type).toBeNull();
  });

  it("does not queue a second block or move the lifecycle again on another retry", async () => {
    people.push(person("cold_active"));
    linkedEvent("trial_started");
    await noteAcquisitionTrial({
      email: "coach@example.com",
      clerkUserId: null,
      customerId: null,
      subscriptionId: "sub_1",
      eventId: "evt_retry",
      campaignId: "camp_direct",
    });
    await noteAcquisitionTrial({
      email: "coach@example.com",
      clerkUserId: null,
      customerId: null,
      subscriptionId: "sub_1",
      eventId: "evt_retry",
      campaignId: "camp_direct",
    });

    expect(events).toHaveLength(1);
    expect(blocks).toHaveLength(1);
    expect(people[0]?.lifecycle_state).toBe("trial_started");
  });

  it("queues the trial block without moving a paid, expired, unsubscribed, or suppressed person", async () => {
    for (const lifecycle of ["paid_member", "trial_expired", "unsubscribed", "suppressed"]) {
      reset();
      people.push(person(lifecycle, "sub_1"));
      linkedEvent("trial_started");
      scheduledAction();
      await noteAcquisitionTrial({
        email: "coach@example.com",
        clerkUserId: null,
        customerId: null,
        subscriptionId: "sub_1",
        eventId: "evt_retry",
        campaignId: "camp_direct",
      });
      expect(people[0]?.lifecycle_state).toBe(lifecycle);
      expect(blocks[0]?.reason).toBe("trial_started");
      expect(actions[0]?.status).toBe("canceled");
      expect(events).toHaveLength(1);
    }
  });

  it("does not attach a different checkout email to the prospect", async () => {
    people.push(person("cold_active"));
    events.push({
      id: "event-1",
      person_id: null,
      provider: "stripe",
      provider_event_id: "trial:subscription:sub_1",
      event_type: "trial_started",
      campaign_id: "camp_direct",
      journey_id: null,
      metadata: {
        subscription_id: "sub_1",
        checkout_email: "payer@example.com",
        acquisition_attribution: "campaign_link",
      },
    });

    await noteAcquisitionTrial({
      email: "coach@example.com",
      clerkUserId: null,
      customerId: null,
      subscriptionId: "sub_1",
      eventId: "evt_retry",
      campaignId: "camp_direct",
    });

    expect(events[0]?.person_id).toBeNull();
    expect(blocks).toHaveLength(0);
    expect(people[0]?.lifecycle_state).toBe("cold_active");
    expect(people[0]?.stripe_subscription_id).toBeNull();
  });

  it("finishes a paid block and payment lifecycle when the paid event already exists", async () => {
    people.push(person("trial_started", "sub_1"));
    linkedEvent("paid_member");
    scheduledAction();

    await noteAcquisitionPaid({
      email: "coach@example.com",
      clerkUserId: "user_1",
      subscriptionId: "sub_1",
      eventId: "evt_paid_retry",
      campaignId: "camp_direct",
    });

    expect(events).toHaveLength(1);
    expect(blocks[0]).toEqual(expect.objectContaining({
      reason: "paid_member",
      status: "pending",
      source_event_id: "stripe:paid:evt_paid_retry",
    }));
    expect(people[0]?.lifecycle_state).toBe("paid_member");
    expect(actions[0]?.status).toBe("canceled");
  });

  it("lets an expired trial become paid on retry and leaves an unsubscribed person stopped", async () => {
    people.push(person("trial_expired", "sub_1"));
    linkedEvent("paid_member");
    await noteAcquisitionPaid({
      email: "coach@example.com",
      clerkUserId: null,
      subscriptionId: "sub_1",
      eventId: "evt_paid_retry",
      campaignId: "camp_direct",
    });
    expect(people[0]?.lifecycle_state).toBe("paid_member");

    reset();
    people.push(person("unsubscribed", "sub_1"));
    linkedEvent("paid_member");
    await noteAcquisitionPaid({
      email: "coach@example.com",
      clerkUserId: null,
      subscriptionId: "sub_1",
      eventId: "evt_paid_retry",
      campaignId: "camp_direct",
    });
    expect(people[0]?.lifecycle_state).toBe("unsubscribed");
    expect(blocks[0]?.reason).toBe("paid_member");
    expect(events).toHaveLength(1);
  });
});
