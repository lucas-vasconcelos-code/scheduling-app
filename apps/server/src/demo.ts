import { DateTime } from "luxon";
import {
  categoryDefaults,
  settingsSchema,
  type UserState,
  type CalendarEvent,
} from "@aligned/shared";
export function emptyState(
  userId: string,
  name = "Alex",
  timeZone = "America/New_York",
): UserState {
  return {
    userId,
    name,
    revision: 0,
    settings: settingsSchema.parse({ timeZone }),
    categories: categoryDefaults(userId),
    events: [],
    preferences: [],
    habits: [],
    relationships: [],
    deadlines: [],
    conversations: [],
    proposals: [],
    devices: [],
    sync: { labels: "unknown" },
  };
}
export function demoState(
  userId: string,
  timeZone = "America/New_York",
  now = DateTime.now(),
): UserState {
  const s = emptyState(userId, "Alex", timeZone),
    today = now.setZone(timeZone).startOf("day");
  s.sync.labels = "unavailable";
  s.sync.at = now.toISO()!;
  const add = (
    day: DateTime,
    hour: number,
    minute: number,
    duration: number,
    title: string,
    categoryId: string,
    activity: string,
  ) => {
    const c = s.categories.find((c) => c.id === categoryId)!,
      start = day.set({ hour, minute });
    const e: CalendarEvent = {
      id: `demo-${s.events.length}`,
      userId,
      title,
      categoryId,
      activity,
      start: start.toISO()!,
      end: start.plus({ minutes: duration }).toISO()!,
      timeZone,
      priority: c.priority,
      flexibility: c.flexibility,
      interruptible: c.interruptible,
      allDay: false,
      transparent: false,
      importReviewed: true,
      revision: 0,
    };
    s.events.push(e);
  };
  for (let d = -35; d < 14; d++) {
    const day = today.plus({ days: d });
    if (day.weekday <= 5) {
      add(day, 9, 0, 60, "Algorithms lecture", "classes", "class");
      add(day, 11, 0, 60, "Calculus seminar", "classes", "class");
      add(day, 12, 30, 45, "Lunch break", "health", "lunch");
    }
    if ([1, 3, 5].includes(day.weekday)) {
      add(day, 16, 0, 60, "Gym · strength training", "health", "gym");
      add(day, 17, 30, 45, "Dinner & recharge", "health", "dinner");
    }
    if (d >= 0 && day.weekday <= 5)
      add(day, 14, 0, 60, "Algorithms problem set", "deep-work", "study");
    if (d >= 0 && day.weekday === 2)
      add(day, 10, 15, 30, "Project check-in", "meetings", "meeting");
    if (d >= 0 && day.weekday === 7)
      add(day, 10, 0, 60, "Sunday service", "faith", "church");
  }
  // Tomorrow intentionally has a movable morning block, making reorganization reproducible.
  const tomorrow = today.plus({ days: 1 });
  if (tomorrow.weekday !== 2)
    add(tomorrow, 10, 15, 30, "Review lecture notes", "deep-work", "study");
  add(
    today.plus({ days: 2 }),
    19,
    0,
    30,
    "Study group check-in",
    "meetings",
    "meeting",
  );
  Object.assign(s.events.at(-1)!, {
    importReviewed: false,
    suggestedCategoryId: "meetings",
    flexibility: "fixed",
    interruptible: false,
  });
  let due = today.plus({ days: 1 });
  while (due.weekday !== 5) due = due.plus({ days: 1 });
  s.deadlines.push({
    id: "demo-exam",
    userId,
    title: "Calculus exam",
    due: due.set({ hour: 9 }).toISO()!,
    estimatedMinutes: 240,
    completedMinutes: 0,
    priority: "high",
    categoryId: "deadlines",
    minSessionMinutes: 30,
    maxSessionMinutes: 90,
    notes: "Four focused hours before Friday.",
  });
  s.preferences.push({
    id: "quiet-study",
    userId,
    statement: "Never schedule studying after 9 PM.",
    source: "explicit",
    enabled: true,
    hard: true,
    kind: "avoid",
    activity: "study",
    weekdays: [],
    start: "21:00",
    end: "07:00",
    confidence: 1,
  });
  s.relationships.push({
    id: "gym-dinner",
    userId,
    from: "gym",
    to: "dinner",
    relation: "within_minutes_after",
    minutes: 60,
    mandatory: false,
  });
  return s;
}
