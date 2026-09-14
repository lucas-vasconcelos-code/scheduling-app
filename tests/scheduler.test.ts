import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  categoryDefaults,
  settingsSchema,
  type CalendarEvent,
  type SchedulingInput,
  type ScheduleRequest,
} from "@aligned/shared";
import {
  findCandidates,
  valid,
  planStudy,
  habitStrength,
  learnHabits,
  alignment,
  meetingAlerts,
} from "@aligned/scheduler";
const now = "2026-06-08T07:00:00-04:00";
const time = (hour: number, minute = 0) =>
  DateTime.fromISO(now).set({ hour, minute }).toISO()!;
function input(): SchedulingInput {
  return {
    userId: "u",
    now,
    events: [],
    categories: categoryDefaults("u"),
    settings: settingsSchema.parse({
      timeZone: "America/New_York",
      bufferMinutes: 0,
    }),
    preferences: [],
    habits: [],
    relationships: [],
  };
}
function event(
  id: string,
  start: number,
  end: number,
  flexibility: CalendarEvent["flexibility"] = "fixed",
  activity = "class",
  categoryId = "classes",
  interruptible = false,
): CalendarEvent {
  return {
    id,
    userId: "u",
    title: id,
    start: time(start),
    end: time(end),
    timeZone: "America/New_York",
    categoryId,
    activity,
    flexibility,
    priority: "medium",
    interruptible,
    allDay: false,
    transparent: false,
    importReviewed: true,
    revision: 0,
  };
}
const request = (
  overrides: Partial<ScheduleRequest> = {},
): ScheduleRequest => ({
  title: "Study",
  activity: "study",
  duration: 60,
  windowStart: time(9),
  windowEnd: time(18),
  categoryId: "deep-work",
  priority: "high",
  ...overrides,
});
describe("hard scheduling constraints", () => {
  it("fits directly into empty space and returns three deterministic candidates", () => {
    const s = input(),
      r = request();
    const a = findCandidates(s, r);
    expect(a).toHaveLength(3);
    expect(a).toEqual(findCandidates(s, r));
    expect(valid(s, r, a[0].start, a[0].end)).toBe(true);
  });
  it("does not collide with a fixed class", () => {
    const s = input();
    s.events = [event("class", 9, 12)];
    const c = findCandidates(s, request({ windowEnd: time(12) }), true);
    expect(c).toEqual([]);
  });
  it("moves one flexible block to create space only in a proposal candidate", () => {
    const s = input();
    s.events = [event("work", 9, 11, "flexible", "study", "deep-work")];
    const candidates = findCandidates(
      s,
      request({ duration: 90, windowEnd: time(11) }),
      true,
    );
    expect(candidates[0].moves).toHaveLength(1);
    expect(s.events[0].start).toBe(time(9));
  });
  it("never proposes moving protected or unreviewed events", () => {
    for (const flag of ["protected", "unreviewed"]) {
      const s = input();
      const e = event(
        "faith",
        9,
        12,
        flag === "protected" ? "protected" : "flexible",
      );
      if (flag === "unreviewed") e.importReviewed = false;
      s.events = [e];
      expect(findCandidates(s, request({ windowEnd: time(12) }), true)).toEqual(
        [],
      );
    }
  });
  it("does not move a more important event for a low-priority request", () => {
    const s = input();
    s.events = [{ ...event("work", 9, 12, "flexible"), priority: "critical" }];
    expect(
      findCandidates(
        s,
        request({ windowEnd: time(12), priority: "low" }),
        true,
      ),
    ).toEqual([]);
  });
  it("applies a hard late-night study rule", () => {
    const s = input();
    s.preferences = [
      {
        id: "p",
        userId: "u",
        statement: "Never study after 9",
        source: "explicit",
        enabled: true,
        hard: true,
        kind: "avoid",
        activity: "study",
        weekdays: [],
        start: "21:00",
        end: "07:00",
        confidence: 1,
      },
    ];
    expect(
      findCandidates(
        s,
        request({ windowStart: time(21), windowEnd: time(23) }),
      ),
    ).toEqual([]);
  });
  it("buffers prevent false availability", () => {
    const s = input();
    s.settings.bufferMinutes = 15;
    s.events = [event("class", 9, 10), event("meeting", 11, 12)];
    expect(
      findCandidates(
        s,
        request({ windowStart: time(10), windowEnd: time(11) }),
      ),
    ).toEqual([]);
  });
  it("rejects past requests and invalid ranges", () => {
    expect(
      findCandidates(
        input(),
        request({ windowStart: time(5), windowEnd: time(6) }),
      ),
    ).toEqual([]);
    expect(valid(input(), request(), "bad", "bad")).toBe(false);
  });
  it("all-day busy events occupy the full day", () => {
    const s = input();
    s.events = [
      {
        ...event("trip", 0, 23),
        allDay: true,
        end: DateTime.fromISO(time(0)).plus({ days: 1 }).toISO()!,
      },
    ];
    expect(findCandidates(s, request(), true)).toEqual([]);
  });
  it("transparent calendar events do not block availability", () => {
    const s = input();
    s.events = [{ ...event("note", 9, 18), transparent: true }];
    expect(findCandidates(s, request()).length).toBeGreaterThan(0);
  });
  it("handles daylight-saving transitions as actual elapsed instants", () => {
    const s = input();
    s.now = "2026-03-08T00:00:00-05:00";
    s.settings.wake = "00:00";
    s.settings.sleep = "06:00";
    const r = request({
      windowStart: s.now,
      windowEnd: "2026-03-08T06:00:00-04:00",
      duration: 90,
    });
    for (const c of findCandidates(s, r)) {
      expect(Date.parse(c.end) - Date.parse(c.start)).toBe(90 * 60000);
      expect(
        DateTime.fromISO(c.start).setZone(s.settings.timeZone).isValid,
      ).toBe(true);
    }
  });
});
describe("ranking and learning", () => {
  it("high energy improves focus ranking", () => {
    const s = input(),
      a = findCandidates(s, request({ exactStart: time(9) }))[0],
      b = findCandidates(s, request({ exactStart: time(14) }))[0];
    expect(a.score).toBeGreaterThan(b.score);
  });
  it("an established gym-at-four habit improves ranking", () => {
    const s = input();
    s.habits = [
      {
        id: "h",
        userId: "u",
        activity: "gym",
        weekday: 1,
        minute: 960,
        duration: 60,
        count: 8,
        strength: 1,
        lastSeen: now,
        source: "calendar",
      },
    ];
    const a = findCandidates(
        s,
        request({
          activity: "gym",
          categoryId: "health",
          exactStart: time(16),
        }),
      )[0],
      b = findCandidates(
        s,
        request({
          activity: "gym",
          categoryId: "health",
          exactStart: time(13),
        }),
      )[0];
    expect(a.score).toBeGreaterThan(b.score);
    expect(
      habitStrength(
        [{ ...s.habits[0], count: 2 }],
        "gym",
        time(16),
        s.settings.timeZone,
        now,
      ),
    ).toBe(0);
  });
  it("rewards workout to dinner chaining", () => {
    const s = input();
    s.events = [event("Dinner", 17, 18, "flexible", "dinner", "health", true)];
    s.relationships = [
      {
        id: "r",
        userId: "u",
        from: "gym",
        to: "dinner",
        relation: "within_minutes_after",
        minutes: 60,
        mandatory: false,
      },
    ];
    const a = findCandidates(
        s,
        request({
          activity: "gym",
          categoryId: "health",
          exactStart: time(16),
        }),
      )[0],
      b = findCandidates(
        s,
        request({
          activity: "gym",
          categoryId: "health",
          exactStart: time(13),
        }),
      )[0];
    expect(a.score).toBeGreaterThan(b.score);
  });
  it("learns only past deduplicated occurrences", () => {
    const s = input();
    for (let weeks = 1; weeks <= 4; weeks++) {
      const e = event(
        "gym-" + weeks,
        16,
        17,
        "flexible",
        "gym",
        "health",
        true,
      );
      e.start = DateTime.fromISO(e.start).minus({ weeks }).toISO()!;
      e.end = DateTime.fromISO(e.end).minus({ weeks }).toISO()!;
      s.events.push(e, e);
    }
    s.events.push(event("future", 16, 17));
    expect(learnHabits(s)[0].count).toBe(4);
  });
  it("alignment responds to energy and has no invented score for empty days", () => {
    const s = input();
    expect(alignment(s, time(7), time(23)).score).toBeNull();
    s.events = [event("study", 9, 10, "flexible", "study", "deep-work")];
    const good = alignment(s, time(7), time(23));
    s.events = [event("study", 14, 15, "flexible", "study", "deep-work")];
    expect(good.score!).toBeGreaterThan(alignment(s, time(7), time(23)).score!);
  });
});
describe("deadline planning", () => {
  it("splits four hours over sessions before the deadline", () => {
    const s = input();
    s.settings.focusMinutes = 60;
    s.settings.maxFocusMinutes = 90;
    const deadline = DateTime.fromISO(now).plus({ days: 3 }).toISO()!,
      p = planStudy(
        s,
        request({ duration: 240, windowEnd: deadline, deadline }),
      );
    expect(p.shortfallMinutes).toBe(0);
    expect(p.slots).toHaveLength(4);
    for (const slot of p.slots)
      expect(Date.parse(slot.end)).toBeLessThanOrEqual(Date.parse(deadline));
    expect(
      new Set(
        p.slots.map((c) =>
          DateTime.fromISO(c.start).setZone(s.settings.timeZone).toISODate(),
        ),
      ).size,
    ).toBeGreaterThan(1);
  });
  it("reports insufficient capacity instead of scheduling late", () => {
    const s = input(),
      p = planStudy(
        s,
        request({ duration: 240, windowEnd: time(10), deadline: time(10) }),
      );
    expect(p.shortfallMinutes).toBe(180);
    expect(
      p.slots.every((v) => Date.parse(v.end) <= Date.parse(time(10))),
    ).toBe(true);
  });
});
describe("meeting alerts", () => {
  it("is quiet during class", () => {
    const s = input();
    s.events = [
      event("class", 9, 10),
      event("meeting", 10, 11, "fixed", "meeting", "meetings"),
    ];
    expect(meetingAlerts(s)[0].prominent).toBe(false);
  });
  it("is prominent during interruptible gym and when free", () => {
    for (const occupied of [true, false]) {
      const s = input();
      s.events = [event("meeting", 10, 11, "fixed", "meeting", "meetings")];
      if (occupied)
        s.events.push(event("gym", 9, 10, "flexible", "gym", "health", true));
      expect(meetingAlerts(s)[0].prominent).toBe(true);
    }
  });
  it("respects quiet-time rules even on an empty calendar", () => {
    const s = input();
    s.events = [event("meeting", 10, 11, "fixed", "meeting", "meetings")];
    s.preferences = [
      {
        id: "quiet",
        userId: "u",
        statement: "Quiet mornings",
        source: "explicit",
        kind: "non-interruptible",
        enabled: true,
        hard: true,
        activity: "*",
        weekdays: [],
        start: "07:00",
        end: "12:00",
        confidence: 1,
      },
    ];
    expect(meetingAlerts(s)[0].prominent).toBe(false);
  });
});

it("penalizes a run beyond the editable back-to-back limit", () => {
  const s = input();
  s.settings.maxBackToBack = 2;
  s.events = [event("one", 9, 10), event("two", 10, 11)];
  const a = findCandidates(
    s,
    request({
      exactStart: time(11),
      windowStart: time(11),
      windowEnd: time(12),
    }),
  )[0];
  expect(
    a.contributions.find((c) => c.key === "backToBack")?.value,
  ).toBeLessThan(0);
});

it("uses the most restrictive explicit activity rule for meeting alerts", () => {
  const s = input();
  s.events = [
    event("gym", 9, 10, "flexible", "gym", "health", true),
    event("meeting", 10, 11, "fixed", "meeting", "meetings"),
  ];
  s.preferences = [
    {
      id: "quiet",
      userId: "u",
      statement: "Quiet in the gym",
      source: "explicit",
      enabled: true,
      hard: true,
      kind: "non-interruptible",
      activity: "gym",
      weekdays: [],
      start: "00:00",
      end: "23:59",
      confidence: 1,
    },
  ];
  expect(meetingAlerts(s)[0].prominent).toBe(false);
});
