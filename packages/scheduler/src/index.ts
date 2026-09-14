import { DateTime } from "luxon";
import {
  minutes,
  type SchedulingInput,
  type ScheduleRequest,
  type Candidate,
  type CalendarEvent,
  type Contribution,
  type Habit,
  type Alignment,
  type AlertPlan,
} from "@aligned/shared";

export const weights = {
  preference: 22,
  energy: 15,
  habit: 13,
  chain: 10,
  fragmentation: 8,
  transition: 7,
  deepWork: 5,
  movement: 14,
  shift: 8,
  urgency: 5,
  priority: 4,
  context: 5,
  workload: 8,
  backToBack: 8,
  routine: 5,
};
const ms = (s: string) => Date.parse(s);
const localDates = new Map<string, DateTime>();
function local(s: string, zone: string) {
  const key = zone + "|" + s;
  let d = localDates.get(key);
  if (!d) {
    d = DateTime.fromISO(s).setZone(zone);
    if (localDates.size > 50000) localDates.clear();
    localDates.set(key, d);
  }
  return d;
}
const iso = (n: number) => new Date(n).toISOString();
export const overlaps = (a: string, b: string, c: string, d: string) =>
  ms(a) < ms(d) && ms(c) < ms(b);
const minuteOf = (s: string, zone: string) => {
  const d = local(s, zone);
  return d.hour * 60 + d.minute;
};
const priorityValue = { low: 1, medium: 2, high: 3, critical: 4 };
const activeEvents = (input: SchedulingInput) =>
  input.events.filter((e) => !e.transparent);
function timeWindowContains(start: number, end: number, minute: number) {
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}
function ruleApplies(
  input: SchedulingInput,
  activity: string,
  start: string,
  end: string,
  kind?: string,
) {
  const s = local(start, input.settings.timeZone),
    e = DateTime.fromISO(end).setZone(input.settings.timeZone);
  return input.preferences
    .filter(
      (p) =>
        p.enabled &&
        (!kind || p.kind === kind) &&
        (p.activity === "*" || p.activity === activity) &&
        (!p.weekdays.length || p.weekdays.includes(s.weekday)),
    )
    .filter((p) => {
      if (p.kind === "avoid-before")
        return input.events.some(
          (v) =>
            v.activity === p.relatedActivity &&
            local(v.start, s.zoneName!).hasSame(s, "day") &&
            ms(end) <= ms(v.start),
        );
      const rs = minutes(p.start),
        re = minutes(p.end),
        sm = s.hour * 60 + s.minute,
        em = e.hasSame(s, "day") ? e.hour * 60 + e.minute : 1440;
      return rs <= re ? sm < re && em > rs : sm < re || em > rs;
    });
}
function chainValue(
  input: SchedulingInput,
  activity: string,
  start: string,
  end: string,
) {
  const values: { value: number; mandatory: boolean }[] = [];
  for (const r of input.relationships) {
    if (r.from !== activity && r.to !== activity) continue;
    const isFrom = r.from === activity,
      others = input.events.filter(
        (e) => e.activity === (isFrom ? r.to : r.from),
      );
    let best = 0;
    for (const e of others) {
      const from = {
          start: isFrom ? start : e.start,
          end: isFrom ? end : e.end,
        },
        to = { start: isFrom ? e.start : start, end: isFrom ? e.end : end };
      const after = (ms(to.start) - ms(from.end)) / 60000,
        before = (ms(from.start) - ms(to.end)) / 60000;
      const gap = r.relation.endsWith("before") ? before : after;
      let value = 0;
      if (r.relation === "same_block")
        value =
          Math.min(Math.abs(after), Math.abs(before)) <= r.minutes ? 1 : 0;
      else if (r.relation === "avoid_adjacent")
        value =
          Math.min(Math.abs(after), Math.abs(before)) >= r.minutes ? 1 : 0;
      else
        value =
          gap >= 0 &&
          gap <=
            Math.max(
              r.minutes,
              r.relation.startsWith("immediately")
                ? input.settings.bufferMinutes
                : 0,
            )
            ? 1
            : 0;
      best = Math.max(best, value);
    }
    values.push({ value: best, mandatory: r.mandatory });
  }
  return values;
}
export function valid(
  input: SchedulingInput,
  request: ScheduleRequest,
  start: string,
  end: string,
) {
  if (
    !Number.isFinite(ms(start)) ||
    !Number.isFinite(ms(end)) ||
    ms(end) <= ms(start) ||
    ms(start) < Math.max(ms(input.now), ms(request.windowStart)) ||
    ms(end) > ms(request.windowEnd) ||
    (request.deadline && ms(end) > ms(request.deadline))
  )
    return false;
  const s = local(start, input.settings.timeZone);
  const wake = minutes(input.settings.wake),
    sleep = minutes(input.settings.sleep);
  if (!request.allDay && !request.allowOutsideWaking) {
    let wakingStart = s
      .startOf("day")
      .set({ hour: Math.floor(wake / 60), minute: wake % 60 });
    if (wake >= sleep && s < wakingStart)
      wakingStart = wakingStart.minus({ days: 1 });
    const wakingEnd = wakingStart
      .plus({ days: wake >= sleep ? 1 : 0 })
      .set({ hour: Math.floor(sleep / 60), minute: sleep % 60 });
    if (s < wakingStart || ms(end) > wakingEnd.toMillis()) return false;
  }
  const buffer = input.settings.bufferMinutes * 60000;
  if (
    activeEvents(input).some(
      (v) => ms(start) < ms(v.end) + buffer && ms(end) + buffer > ms(v.start),
    )
  )
    return false;
  if (
    ruleApplies(input, request.activity, start, end).some(
      (p) => p.hard && (p.kind === "avoid" || p.kind === "avoid-before"),
    )
  )
    return false;
  if (
    chainValue(input, request.activity, start, end).some(
      (v) => v.mandatory && !v.value,
    )
  )
    return false;
  return true;
}
export function habitStrength(
  habits: Habit[],
  activity: string,
  start: string,
  zone: string,
  now: string,
) {
  const d = local(start, zone),
    minute = d.hour * 60 + d.minute;
  return Math.max(
    0,
    ...habits
      .filter(
        (h) =>
          h.activity === activity &&
          h.weekday === d.weekday &&
          (h.source === "explicit" || h.count >= 3),
      )
      .map((h) => {
        const raw = Math.abs(h.minute - minute),
          distance = Math.min(raw, 1440 - raw),
          recency =
            h.source === "explicit"
              ? 1
              : Math.exp(
                  -Math.max(0, (ms(now) - ms(h.lastSeen)) / 86400000) / 90,
                );
        return (
          Math.exp((-distance * distance) / (2 * 60 * 60)) *
          h.strength *
          recency
        );
      }),
  );
}
export function score(
  input: SchedulingInput,
  r: ScheduleRequest,
  start: string,
  end: string,
  moves: Candidate["moves"] = [],
): Candidate {
  const zone = input.settings.timeZone,
    s = local(start, zone),
    minute = minuteOf(start, zone),
    duration = (ms(end) - ms(start)) / 60000;
  const rules = ruleApplies(input, r.activity, start, end),
    category = input.categories.find((c) => c.id === r.categoryId);
  const high = timeWindowContains(
      minutes(input.settings.highEnergy[0]),
      minutes(input.settings.highEnergy[1]),
      minute,
    ),
    low = timeWindowContains(
      minutes(input.settings.lowEnergy[0]),
      minutes(input.settings.lowEnergy[1]),
      minute,
    );
  const dayKey = s.toISODate();
  const neighbors = activeEvents(input).filter(
    (e) => local(e.start, zone).toISODate() === dayKey,
  );
  const previous = neighbors
      .filter((e) => ms(e.end) <= ms(start))
      .sort((a, b) => ms(b.end) - ms(a.end))[0],
    next = neighbors
      .filter((e) => ms(e.start) >= ms(end))
      .sort((a, b) => ms(a.start) - ms(b.start))[0];
  const gaps = [
    previous ? (ms(start) - ms(previous.end)) / 60000 : 120,
    next ? (ms(next.start) - ms(end)) / 60000 : 120,
  ];
  const chains = chainValue(input, r.activity, start, end),
    habit = habitStrength(input.habits, r.activity, start, zone, input.now);
  const work =
    neighbors.reduce((n, e) => n + (ms(e.end) - ms(e.start)) / 60000, 0) +
    duration;
  const contributions: Contribution[] = [];
  const add = (key: keyof typeof weights, label: string, value: number) =>
    contributions.push({
      key,
      label:
        value < 0
          ? ((
              {
                preference: "Conflicts with a soft time preference",
                energy: "Focus falls in a low-energy window",
                chain: "Separates linked activities",
                fragmentation: "Leaves a short gap",
                deepWork: "Uses high-energy time for another activity",
                movement: "Moves existing commitments",
                shift: "Shifts events from their original times",
                priority: "Moves a higher-priority commitment",
                context: "Adds a context switch",
                workload: "Adds to a busy day",
                routine: "Disrupts an established routine",
                backToBack: "Exceeds your preferred back-to-back limit",
              } as Record<string, string>
            )[key] ?? label)
          : label,
      value: Math.max(-1, Math.min(1, value)),
      weight: weights[key],
    });
  add(
    "preference",
    "Matches your preferred times",
    rules.some((p) => p.kind === "prefer")
      ? 1
      : rules.some((p) => p.kind === "avoid" || p.kind === "avoid-before")
        ? -1
        : 0,
  );
  add(
    "energy",
    "Focus matches your energy",
    category?.role === "deep-work" ? (high ? 1 : low ? -1 : 0) : 0,
  );
  add("habit", "Fits your established routine", habit);
  add(
    "chain",
    "Keeps linked activities together",
    chains.length ? chains.reduce((n, v) => n + v.value, 0) / chains.length : 0,
  );
  add(
    "fragmentation",
    "Leaves useful open blocks",
    gaps.some(
      (g) =>
        g > input.settings.bufferMinutes && g < input.settings.focusMinutes,
    )
      ? -0.6
      : 0.5,
  );
  add(
    "transition",
    "Gives you room between commitments",
    Math.min(...gaps) >= input.settings.bufferMinutes + 10 ? 0.7 : 0,
  );
  add(
    "deepWork",
    "Preserves high-energy focus time",
    category?.role !== "deep-work" && high ? -0.5 : 0,
  );
  add("movement", "Keeps existing plans in place", -moves.length / 3);
  add(
    "shift",
    "Keeps moved events near their original time",
    -moves.reduce(
      (n, m) => n + Math.abs(ms(m.after.start) - ms(m.before.start)) / 86400000,
      0,
    ) / 3,
  );
  add(
    "urgency",
    "Leaves time before your deadline",
    r.deadline
      ? Math.max(
          0,
          1 -
            (ms(end) - ms(input.now)) /
              Math.max(1, ms(r.deadline) - ms(input.now)),
        )
      : 0,
  );
  add(
    "priority",
    "Protects important commitments",
    -moves.reduce((n, m) => n + priorityValue[m.before.priority], 0) / 12,
  );
  add(
    "context",
    "Reduces context switching",
    previous && previous.categoryId !== r.categoryId && gaps[0] < 30 ? -0.5 : 0,
  );
  add(
    "workload",
    "Balances the day’s workload",
    work > 480 ? -1 : work > 360 ? -0.5 : 0.5,
  );
  const ordered = [
    ...neighbors.map((e) => ({ start: ms(e.start), end: ms(e.end) })),
    { start: ms(start), end: ms(end) },
  ].sort((a, b) => a.start - b.start);
  let runLength = 1,
    candidateRun = 1,
    includesCandidate = false;
  for (let i = 0; i < ordered.length; i++) {
    if (
      i &&
      ordered[i].start - ordered[i - 1].end >
        input.settings.breakMinutes * 60000
    ) {
      runLength = 1;
      includesCandidate = false;
    } else if (i) runLength++;
    if (ordered[i].start === ms(start)) includesCandidate = true;
    if (includesCandidate) candidateRun = Math.max(candidateRun, runLength);
  }
  add(
    "backToBack",
    "Respects your back-to-back limit",
    candidateRun > input.settings.maxBackToBack
      ? -Math.min(1, (candidateRun - input.settings.maxBackToBack) / 2)
      : 0.5,
  );
  add(
    "routine",
    "Preserves familiar routines",
    -moves.reduce(
      (n, m) =>
        n +
        habitStrength(
          input.habits,
          m.before.activity,
          m.before.start,
          zone,
          input.now,
        ),
      0,
    ) / 3,
  );
  const total = contributions.reduce((n, c) => n + c.value * c.weight, 0),
    denom = contributions.reduce((n, c) => n + c.weight, 0);
  const ranked = [...contributions].sort(
    (a, b) => b.value * b.weight - a.value * a.weight,
  );
  return {
    start,
    end,
    score: Math.round(Math.max(0, Math.min(100, 65 + (total / denom) * 35))),
    contributions,
    reasons: ranked
      .filter((c) => c.value > 0)
      .slice(0, 3)
      .map((c) => c.label),
    moves,
  };
}
function starts(input: SchedulingInput, r: ScheduleRequest) {
  if (r.exactStart) return [ms(r.exactStart)];
  const min = Math.max(ms(input.now), ms(r.windowStart)),
    max =
      Math.min(ms(r.windowEnd), r.deadline ? ms(r.deadline) : Infinity) -
      r.duration * 60000;
  const result = new Set<number>();
  for (
    let t = Math.ceil(min / 300000) * 300000;
    t <= max && result.size < 30000;
    t += 300000
  )
    result.add(t);
  for (const e of input.events) {
    const t = ms(e.end) + input.settings.bufferMinutes * 60000;
    if (t >= min && t <= max) result.add(t);
  }
  return [...result].sort((a, b) => a - b);
}
function bestDistinct(candidates: Candidate[], limit = 3) {
  const out: Candidate[] = [];
  for (const c of candidates.sort(
    (a, b) => b.score - a.score || ms(a.start) - ms(b.start),
  ))
    if (out.every((v) => Math.abs(ms(v.start) - ms(c.start)) >= 30 * 60000)) {
      out.push(c);
      if (out.length === limit) break;
    }
  return out;
}
export function findCandidates(
  input: SchedulingInput,
  r: ScheduleRequest,
  allowMoves = false,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const t of starts(input, r)) {
    const start = iso(t),
      end = iso(t + r.duration * 60000);
    if (valid(input, r, start, end))
      candidates.push(score(input, r, start, end));
  }
  if (candidates.length || !allowMoves) return bestDistinct(candidates);
  let searched = 0;
  for (const t of starts(input, r)) {
    if (++searched > 2200) break;
    const start = iso(t),
      end = iso(t + r.duration * 60000),
      buffer = input.settings.bufferMinutes * 60000;
    const blockers = activeEvents(input).filter(
      (e) => t < ms(e.end) + buffer && ms(end) + buffer > ms(e.start),
    );
    if (
      !blockers.length ||
      blockers.length > 3 ||
      blockers.some(
        (e) =>
          e.flexibility !== "flexible" ||
          !e.importReviewed ||
          priorityValue[e.priority] > priorityValue[r.priority],
      )
    )
      continue;
    const reduced = {
      ...input,
      events: input.events.filter((e) => !blockers.includes(e)),
    };
    if (!valid(reduced, r, start, end)) continue;
    const provisional: CalendarEvent = {
      id: "reserved",
      userId: input.userId,
      title: r.title,
      start,
      end,
      timeZone: input.settings.timeZone,
      activity: r.activity,
      categoryId: r.categoryId,
      priority: r.priority,
      flexibility: "fixed",
      interruptible: false,
      allDay: false,
      transparent: false,
      importReviewed: true,
      revision: 0,
    };
    const occupied = { ...reduced, events: [...reduced.events, provisional] },
      moves: Candidate["moves"] = [];
    for (const before of blockers.sort(
      (a, b) => priorityValue[b.priority] - priorityValue[a.priority],
    )) {
      const options = findCandidates(occupied, {
        title: before.title,
        activity: before.activity,
        duration: (ms(before.end) - ms(before.start)) / 60000,
        windowStart: input.now,
        windowEnd: DateTime.fromISO(r.windowEnd).plus({ days: 7 }).toISO()!,
        categoryId: before.categoryId,
        priority: before.priority,
        deadline: before.deadlineId ? before.end : undefined,
      });
      const chosen = options.sort(
        (a, b) =>
          Math.abs(ms(a.start) - ms(before.start)) -
          Math.abs(ms(b.start) - ms(before.start)),
      )[0];
      if (!chosen) break;
      const after = {
        ...before,
        start: chosen.start,
        end: chosen.end,
        revision: before.revision + 1,
      };
      moves.push({ before, after });
      occupied.events.push(after);
    }
    if (moves.length === blockers.length)
      candidates.push(score(reduced, r, start, end, moves));
  }
  return bestDistinct(candidates);
}
export function planStudy(input: SchedulingInput, r: ScheduleRequest) {
  const slots: Candidate[] = [],
    working = { ...input, events: [...input.events] },
    minimum = r.minSessionMinutes ?? 30;
  let remaining = r.duration;
  while (remaining > 0 && slots.length < 100) {
    let size = Math.min(
        remaining,
        input.settings.focusMinutes,
        input.settings.maxFocusMinutes,
      ),
      chosen: Candidate | undefined;
    while (size >= Math.min(minimum, remaining)) {
      const options: Candidate[] = [];
      for (
        let d = DateTime.fromISO(r.windowStart)
          .setZone(input.settings.timeZone)
          .startOf("day");
        d.toMillis() < ms(r.windowEnd);
        d = d.plus({ days: 1 })
      ) {
        const start = iso(Math.max(d.toMillis(), ms(r.windowStart))),
          end = iso(Math.min(d.plus({ days: 1 }).toMillis(), ms(r.windowEnd)));
        options.push(
          ...findCandidates(working, {
            ...r,
            duration: size,
            windowStart: start,
            windowEnd: end,
          }),
        );
      }
      chosen = options.sort((a, b) => {
        const count = (c: Candidate) =>
          slots.filter((v) =>
            DateTime.fromISO(v.start)
              .setZone(input.settings.timeZone)
              .hasSame(
                DateTime.fromISO(c.start).setZone(input.settings.timeZone),
                "day",
              ),
          ).length;
        return (
          b.score - count(b) * 20 - (a.score - count(a) * 20) ||
          ms(a.start) - ms(b.start)
        );
      })[0];
      if (chosen) break;
      size -= 5;
    }
    if (!chosen) break;
    slots.push(chosen);
    remaining -= size;
    working.events.push({
      id: `study-${slots.length}`,
      userId: input.userId,
      title: r.title,
      start: chosen.start,
      end: iso(
        ms(chosen.end) +
          Math.max(
            0,
            input.settings.breakMinutes - input.settings.bufferMinutes,
          ) *
            60000,
      ),
      timeZone: input.settings.timeZone,
      categoryId: r.categoryId,
      activity: r.activity,
      priority: r.priority,
      flexibility: "flexible",
      interruptible: false,
      allDay: false,
      transparent: false,
      importReviewed: true,
      revision: 0,
    });
  }
  return { slots, shortfallMinutes: remaining };
}
export function learnHabits(input: SchedulingInput): Habit[] {
  const groups = new Map<string, CalendarEvent[]>(),
    seen = new Set<string>();
  for (const e of input.events) {
    if (
      ms(e.end) > ms(input.now) ||
      ms(e.end) < ms(input.now) - 180 * 86400000 ||
      e.allDay
    )
      continue;
    const identity = `${e.seriesId ?? e.id}:${e.originalStart ?? e.start}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const d = DateTime.fromISO(e.start).setZone(input.settings.timeZone),
      key = `${e.activity}:${d.weekday}:${Math.floor((d.hour * 60 + d.minute) / 120)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [
    ...input.habits.filter((h) => h.source === "explicit"),
    ...[...groups].map(([key, events]) => {
      const ages = events.map((e) =>
          Math.exp(-(ms(input.now) - ms(e.start)) / 86400000 / 45),
        ),
        sum = ages.reduce((a, b) => a + b, 0),
        minute =
          events.reduce(
            (n, e, i) =>
              n + minuteOf(e.start, input.settings.timeZone) * ages[i],
            0,
          ) / sum;
      const variance =
        events.reduce(
          (n, e, i) =>
            n +
            Math.pow(minuteOf(e.start, input.settings.timeZone) - minute, 2) *
              ages[i],
          0,
        ) / sum;
      return {
        id: key,
        userId: input.userId,
        activity: events[0].activity,
        weekday: DateTime.fromISO(events[0].start).setZone(
          input.settings.timeZone,
        ).weekday,
        minute: Math.round(minute),
        duration:
          events.reduce((n, e) => n + (ms(e.end) - ms(e.start)) / 60000, 0) /
          events.length,
        count: events.length,
        strength: Math.min(1, sum / 6) * Math.exp(-variance / 3600),
        lastSeen: events
          .map((e) => e.start)
          .sort()
          .at(-1)!,
        source: "calendar" as const,
      };
    }),
  ];
}
export function alignment(
  input: SchedulingInput,
  start: string,
  end: string,
): Alignment {
  const events = input.events.filter(
    (e) => !e.allDay && !e.transparent && overlaps(e.start, e.end, start, end),
  );
  if (!events.length)
    return { score: null, label: "Room to make a plan", contributions: [] };
  const parts = new Map<string, Contribution>();
  let total = 0;
  for (const e of events) {
    const c = score(
      { ...input, events: input.events.filter((v) => v.id !== e.id) },
      {
        title: e.title,
        activity: e.activity,
        duration: (ms(e.end) - ms(e.start)) / 60000,
        windowStart: start,
        windowEnd: end,
        categoryId: e.categoryId,
        priority: e.priority,
      },
      e.start,
      e.end,
    );
    total += c.score;
    for (const p of c.contributions) {
      const old = parts.get(p.key);
      parts.set(p.key, {
        ...p,
        value: (old?.value ?? 0) + p.value / events.length,
      });
    }
  }
  const collisions = events.filter((e, i) =>
    events.slice(i + 1).some((v) => overlaps(e.start, e.end, v.start, v.end)),
  ).length;
  const result = Math.max(
    0,
    Math.round(total / events.length - collisions * 15),
  );
  return {
    score: result,
    label:
      result >= 80
        ? "Well aligned"
        : result >= 65
          ? "Finding your rhythm"
          : "Room to rebalance",
    contributions: [...parts.values()]
      .filter((c) => Math.abs(c.value) > 0.05)
      .sort(
        (a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight),
      ),
  };
}
export function meetingAlerts(input: SchedulingInput): AlertPlan[] {
  const meetings = new Set(
    input.categories.filter((c) => c.role === "meetings").map((c) => c.id),
  );
  return input.events
    .filter(
      (e) =>
        e.importReviewed &&
        meetings.has(e.categoryId) &&
        ms(e.start) - 15 * 60000 > ms(input.now),
    )
    .map((e) => {
      const at = iso(ms(e.start) - 15 * 60000),
        end = iso(ms(at) + 1),
        blocking = input.events.find(
          (v) =>
            v.id !== e.id &&
            !v.interruptible &&
            overlaps(at, end, v.start, v.end),
        );
      const contexts = [
        "*",
        ...input.events
          .filter((v) => overlaps(at, end, v.start, v.end))
          .map((v) => v.activity),
      ];
      const quiet = contexts.some(
        (activity) =>
          ruleApplies(input, activity, at, end, "non-interruptible").length > 0,
      );
      return {
        id: `meeting:${e.id}`,
        eventId: e.id,
        title: e.title,
        at,
        prominent: !blocking && !quiet,
        reason: blocking
          ? `Quiet reminder during ${blocking.title}`
          : quiet
            ? "Respects your quiet-time rule"
            : "You are expected to be interruptible",
      };
    });
}
