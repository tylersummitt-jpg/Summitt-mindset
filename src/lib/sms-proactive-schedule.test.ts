import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SmsWeeklySchedule } from "@/lib/sms-account-schedule";
import {
  resolveProactiveSchedule,
  type ProactiveSchedulePreferenceRow,
  type ProactiveTtoOwner,
  type ResolveProactiveScheduleInput,
  type ScheduledProactiveText,
} from "@/lib/sms-proactive-schedule";

const OFF: SmsWeeklySchedule = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

function week(minute: number | null): SmsWeeklySchedule {
  return {
    monday: minute,
    tuesday: minute,
    wednesday: minute,
    thursday: minute,
    friday: minute,
    saturday: minute,
    sunday: minute,
  };
}

function row(
  partial: Partial<ProactiveSchedulePreferenceRow> = {}
): ProactiveSchedulePreferenceRow {
  return {
    weekly_schedule: null,
    schedule_timezone: null,
    pause_indefinite: false,
    pause_until: null,
    cadence_override: null,
    weekend_send_policy: null,
    ...partial,
  };
}

function base(overrides: Partial<ResolveProactiveScheduleInput> = {}): ResolveProactiveScheduleInput {
  return {
    preferenceRead: { ok: true, row: null },
    clerkTimezone: "America/New_York",
    audienceTimezone: null,
    audienceUnreadable: false,
    memberLocalDate: "2026-01-14",
    proactiveDeliveryAllowed: true,
    ...overrides,
  };
}

function scheduled(input: ResolveProactiveScheduleInput): ScheduledProactiveText {
  const result = resolveProactiveSchedule(input);
  expect(result.kind).toBe("scheduled");
  if (result.kind !== "scheduled") throw new Error("expected a scheduled result");
  return result;
}

/** Counts Intl formatToParts calls. Not a timer and not production instrumentation. */
function countFormatToParts(run: () => void): number {
  const Original = Intl.DateTimeFormat;
  let formatToParts = 0;
  function Counting(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ): Intl.DateTimeFormat {
    const fmt = new Original(locales, options);
    const orig = fmt.formatToParts.bind(fmt);
    fmt.formatToParts = ((...args: Parameters<Intl.DateTimeFormat["formatToParts"]>) => {
      formatToParts += 1;
      return orig(...args);
    }) as Intl.DateTimeFormat["formatToParts"];
    return fmt;
  }
  const counted = Counting as unknown as typeof Intl.DateTimeFormat;
  Object.defineProperty(counted, "prototype", { value: Original.prototype });
  counted.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
  const intlHost = Intl as unknown as { DateTimeFormat: typeof Intl.DateTimeFormat };
  intlHost.DateTimeFormat = counted;
  try {
    run();
  } finally {
    intlHost.DateTimeFormat = Original;
  }
  return formatToParts;
}

describe("proactive schedule resolver", () => {
  describe("default and explicit schedules", () => {
    it("schedules 7:00 AM when a successful read has no preference row", () => {
      expect(scheduled(base())).toMatchObject({
        memberLocalDate: "2026-01-14",
        selectedLocalMinute: 420,
        effectiveLocalMinute: 420,
        timeZone: "America/New_York",
        timeZoneSource: "clerk",
        utcInstant: "2026-01-14T12:00:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 420,
        owner: "morning",
        batchDate: "2026-01-14",
      });
    });

    it("schedules the same default when the row has no explicit weekly schedule", () => {
      const result = scheduled(
        base({ preferenceRead: { ok: true, row: row({ weekly_schedule: null }) } })
      );
      expect(result.selectedLocalMinute).toBe(420);
      expect(result.utcInstant).toBe("2026-01-14T12:00:00.000Z");
    });

    it("does not treat a stored preferred hour as the Account schedule", () => {
      const stored = {
        ...row({ weekly_schedule: null, schedule_timezone: "America/New_York" }),
        preferred_local_hour: 20,
        preferred_send_window: "evening",
      };
      const result = scheduled(base({ preferenceRead: { ok: true, row: stored } }));
      expect(result.selectedLocalMinute).toBe(420);
      expect(result.effectiveLocalMinute).toBe(420);
      expect(result.utcInstant).toBe("2026-01-14T12:00:00.000Z");
    });

    it("uses each enabled day's own minute, including a non-quarter-hour minute", () => {
      const schedule: SmsWeeklySchedule = { ...week(480), wednesday: 427 };
      const result = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ weekly_schedule: schedule, schedule_timezone: "America/New_York" }),
          },
        })
      );
      expect(result.selectedLocalMinute).toBe(427);
      expect(result.utcInstant).toBe("2026-01-14T12:07:00.000Z");
      expect(result.timeZoneSource).toBe("schedule");
    });

    it("returns no delivery for one disabled weekday and keeps the other days", () => {
      const schedule: SmsWeeklySchedule = { ...week(420), wednesday: null };
      const wednesday = resolveProactiveSchedule(
        base({
          preferenceRead: { ok: true, row: row({ weekly_schedule: schedule }) },
        })
      );
      const thursday = scheduled(
        base({
          memberLocalDate: "2026-01-15",
          preferenceRead: { ok: true, row: row({ weekly_schedule: schedule }) },
        })
      );
      expect(wednesday).toEqual({
        kind: "unscheduled",
        reason: "weekday_disabled",
        memberLocalDate: "2026-01-14",
      });
      expect(thursday.selectedLocalMinute).toBe(420);
      expect(thursday.memberLocalDate).toBe("2026-01-15");
    });

    it("returns no delivery when all seven weekdays are off", () => {
      expect(
        resolveProactiveSchedule(
          base({ preferenceRead: { ok: true, row: row({ weekly_schedule: OFF }) } })
        )
      ).toEqual({
        kind: "unscheduled",
        reason: "weekday_disabled",
        memberLocalDate: "2026-01-14",
      });
    });

    it("does not replace an invalid stored schedule with the default", () => {
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: {
              ok: true,
              row: row({ weekly_schedule: { monday: 420 } }),
            },
          })
        )
      ).toMatchObject({ kind: "unresolved", reason: "schedule_invalid" });
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: {
              ok: true,
              row: row({ weekly_schedule: { ...week(420), monday: 1440 } }),
            },
          })
        )
      ).toMatchObject({ kind: "unresolved", reason: "schedule_invalid" });
    });

    it("does not schedule when the preference read failed", () => {
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: { ok: false },
            proactiveDeliveryAllowed: false,
          })
        )
      ).toEqual({
        kind: "unresolved",
        reason: "preference_read_failed",
        memberLocalDate: "2026-01-14",
      });
    });
  });

  describe("time zone resolution", () => {
    it("prefers a valid explicit Account zone over Clerk and audience", () => {
      const result = scheduled(
        base({
          clerkTimezone: "America/New_York",
          audienceTimezone: "America/Denver",
          preferenceRead: {
            ok: true,
            row: row({ schedule_timezone: "America/Chicago" }),
          },
        })
      );
      expect(result.timeZone).toBe("America/Chicago");
      expect(result.timeZoneSource).toBe("schedule");
      expect(result.utcInstant).toBe("2026-01-14T13:00:00.000Z");
    });

    it("uses a valid Clerk zone when no explicit schedule zone is stored", () => {
      const result = scheduled(
        base({
          clerkTimezone: "America/Chicago",
          audienceTimezone: "America/Denver",
        })
      );
      expect(result.timeZoneSource).toBe("clerk");
      expect(result.utcInstant).toBe("2026-01-14T13:00:00.000Z");
    });

    it("uses a valid audience zone when Clerk is missing or invalid", () => {
      const result = scheduled(
        base({
          clerkTimezone: "not-a-zone",
          audienceTimezone: "America/Denver",
          preferenceRead: { ok: true, row: row() },
        })
      );
      expect(result.timeZone).toBe("America/Denver");
      expect(result.timeZoneSource).toBe("audience");
      expect(result.utcInstant).toBe("2026-01-14T14:00:00.000Z");
    });

    it("falls back to Eastern when no valid preference zone was stored", () => {
      const result = scheduled(
        base({
          clerkTimezone: "",
          audienceTimezone: "",
          audienceUnreadable: false,
          preferenceRead: { ok: true, row: row() },
        })
      );
      expect(result.timeZone).toBe("America/New_York");
      expect(result.timeZoneSource).toBe("default");
      expect(result.utcInstant).toBe("2026-01-14T12:00:00.000Z");
    });

    it("does not invent Eastern when the audience zone could not be read", () => {
      expect(
        resolveProactiveSchedule(
          base({
            clerkTimezone: "",
            audienceTimezone: "America/Chicago",
            audienceUnreadable: true,
            preferenceRead: { ok: true, row: row() },
          })
        )
      ).toEqual({
        kind: "unresolved",
        reason: "timezone_unknown",
        memberLocalDate: "2026-01-14",
      });
    });

    it("does not fall through an invalid explicit zone", () => {
      expect(
        resolveProactiveSchedule(
          base({
            clerkTimezone: "America/Chicago",
            preferenceRead: {
              ok: true,
              row: row({ schedule_timezone: "Not/A_Zone" }),
            },
          })
        )
      ).toMatchObject({ kind: "unresolved", reason: "timezone_invalid" });
    });

    it("keeps a valid nonstandard IANA zone", () => {
      const result = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ schedule_timezone: "Europe/London" }),
          },
        })
      );
      expect(result.timeZone).toBe("Europe/London");
      expect(result.utcInstant).toBe("2026-01-14T07:00:00.000Z");
      expect(result.easternDate).toBe("2026-01-14");
      expect(result.easternMinute).toBe(120);
      expect(result.owner).toBe("morning");
      expect(result.batchDate).toBe("2026-01-14");
    });

    it("keeps valid fractional-offset IANA zones", () => {
      const kolkata = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ schedule_timezone: "Asia/Kolkata" }),
          },
        })
      );
      expect(kolkata.utcInstant).toBe("2026-01-14T01:30:00.000Z");
      expect(kolkata.easternDate).toBe("2026-01-13");
      expect(kolkata.easternMinute).toBe(20 * 60 + 30);
      expect(kolkata.owner).toBe("evening");
      expect(kolkata.batchDate).toBe("2026-01-13");

      const kathmandu = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ schedule_timezone: "Asia/Kathmandu" }),
          },
        })
      );
      expect(kathmandu.utcInstant).toBe("2026-01-14T01:15:00.000Z");
      expect(kathmandu.easternDate).toBe("2026-01-13");
      expect(kathmandu.easternMinute).toBe(20 * 60 + 15);
      expect(kathmandu.owner).toBe("evening");
      expect(kathmandu.batchDate).toBe("2026-01-13");
    });
  });

  describe("United States zones at 7:00 AM local", () => {
    it.each([
      ["America/New_York", "2026-01-14", "2026-01-14T12:00:00.000Z", "2026-01-14", 7 * 60, "morning", "2026-01-14"],
      ["America/Chicago", "2026-01-14", "2026-01-14T13:00:00.000Z", "2026-01-14", 8 * 60, "morning", "2026-01-14"],
      ["America/Denver", "2026-01-14", "2026-01-14T14:00:00.000Z", "2026-01-14", 9 * 60, "morning", "2026-01-14"],
      ["America/Los_Angeles", "2026-01-14", "2026-01-14T15:00:00.000Z", "2026-01-14", 10 * 60, "evening", "2026-01-14"],
      ["America/Anchorage", "2026-01-14", "2026-01-14T16:00:00.000Z", "2026-01-14", 11 * 60, "evening", "2026-01-14"],
      ["Pacific/Honolulu", "2026-01-14", "2026-01-14T17:00:00.000Z", "2026-01-14", 12 * 60, "evening", "2026-01-14"],
      ["America/Phoenix", "2026-01-14", "2026-01-14T14:00:00.000Z", "2026-01-14", 9 * 60, "morning", "2026-01-14"],
      ["America/New_York", "2026-07-15", "2026-07-15T11:00:00.000Z", "2026-07-15", 7 * 60, "morning", "2026-07-15"],
      ["America/Chicago", "2026-07-15", "2026-07-15T12:00:00.000Z", "2026-07-15", 8 * 60, "morning", "2026-07-15"],
      ["America/Denver", "2026-07-15", "2026-07-15T13:00:00.000Z", "2026-07-15", 9 * 60, "morning", "2026-07-15"],
      ["America/Los_Angeles", "2026-07-15", "2026-07-15T14:00:00.000Z", "2026-07-15", 10 * 60, "evening", "2026-07-15"],
      ["America/Anchorage", "2026-07-15", "2026-07-15T15:00:00.000Z", "2026-07-15", 11 * 60, "evening", "2026-07-15"],
      ["Pacific/Honolulu", "2026-07-15", "2026-07-15T17:00:00.000Z", "2026-07-15", 13 * 60, "evening", "2026-07-15"],
      ["America/Phoenix", "2026-07-15", "2026-07-15T14:00:00.000Z", "2026-07-15", 10 * 60, "evening", "2026-07-15"],
    ] as const)(
      "%s on %s",
      (zone, memberLocalDate, utcInstant, easternDate, easternMinute, owner, batchDate) => {
        const result = scheduled(
          base({
            memberLocalDate,
            clerkTimezone: null,
            preferenceRead: {
              ok: true,
              row: row({ schedule_timezone: zone }),
            },
          })
        );
        expect(result.utcInstant).toBe(utcInstant);
        expect(result.easternDate).toBe(easternDate);
        expect(result.easternMinute).toBe(easternMinute);
        expect(result.owner).toBe(owner);
        expect(result.batchDate).toBe(batchDate);
        expect(result.selectedLocalMinute).toBe(420);
        expect(result.effectiveLocalMinute).toBe(420);
      }
    );
  });

  describe("Eastern ownership boundaries", () => {
    function atMinute(minute: number, memberLocalDate = "2026-01-14") {
      return scheduled(
        base({
          memberLocalDate,
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(minute),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
    }

    it("assigns 9:59 AM to that morning's Morning batch", () => {
      expect(atMinute(9 * 60 + 59)).toMatchObject({
        utcInstant: "2026-01-14T14:59:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 599,
        owner: "morning" satisfies ProactiveTtoOwner,
        batchDate: "2026-01-14",
      });
    });

    it("assigns 10:00 AM to that day's Evening batch", () => {
      expect(atMinute(10 * 60)).toMatchObject({
        utcInstant: "2026-01-14T15:00:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 600,
        owner: "evening",
        batchDate: "2026-01-14",
      });
    });

    it("assigns 8:59 PM to that day's Evening batch", () => {
      expect(atMinute(20 * 60 + 59)).toMatchObject({
        utcInstant: "2026-01-15T01:59:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 1259,
        owner: "evening",
        batchDate: "2026-01-14",
      });
    });

    it("assigns 9:00 PM to the next Eastern morning's Morning batch", () => {
      expect(atMinute(21 * 60)).toMatchObject({
        utcInstant: "2026-01-15T02:00:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 1260,
        owner: "morning",
        batchDate: "2026-01-15",
      });
    });

    it("accepts 11:59 PM, minute 1439, on the next Morning batch", () => {
      expect(atMinute(1439)).toMatchObject({
        selectedLocalMinute: 1439,
        effectiveLocalMinute: 1439,
        utcInstant: "2026-01-15T04:59:00.000Z",
        easternDate: "2026-01-14",
        easternMinute: 1439,
        owner: "morning",
        batchDate: "2026-01-15",
      });
    });

    it("assigns Eastern midnight to that morning's Morning batch", () => {
      expect(atMinute(0, "2026-01-15")).toMatchObject({
        memberLocalDate: "2026-01-15",
        selectedLocalMinute: 0,
        utcInstant: "2026-01-15T05:00:00.000Z",
        easternDate: "2026-01-15",
        easternMinute: 0,
        owner: "morning",
        batchDate: "2026-01-15",
      });
    });
  });

  describe("calendar dates", () => {
    it("keeps a member-local date that differs from the Eastern date", () => {
      const result = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(21 * 60),
              schedule_timezone: "America/Los_Angeles",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        memberLocalDate: "2026-01-14",
        selectedLocalMinute: 1260,
        utcInstant: "2026-01-15T05:00:00.000Z",
        easternDate: "2026-01-15",
        easternMinute: 0,
        owner: "morning",
        batchDate: "2026-01-15",
      });
    });

    it("puts Wednesday 11:45 PM and Thursday 7:00 AM on Thursday's Morning batch without merging the local dates", () => {
      const schedule: SmsWeeklySchedule = { ...OFF, wednesday: 23 * 60 + 45, thursday: 420 };
      const prefs = {
        ok: true as const,
        row: row({ weekly_schedule: schedule, schedule_timezone: "America/New_York" }),
      };
      const wednesday = scheduled(base({ preferenceRead: prefs }));
      const thursday = scheduled(
        base({ memberLocalDate: "2026-01-15", preferenceRead: prefs })
      );
      expect(wednesday).toMatchObject({
        memberLocalDate: "2026-01-14",
        selectedLocalMinute: 1425,
        utcInstant: "2026-01-15T04:45:00.000Z",
        easternDate: "2026-01-14",
        owner: "morning",
        batchDate: "2026-01-15",
      });
      expect(thursday).toMatchObject({
        memberLocalDate: "2026-01-15",
        selectedLocalMinute: 420,
        utcInstant: "2026-01-15T12:00:00.000Z",
        easternDate: "2026-01-15",
        owner: "morning",
        batchDate: "2026-01-15",
      });
      expect(wednesday.utcInstant).not.toBe(thursday.utcInstant);
    });

    it("crosses a month boundary on the Morning batch date", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-01-31",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(23 * 60 + 45),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        memberLocalDate: "2026-01-31",
        utcInstant: "2026-02-01T04:45:00.000Z",
        easternDate: "2026-01-31",
        owner: "morning",
        batchDate: "2026-02-01",
      });
    });

    it("crosses a year boundary on the Morning batch date", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2025-12-31",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(21 * 60),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        memberLocalDate: "2025-12-31",
        utcInstant: "2026-01-01T02:00:00.000Z",
        easternDate: "2025-12-31",
        easternMinute: 1260,
        owner: "morning",
        batchDate: "2026-01-01",
      });
    });

    it("accepts a real leap day and rejects a non-leap February 29", () => {
      const leap = scheduled(
        base({
          memberLocalDate: "2024-02-29",
          preferenceRead: { ok: true, row: null },
        })
      );
      expect(leap).toMatchObject({
        memberLocalDate: "2024-02-29",
        utcInstant: "2024-02-29T12:00:00.000Z",
        easternDate: "2024-02-29",
        owner: "morning",
        batchDate: "2024-02-29",
      });
      for (const memberLocalDate of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-14", ""]) {
        expect(resolveProactiveSchedule(base({ memberLocalDate }))).toEqual({
          kind: "unresolved",
          reason: "date_invalid",
          memberLocalDate: null,
        });
      }
    });

    it("returns an already-past eligible instant instead of moving it to another day", () => {
      expect(scheduled(base()).utcInstant).toBe("2026-01-14T12:00:00.000Z");
      expect(scheduled(base()).memberLocalDate).toBe("2026-01-14");
    });
  });

  describe("daylight saving", () => {
    it("moves a missing spring-forward minute to the next valid minute and keeps the selected minute", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-03-08",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(2 * 60 + 30),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        selectedLocalMinute: 150,
        effectiveLocalMinute: 180,
        utcInstant: "2026-03-08T07:00:00.000Z",
        easternDate: "2026-03-08",
        easternMinute: 180,
        owner: "morning",
        batchDate: "2026-03-08",
        memberLocalDate: "2026-03-08",
      });
    });

    it("does not move a local time that exists on the spring-forward date", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-03-08",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(3 * 60),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result.selectedLocalMinute).toBe(180);
      expect(result.effectiveLocalMinute).toBe(180);
      expect(result.utcInstant).toBe("2026-03-08T07:00:00.000Z");
    });

    it("uses the earlier UTC occurrence when a local time happens twice", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-11-01",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(1 * 60 + 30),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        selectedLocalMinute: 90,
        effectiveLocalMinute: 90,
        utcInstant: "2026-11-01T05:30:00.000Z",
        easternDate: "2026-11-01",
        easternMinute: 90,
        owner: "morning",
        batchDate: "2026-11-01",
      });
    });

    it("does not adjust Hawaii or Arizona across the Eastern clock changes", () => {
      const hawaiiSpring = scheduled(
        base({
          memberLocalDate: "2026-03-08",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(2 * 60 + 30),
              schedule_timezone: "Pacific/Honolulu",
            }),
          },
        })
      );
      expect(hawaiiSpring.selectedLocalMinute).toBe(150);
      expect(hawaiiSpring.effectiveLocalMinute).toBe(150);
      expect(hawaiiSpring.utcInstant).toBe("2026-03-08T12:30:00.000Z");

      const hawaiiFall = scheduled(
        base({
          memberLocalDate: "2026-11-01",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(1 * 60 + 30),
              schedule_timezone: "Pacific/Honolulu",
            }),
          },
        })
      );
      expect(hawaiiFall.effectiveLocalMinute).toBe(90);
      expect(hawaiiFall.utcInstant).toBe("2026-11-01T11:30:00.000Z");

      const arizonaSpring = scheduled(
        base({
          memberLocalDate: "2026-03-08",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(2 * 60 + 30),
              schedule_timezone: "America/Phoenix",
            }),
          },
        })
      );
      expect(arizonaSpring.effectiveLocalMinute).toBe(150);
      expect(arizonaSpring.utcInstant).toBe("2026-03-08T09:30:00.000Z");

      const arizonaFall = scheduled(
        base({
          memberLocalDate: "2026-11-01",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(1 * 60 + 30),
              schedule_timezone: "America/Phoenix",
            }),
          },
        })
      );
      expect(arizonaFall.effectiveLocalMinute).toBe(90);
      expect(arizonaFall.utcInstant).toBe("2026-11-01T08:30:00.000Z");
    });
  });

  describe("ordinary fast path and unusual transitions", () => {
    it("resolves an ordinary 7:00 AM without the full minute scan", () => {
      let result: ScheduledProactiveText | undefined;
      const formatToParts = countFormatToParts(() => {
        result = scheduled(base());
      });
      expect(result).toMatchObject({
        utcInstant: "2026-01-14T12:00:00.000Z",
        selectedLocalMinute: 420,
        effectiveLocalMinute: 420,
        owner: "morning",
        batchDate: "2026-01-14",
      });
      expect(formatToParts).toBeGreaterThan(5);
      expect(formatToParts).toBeLessThan(80);
    });

    it("resolves an ordinary fractional-offset delivery without the full minute scan", () => {
      let result: ScheduledProactiveText | undefined;
      const formatToParts = countFormatToParts(() => {
        result = scheduled(
          base({
            preferenceRead: {
              ok: true,
              row: row({ schedule_timezone: "Asia/Kolkata" }),
            },
          })
        );
      });
      expect(result).toMatchObject({
        utcInstant: "2026-01-14T01:30:00.000Z",
        easternDate: "2026-01-13",
        easternMinute: 20 * 60 + 30,
        owner: "evening",
        batchDate: "2026-01-13",
      });
      expect(formatToParts).toBeGreaterThan(5);
      expect(formatToParts).toBeLessThan(80);
    });

    it("moves a Lord Howe spring-forward gap to 2:30 and owns that adjusted instant", () => {
      let result: ScheduledProactiveText | undefined;
      const formatToParts = countFormatToParts(() => {
        result = scheduled(
          base({
            memberLocalDate: "2026-10-04",
            preferenceRead: {
              ok: true,
              row: row({
                weekly_schedule: week(2 * 60 + 15),
                schedule_timezone: "Australia/Lord_Howe",
              }),
            },
          })
        );
      });
      expect(result).toMatchObject({
        memberLocalDate: "2026-10-04",
        selectedLocalMinute: 135,
        effectiveLocalMinute: 150,
        utcInstant: "2026-10-03T15:30:00.000Z",
        easternDate: "2026-10-03",
        easternMinute: 11 * 60 + 30,
        owner: "evening",
        batchDate: "2026-10-03",
      });
      expect(formatToParts).toBeGreaterThan(3000);
    });

    it("uses the earlier Lord Howe fall-back occurrence", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-04-05",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(1 * 60 + 30),
              schedule_timezone: "Australia/Lord_Howe",
            }),
          },
        })
      );
      expect(result).toMatchObject({
        memberLocalDate: "2026-04-05",
        selectedLocalMinute: 90,
        effectiveLocalMinute: 90,
        utcInstant: "2026-04-04T14:30:00.000Z",
        easternDate: "2026-04-04",
        easternMinute: 10 * 60 + 30,
        owner: "evening",
        batchDate: "2026-04-04",
      });
    });

    it("returns no delivery when the local calendar date does not exist", () => {
      expect(
        resolveProactiveSchedule(
          base({
            memberLocalDate: "2011-12-30",
            preferenceRead: {
              ok: true,
              row: row({
                weekly_schedule: week(420),
                schedule_timezone: "Pacific/Apia",
              }),
            },
          })
        )
      ).toEqual({
        kind: "unscheduled",
        reason: "no_valid_local_instant",
        memberLocalDate: "2011-12-30",
      });
    });

    it("assigns Eastern ownership from the spring-forward adjusted instant", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-03-08",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: week(2 * 60 + 30),
              schedule_timezone: "America/New_York",
            }),
          },
        })
      );
      expect(result.selectedLocalMinute).toBe(150);
      expect(result.effectiveLocalMinute).toBe(180);
      expect(result.utcInstant).toBe("2026-03-08T07:00:00.000Z");
      expect(result.easternMinute).toBe(180);
      expect(result.owner).toBe("morning");
      expect(result.batchDate).toBe("2026-03-08");
    });
  });

  describe("pause, consent, and legacy restrictions", () => {
    it("returns no delivery for an indefinite pause", () => {
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: { ok: true, row: row({ pause_indefinite: true }) },
          })
        )
      ).toEqual({
        kind: "unscheduled",
        reason: "pause_indefinite",
        memberLocalDate: "2026-01-14",
      });
    });

    it("suppresses a delivery the timed pause still covers and allows one after the pause expires", () => {
      const paused = resolveProactiveSchedule(
        base({
          preferenceRead: {
            ok: true,
            row: row({ pause_until: "2026-01-14T13:00:00.000Z" }),
          },
        })
      );
      const expired = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ pause_until: "2026-01-14T11:00:00.000Z" }),
          },
        })
      );
      const expiresAtDelivery = scheduled(
        base({
          preferenceRead: {
            ok: true,
            row: row({ pause_until: "2026-01-14T12:00:00.000Z" }),
          },
        })
      );
      expect(paused).toEqual({
        kind: "unscheduled",
        reason: "pause_until",
        memberLocalDate: "2026-01-14",
      });
      expect(expired.utcInstant).toBe("2026-01-14T12:00:00.000Z");
      expect(expiresAtDelivery.utcInstant).toBe("2026-01-14T12:00:00.000Z");
    });

    it("evaluates a timed pause at the daylight-saving-adjusted instant", () => {
      const input = {
        memberLocalDate: "2026-03-08",
        preferenceRead: {
          ok: true as const,
          row: row({
            weekly_schedule: week(2 * 60 + 30),
            schedule_timezone: "America/New_York",
            pause_until: "2026-03-08T07:30:00.000Z",
          }),
        },
      };
      expect(resolveProactiveSchedule(base(input))).toEqual({
        kind: "unscheduled",
        reason: "pause_until",
        memberLocalDate: "2026-03-08",
      });
      expect(
        scheduled(
          base({
            ...input,
            preferenceRead: {
              ok: true,
              row: row({
                weekly_schedule: week(2 * 60 + 30),
                schedule_timezone: "America/New_York",
                pause_until: "2026-03-08T06:45:00.000Z",
              }),
            },
          })
        ).utcInstant
      ).toBe("2026-03-08T07:00:00.000Z");
    });

    it("returns no delivery when the caller says proactive delivery is not allowed", () => {
      expect(resolveProactiveSchedule(base({ proactiveDeliveryAllowed: false }))).toEqual({
        kind: "unscheduled",
        reason: "consent_ineligible",
        memberLocalDate: "2026-01-14",
      });
    });

    it("applies a legacy weekdays-only restriction only when there is no explicit schedule", () => {
      const legacy = row({ weekend_send_policy: "weekdays_only" });
      expect(
        resolveProactiveSchedule(base({ memberLocalDate: "2026-01-17", preferenceRead: { ok: true, row: legacy } }))
      ).toEqual({ kind: "unscheduled", reason: "weekend_policy", memberLocalDate: "2026-01-17" });
      expect(
        resolveProactiveSchedule(base({ memberLocalDate: "2026-01-18", preferenceRead: { ok: true, row: legacy } }))
      ).toEqual({ kind: "unscheduled", reason: "weekend_policy", memberLocalDate: "2026-01-18" });
      expect(
        scheduled(base({ memberLocalDate: "2026-01-14", preferenceRead: { ok: true, row: legacy } })).utcInstant
      ).toBe("2026-01-14T12:00:00.000Z");

      const explicitSunday = scheduled(
        base({
          memberLocalDate: "2026-01-18",
          preferenceRead: {
            ok: true,
            row: row({
              weekly_schedule: { ...OFF, sunday: 420 },
              weekend_send_policy: "weekdays_only",
              cadence_override: "every_other_day",
            }),
          },
          legacyCadenceEligible: false,
        })
      );
      expect(explicitSunday).toMatchObject({
        memberLocalDate: "2026-01-18",
        selectedLocalMinute: 420,
        utcInstant: "2026-01-18T12:00:00.000Z",
        owner: "morning",
      });
    });

    it("requires the caller to say whether a legacy every-other-day or every-third-day cadence is eligible", () => {
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: { ok: true, row: row({ cadence_override: "every_other_day" }) },
          })
        )
      ).toEqual({
        kind: "unresolved",
        reason: "cadence_eligibility_required",
        memberLocalDate: "2026-01-14",
      });
      expect(
        resolveProactiveSchedule(
          base({
            preferenceRead: { ok: true, row: row({ cadence_override: "every_3_days" }) },
            legacyCadenceEligible: false,
          })
        )
      ).toEqual({ kind: "unscheduled", reason: "cadence", memberLocalDate: "2026-01-14" });
      expect(
        scheduled(
          base({
            preferenceRead: { ok: true, row: row({ cadence_override: "every_other_day" }) },
            legacyCadenceEligible: true,
          })
        ).utcInstant
      ).toBe("2026-01-14T12:00:00.000Z");
      expect(
        scheduled(
          base({
            preferenceRead: { ok: true, row: row({ cadence_override: "daily" }) },
            legacyCadenceEligible: false,
          })
        ).selectedLocalMinute
      ).toBe(420);
    });

    it("lets an enabled Sunday schedule like any other weekday", () => {
      const result = scheduled(
        base({
          memberLocalDate: "2026-01-18",
          preferenceRead: {
            ok: true,
            row: row({ weekly_schedule: { ...OFF, sunday: 435 } }),
          },
        })
      );
      expect(result).toMatchObject({
        selectedLocalMinute: 435,
        utcInstant: "2026-01-18T12:15:00.000Z",
        owner: "morning",
        batchDate: "2026-01-18",
      });
      expect(
        resolveProactiveSchedule(
          base({
            memberLocalDate: "2026-01-18",
            preferenceRead: { ok: true, row: row({ weekly_schedule: OFF }) },
          })
        )
      ).toMatchObject({ kind: "unscheduled", reason: "weekday_disabled" });
    });
  });

  describe("determinism", () => {
    it("returns the same result for the same inputs and does not mutate them", () => {
      const preferenceRead = {
        ok: true as const,
        row: row({ weekly_schedule: week(420), schedule_timezone: "America/Chicago" }),
      };
      const input = base({ preferenceRead });
      const snapshot = JSON.stringify(input);
      const first = resolveProactiveSchedule(input);
      const second = resolveProactiveSchedule(input);
      expect(second).toEqual(first);
      expect(JSON.stringify(input)).toBe(snapshot);
      expect(first).toMatchObject({ utcInstant: "2026-01-14T13:00:00.000Z" });
    });

    it("does not read the clock, the machine zone, or a database", () => {
      const src = readFileSync(join(process.cwd(), "src/lib/sms-proactive-schedule.ts"), "utf8");
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/toLocaleString\s*\(/);
      expect(src).not.toMatch(/getTimezoneOffset\s*\(/);
      expect(src).not.toMatch(/\.getHours\s*\(/);
      expect(src).not.toMatch(/\.getMinutes\s*\(/);
      expect(src).not.toMatch(/supabase/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/process\.env/);
      expect(scheduled(base()).utcInstant).toBe("2026-01-14T12:00:00.000Z");
    });
  });
});
