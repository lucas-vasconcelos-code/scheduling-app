import { z } from "zod";
import { DateTime } from "luxon";

export const id = z.string().min(1).max(200);
export const instant = z
  .string()
  .refine(
    (v) =>
      DateTime.fromISO(v, { setZone: true }).isValid &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(v),
    "Use an RFC3339 timestamp with an offset",
  );
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timezone = z
  .string()
  .refine((v) => DateTime.now().setZone(v).isValid, "Invalid IANA timezone");
export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const flexibilitySchema = z.enum(["fixed", "flexible", "protected"]);
export const roles = [
  "classes",
  "admin",
  "meetings",
  "deadlines",
  "deep-work",
  "faith",
  "health",
  "hobbies",
  "social",
  "custom",
] as const;
export const categorySchema = z.object({
  id,
  userId: id,
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  role: z.enum(roles),
  flexibility: flexibilitySchema,
  interruptible: z.boolean(),
  priority: prioritySchema,
  active: z.boolean().default(true),
  googleLabelId: z.string().optional(),
  lastSyncedLabel: z.object({ name: z.string(), color: z.string() }).optional(),
});
export type Category = z.infer<typeof categorySchema>;
export const eventSchema = z
  .object({
    id,
    userId: id,
    title: z.string().min(1).max(200),
    start: instant,
    end: instant,
    timeZone: timezone,
    categoryId: id,
    activity: z.string().min(1).max(80),
    priority: prioritySchema,
    flexibility: flexibilitySchema,
    interruptible: z.boolean(),
    settingsOverrides: z
      .object({
        flexibility: flexibilitySchema.optional(),
        priority: prioritySchema.optional(),
        interruptible: z.boolean().optional(),
      })
      .optional(),
    allowOutsideWaking: z.boolean().optional(),
    allDay: z.boolean().default(false),
    transparent: z.boolean().default(false),
    googleId: z.string().optional(),
    etag: z.string().optional(),
    seriesId: z.string().optional(),
    originalStart: instant.optional(),
    recurrence: z.array(z.string()).optional(),
    deadlineId: id.optional(),
    importReviewed: z.boolean().default(true),
    suggestedCategoryId: id.optional(),
    revision: z.number().int().default(0),
  })
  .refine(
    (e) =>
      DateTime.fromISO(e.end).toMillis() > DateTime.fromISO(e.start).toMillis(),
    "End must follow start",
  )
  .refine(
    (e) =>
      !e.allDay ||
      [e.start, e.end].every((v) => {
        const d = DateTime.fromISO(v).setZone(e.timeZone);
        return d.toMillis() === d.startOf("day").toMillis();
      }),
    "All-day events must use local midnight boundaries with an exclusive end date",
  );
export type CalendarEvent = z.infer<typeof eventSchema>;
export const settingsSchema = z
  .object({
    timeZone: timezone,
    wake: clock.default("07:00"),
    sleep: clock.default("23:00"),
    highEnergy: z.array(clock).length(2).default(["09:00", "12:00"]),
    lowEnergy: z.array(clock).length(2).default(["14:00", "16:00"]),
    focusMinutes: z.number().int().min(15).max(240).default(60),
    maxFocusMinutes: z.number().int().min(15).max(240).default(90),
    breakMinutes: z.number().int().min(0).max(120).default(15),
    bufferMinutes: z.number().int().min(0).max(120).default(15),
    maxBackToBack: z.number().int().min(1).max(10).default(2),
    notificationsEnabled: z.boolean().default(false),
    prominentAlarmsEnabled: z.boolean().default(true),
    onboarded: z.boolean().default(false),
    theme: z.enum(["system", "light", "dark"]).default("system"),
  })
  .refine(
    (s) => s.maxFocusMinutes >= s.focusMinutes,
    "Maximum focus duration must be at least the preferred duration",
  );
export type Settings = z.infer<typeof settingsSchema>;
export const preferenceSchema = z
  .object({
    id,
    userId: id,
    statement: z.string().min(1).max(1000),
    source: z.enum(["explicit", "inferred"]),
    enabled: z.boolean().default(true),
    hard: z.boolean().default(false),
    kind: z.enum(["avoid", "prefer", "non-interruptible", "avoid-before"]),
    activity: z.string().default("*"),
    relatedActivity: z.string().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).default([]),
    start: clock.default("00:00"),
    end: clock.default("23:59"),
    confidence: z.number().min(0).max(1).default(1),
  })
  .refine(
    (p) => p.source === "explicit" || !p.hard,
    "Inferred preferences cannot be hard constraints",
  );
export type PreferenceRule = z.infer<typeof preferenceSchema>;
export const habitSchema = z.object({
  id,
  userId: id,
  activity: z.string().min(1),
  weekday: z.number().int().min(1).max(7),
  minute: z.number().int().min(0).max(1439),
  duration: z.number().min(5).max(1440),
  count: z.number().int().min(0),
  strength: z.number().min(0).max(1),
  lastSeen: instant,
  source: z.enum(["explicit", "calendar"]),
});
export type Habit = z.infer<typeof habitSchema>;
export const relationshipSchema = z.object({
  statement: z.string().max(1000).optional(),
  id,
  userId: id,
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum([
    "immediately_before",
    "immediately_after",
    "within_minutes_before",
    "within_minutes_after",
    "same_block",
    "avoid_adjacent",
  ]),
  minutes: z.number().int().min(0).max(1440).default(60),
  mandatory: z.boolean().default(false),
});
export type HabitRelationship = z.infer<typeof relationshipSchema>;
export const deadlineSchema = z.object({
  id,
  userId: id,
  title: z.string().min(1).max(200),
  due: instant,
  estimatedMinutes: z.number().int().min(0).max(10000),
  completedMinutes: z.number().int().min(0).default(0),
  priority: prioritySchema,
  categoryId: id,
  minSessionMinutes: z.number().int().min(5).default(30),
  maxSessionMinutes: z.number().int().min(5).default(90),
  notes: z.string().max(5000).default(""),
});
export type Deadline = z.infer<typeof deadlineSchema>;
export const intentSchema = z.object({
  type: z.enum([
    "create",
    "move",
    "delete",
    "find",
    "reorganize",
    "deadline",
    "study",
    "recurring",
    "preference",
    "habit-link",
    "protect",
    "clarify",
  ]),
  title: z.string().max(200).optional(),
  activity: z.string().max(80).optional(),
  duration: z.number().int().min(5).max(10000).optional(),
  windowStart: instant.optional(),
  windowEnd: instant.optional(),
  exactStart: instant.optional(),
  due: instant.optional(),
  categoryId: id.optional(),
  eventId: id.optional(),
  priority: prioritySchema.optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  recurrenceScope: z.enum(["instance", "series"]).optional(),
  relationship: relationshipSchema.omit({ id: true, userId: true }).optional(),
  preference: preferenceSchema
    .innerType()
    .omit({ userId: true, id: true })
    .optional(),
  confidence: z.number().min(0).max(1),
  question: z.string().optional(),
});
export type Intent = z.infer<typeof intentSchema>;
export interface SchedulingInput {
  userId: string;
  now: string;
  events: CalendarEvent[];
  categories: Category[];
  settings: Settings;
  preferences: PreferenceRule[];
  habits: Habit[];
  relationships: HabitRelationship[];
}
export interface ScheduleRequest {
  title: string;
  activity: string;
  duration: number;
  windowStart: string;
  windowEnd: string;
  exactStart?: string;
  categoryId: string;
  priority: CalendarEvent["priority"];
  deadline?: string;
  minSessionMinutes?: number;
  allDay?: boolean;
  allowOutsideWaking?: boolean;
}
export interface Contribution {
  key: string;
  label: string;
  value: number;
  weight: number;
}
export interface Candidate {
  start: string;
  end: string;
  score: number;
  reasons: string[];
  contributions: Contribution[];
  moves: { before: CalendarEvent; after: CalendarEvent }[];
}
export interface Change {
  kind: "create" | "update" | "delete";
  before?: CalendarEvent;
  after?: CalendarEvent;
  externalBefore?: Record<string, unknown>;
  restore?: Record<string, unknown>;
}
export interface Proposal {
  id: string;
  userId: string;
  title: string;
  changes: Change[];
  status:
    | "pending"
    | "applying"
    | "applied"
    | "rejected"
    | "undone"
    | "failed"
    | "recovery";
  snapshotRevision: number;
  createdAt: string;
  explanation: string;
  shortfallMinutes: number;
  appliedChanges?: Change[];
  providerChanges?: Change[];
  appliedProviderChanges?: Change[];
  error?: string;
  deadline?: Deadline;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  proposalId?: string;
  eventId?: string;
}
export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  pending?: Intent;
  lastEventId?: string;
  proposalId?: string;
}
export interface AlertPlan {
  id: string;
  eventId: string;
  title: string;
  at: string;
  prominent: boolean;
  reason: string;
}
export interface AlertCapability {
  notification: boolean;
  prominent: boolean;
  reason: string;
}
export interface Alignment {
  score: number | null;
  label: string;
  contributions: Contribution[];
}
export interface UserState {
  userId: string;
  name: string;
  revision: number;
  settings: Settings;
  categories: Category[];
  events: CalendarEvent[];
  preferences: PreferenceRule[];
  habits: Habit[];
  relationships: HabitRelationship[];
  deadlines: Deadline[];
  conversations: Conversation[];
  proposals: Proposal[];
  sync: {
    seriesIds?: string[];
    horizonDate?: string;
    token?: string;
    at?: string;
    error?: string;
    labels: "unknown" | "available" | "unavailable";
    email?: string;
    pendingChannel?: { id: string; token: string; expires: number };
    channelId?: string;
    channelToken?: string;
    resourceId?: string;
    channelExpires?: number;
  };
  devices: {
    sessionHash?: string;
    appVersion?: string;
    lastSeen?: string;
    capability?: string;
    pushStatus?: string;
    id: string;
    token?: string;
    platform: string;
    alerts: AlertPlan[];
    registrations?: {
      id: string;
      notification: boolean;
      prominent: boolean;
      reason: string;
    }[];
  }[];
}
export const captureSchema = z.object({
  id,
  userId: id,
  source: z.enum(["email", "manual", "calendar", "lms"]),
  type: z.enum(["deadline", "meeting", "task", "reminder"]),
  status: z.enum(["pending", "accepted", "dismissed", "deferred"]),
  title: z.string(),
  sourceReference: z.string().optional(),
});
export const categoryDefaults = (userId: string): Category[] =>
  [
    ["classes", "Classes", "#5B7CFA", "fixed", false, "high"],
    ["admin", "Admin", "#8090A5", "flexible", true, "medium"],
    ["meetings", "Meetings", "#AF82EA", "fixed", false, "high"],
    ["deadlines", "Deadlines", "#E47179", "fixed", false, "high"],
    ["deep-work", "Deep Work", "#558A75", "flexible", false, "high"],
    ["faith", "Faith", "#BE9C60", "protected", false, "high"],
    ["health", "Health & Habits", "#DE9369", "flexible", true, "medium"],
    ["hobbies", "Hobbies", "#7D9EBC", "flexible", true, "low"],
    ["social", "Social", "#CC87AC", "flexible", true, "medium"],
  ].map(([role, name, color, flexibility, interruptible, priority]) =>
    categorySchema.parse({
      id: role,
      userId,
      role,
      name,
      color,
      flexibility,
      interruptible,
      priority,
      active: true,
    }),
  );
export const minutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
export const nowISO = () => new Date().toISOString();
