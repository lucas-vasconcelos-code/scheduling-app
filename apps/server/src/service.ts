import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {
  eventSchema,
  intentSchema,
  preferenceSchema,
  relationshipSchema,
  type UserState,
  type Intent,
  type Proposal,
  type Change,
  type CalendarEvent,
  type SchedulingInput,
  type ScheduleRequest,
  type Conversation,
} from "@aligned/shared";
import {
  findCandidates,
  planStudy,
  learnHabits,
  valid,
  overlaps,
} from "@aligned/scheduler";
import type { Repository } from "./store.js";
import { ServiceError, type CalendarService } from "./calendar.js";
import type { IntentProvider } from "./intent.js";
export const inputFor = (
  s: UserState,
  now = new Date().toISOString(),
): SchedulingInput => ({
  userId: s.userId,
  now,
  events: s.events,
  categories: s.categories,
  settings: s.settings,
  preferences: s.preferences,
  habits: s.habits,
  relationships: s.relationships,
});
export class SchedulingService {
  constructor(
    public repo: Repository,
    public calendar: CalendarService,
    public intents: IntentProvider,
  ) {}
  async state(userId: string) {
    const s = await this.repo.get(userId);
    if (!s) throw new ServiceError(401, "Please sign in.");
    return s;
  }
  async sync(s: UserState) {
    try {
      await this.calendar.sync(s);
      s.habits = learnHabits(inputFor(s));
      await this.repo.save(s);
    } catch (error) {
      s.sync.error =
        error instanceof ServiceError && error.status === 401
          ? "Google authorization expired. Please reconnect."
          : "Calendar refresh failed. Try Sync now.";
      if (error instanceof ServiceError && error.status === 401) {
        await this.repo.disconnect(s.userId);
        delete s.sync.channelId;
        delete s.sync.channelToken;
        delete s.sync.resourceId;
        delete s.sync.channelExpires;
        delete s.sync.pendingChannel;
      }
      await this.repo.save(s);
      throw error;
    }
  }
  proposal(
    s: UserState,
    title: string,
    changes: Change[],
    explanation: string,
    shortfallMinutes = 0,
  ): Proposal {
    const p: Proposal = {
      id: randomUUID(),
      userId: s.userId,
      title,
      changes: structuredClone(changes),
      status: "pending",
      snapshotRevision: s.revision,
      createdAt: new Date().toISOString(),
      explanation,
      shortfallMinutes,
    };
    s.proposals.push(p);
    return p;
  }
  async editSeries(s: UserState, before: CalendarEvent, after?: CalendarEvent) {
    const root = before.seriesId ?? before.id,
      instances = s.events.filter((e) => e.seriesId === root || e.id === root);
    if (!instances.length)
      throw new ServiceError(404, "Recurring series not found.");
    const old = DateTime.fromISO(before.start).setZone(before.timeZone),
      next = after
        ? DateTime.fromISO(after.start).setZone(after.timeZone)
        : old,
      days = Math.round(
        next.startOf("day").diff(old.startOf("day"), "days").days,
      );
    const changes: Change[] = instances.map((e) => {
      if (!after) return { kind: "delete", before: e };
      const start = DateTime.fromISO(e.start)
        .setZone(after.timeZone)
        .plus({ days })
        .set({ hour: next.hour, minute: next.minute });
      return {
        kind: "update",
        before: e,
        after: {
          ...e,
          title: after.title,
          categoryId: after.categoryId,
          priority: after.priority,
          flexibility: after.flexibility,
          interruptible: after.interruptible,
          settingsOverrides: after.settingsOverrides,
          timeZone: after.timeZone,
          allDay: after.allDay,
          allowOutsideWaking: true,
          start: start.toISO()!,
          end: new Date(
            start.toMillis() + Date.parse(after.end) - Date.parse(after.start),
          ).toISOString(),
          revision: e.revision + 1,
        },
      };
    });
    const p = this.proposal(
      s,
      after ? "Edit recurring series" : "Delete recurring series",
      changes,
      `This changes the entire series. The preview includes ${instances.length} synchronized occurrences; a Google series also includes occurrences outside the displayed calendar range.`,
    );
    if (this.calendar.seriesChange && before.googleId)
      p.providerChanges = [await this.calendar.seriesChange(s, before, after)];
    return p;
  }
  event(
    s: UserState,
    r: ScheduleRequest,
    start: string,
    end: string,
  ): CalendarEvent {
    const category = s.categories.find(
      (c) => c.id === r.categoryId && c.active,
    );
    if (!category) throw new ServiceError(400, "Choose an active category.");
    return eventSchema.parse({
      id: randomUUID(),
      userId: s.userId,
      title: r.title,
      start,
      end,
      timeZone: s.settings.timeZone,
      categoryId: category.id,
      activity: r.activity,
      priority: r.priority,
      flexibility: category.flexibility,
      interruptible: category.interruptible,
      importReviewed: true,
      allDay: r.allDay,
      allowOutsideWaking: r.allowOutsideWaking,
    });
  }
  async message(s: UserState, text: string, conversationId?: string) {
    let c: Conversation | undefined = conversationId
      ? s.conversations.find((v) => v.id === conversationId)
      : s.conversations.at(-1);
    if (conversationId && !c)
      throw new ServiceError(404, "Conversation not found.");
    if (!c) {
      c = { id: randomUUID(), userId: s.userId, messages: [] };
      s.conversations.push(c);
    }
    const now = new Date().toISOString();
    c.messages.push({ id: randomUUID(), role: "user", text, at: now });
    let intent: Intent;
    try {
      intent = intentSchema.parse(
        await this.intents.interpret(text, s, c, now),
      );
    } catch (e) {
      await this.repo.save(s);
      throw e;
    }
    if (["move", "delete"].includes(intent.type) && !intent.eventId)
      intent = {
        ...intent,
        type: "clarify",
        question: "Which event should I change?",
      };
    if (
      ["create", "find", "reorganize", "recurring", "protect"].includes(
        intent.type,
      ) &&
      (!intent.duration || !intent.title)
    )
      intent = {
        ...intent,
        question: !intent.duration
          ? "How long should I reserve?"
          : "What is this time for?",
      };
    if (intent.eventId && !s.events.some((e) => e.id === intent.eventId))
      throw new ServiceError(400, "The requested event was not found.");
    if (
      intent.categoryId &&
      !s.categories.some((cat) => cat.id === intent.categoryId && cat.active)
    )
      throw new ServiceError(400, "The requested category was not found.");
    if (c.proposalId) {
      const previous = s.proposals.find((p) => p.id === c!.proposalId);
      if (previous?.status === "pending") previous.status = "rejected";
    }
    if (
      c.lastEventId &&
      c.pending &&
      /^(make it|change it|actually)/i.test(text) &&
      intent.type === "create"
    )
      intent = { ...intent, type: "move", eventId: c.lastEventId };
    c.pending = intent;
    let reply = "",
      proposal: Proposal | undefined,
      event: CalendarEvent | undefined;
    if (intent.type === "clarify" || intent.question) {
      reply = intent.question ?? "Could you give me a little more detail?";
    } else if (intent.type === "habit-link" && intent.relationship) {
      s.relationships.push(
        relationshipSchema.parse({
          ...intent.relationship,
          id: randomUUID(),
          userId: s.userId,
        }),
      );
      s.revision++;
      reply =
        "Saved your activity link. I’ll consider that routine when finding time. You can edit it in Settings.";
    } else if (intent.type === "preference" && intent.preference) {
      const rule = preferenceSchema.parse({
        ...intent.preference,
        id: randomUUID(),
        userId: s.userId,
      });
      s.preferences.push(rule);
      s.revision++;
      reply = `Saved: “${rule.statement}” You can edit or disable this in Settings.`;
    } else if (intent.type === "delete") {
      const before = s.events.find((e) => e.id === intent.eventId)!;
      proposal =
        before.seriesId && intent.recurrenceScope === "series"
          ? await this.editSeries(s, before)
          : this.proposal(
              s,
              `Delete ${before.title}`,
              [{ kind: "delete", before }],
              "Review this deletion before applying it.",
            );
      reply = "Review the event below before deleting it.";
    } else if (intent.type === "deadline" && !intent.duration) {
      reply =
        "How much total study or work time would you like before the deadline?";
    } else {
      const due = intent.due,
        categoryId =
          intent.categoryId ??
          s.categories.find((c) => c.active && c.role === "deep-work")?.id ??
          s.categories.find((c) => c.active)?.id;
      if (!categoryId)
        throw new ServiceError(400, "Add a category before scheduling.");
      const r: ScheduleRequest = {
        title: intent.title ?? "Focus time",
        activity: intent.activity ?? "study",
        duration: intent.duration ?? 60,
        windowStart: intent.windowStart ?? now,
        windowEnd:
          intent.windowEnd ?? DateTime.fromISO(now).plus({ days: 7 }).toISO()!,
        exactStart: intent.exactStart,
        categoryId,
        priority:
          intent.priority ??
          s.categories.find((c) => c.id === categoryId)!.priority,
        deadline: due,
        allowOutsideWaking: Boolean(intent.exactStart),
      };
      if ((intent.type === "study" || intent.type === "deadline") && !due) {
        reply = "What date and time is the deadline?";
      } else if (intent.type === "study" || intent.type === "deadline") {
        const existing = s.deadlines.find(
            (d) => d.title === r.title && d.due === due,
          ),
          deadlineId = existing?.id ?? randomUUID();
        const studyInput = inputFor(s);
        if (existing) {
          r.minSessionMinutes = existing.minSessionMinutes;
          studyInput.settings = {
            ...s.settings,
            maxFocusMinutes: Math.min(
              s.settings.maxFocusMinutes,
              existing.maxSessionMinutes,
            ),
          };
        }
        const plan = planStudy(studyInput, r);
        const changes = plan.slots.map((slot) => ({
          kind: "create" as const,
          after: { ...this.event(s, r, slot.start, slot.end), deadlineId },
        }));
        proposal = this.proposal(
          s,
          "Your study plan",
          changes,
          `Spread ${r.duration - plan.shortfallMinutes} minutes across ${changes.length} focused sessions before your deadline.`,
          plan.shortfallMinutes,
        );
        proposal.deadline = {
          id: deadlineId,
          userId: s.userId,
          title: r.title,
          due: due!,
          estimatedMinutes: existing?.estimatedMinutes ?? r.duration,
          completedMinutes: existing?.completedMinutes ?? 0,
          priority: r.priority,
          categoryId:
            s.categories.find((c) => c.role === "deadlines")?.id ?? categoryId,
          minSessionMinutes: existing?.minSessionMinutes ?? 30,
          maxSessionMinutes:
            existing?.maxSessionMinutes ?? s.settings.maxFocusMinutes,
          notes: existing?.notes ?? "",
        };
        reply = plan.shortfallMinutes
          ? `I found room for ${r.duration - plan.shortfallMinutes} of ${r.duration} minutes. ${plan.shortfallMinutes} minutes still need space.`
          : "Here is a balanced study plan. Review the sessions before adding them.";
      } else if (intent.type === "recurring") {
        if (!intent.weekdays?.length) {
          reply = "Which weekdays should this repeat on?";
        } else {
          const changes: Change[] = [],
            working = { ...inputFor(s), events: [...s.events] },
            until = DateTime.fromISO(r.windowStart)
              .setZone(s.settings.timeZone)
              .plus({ days: 90 });
          for (
            let day = DateTime.fromISO(r.windowStart)
              .setZone(s.settings.timeZone)
              .startOf("day");
            day < until;
            day = day.plus({ days: 1 })
          ) {
            if (!intent.weekdays.includes(day.weekday)) continue;
            const base = DateTime.fromISO(r.windowStart).setZone(
                s.settings.timeZone,
              ),
              last = DateTime.fromISO(r.windowEnd).setZone(s.settings.timeZone);
            const from = day.set({ hour: base.hour, minute: base.minute }),
              to = day.set({ hour: last.hour, minute: last.minute });
            const req = {
              ...r,
              windowStart: from.toISO()!,
              windowEnd: to.toISO()!,
              exactStart: intent.exactStart
                ? day
                    .set({
                      hour: DateTime.fromISO(intent.exactStart).setZone(
                        s.settings.timeZone,
                      ).hour,
                      minute: DateTime.fromISO(intent.exactStart).setZone(
                        s.settings.timeZone,
                      ).minute,
                    })
                    .toISO()!
                : undefined,
            };
            const candidate = findCandidates(working, req)[0];
            if (!candidate) {
              reply = `There is no safe slot on ${day.toFormat("ccc, MMM d")}. Try another window.`;
              break;
            }
            const after = this.event(s, r, candidate.start, candidate.end);
            changes.push({ kind: "create", after });
            working.events.push(after);
          }
          if (!reply && changes.length) {
            // Finite recurrence is explicit in the preview; a series is never scheduled beyond its validated horizon.
            const first = changes[0].after!,
              sameClock = changes.every(
                (c) =>
                  DateTime.fromISO(c.after!.start)
                    .setZone(s.settings.timeZone)
                    .toFormat("HH:mm") ===
                  DateTime.fromISO(first.start)
                    .setZone(s.settings.timeZone)
                    .toFormat("HH:mm"),
              );
            const seriesId = first.id;
            for (const ch of changes) ch.after!.seriesId = seriesId;
            if (sameClock)
              first.recurrence = [
                `RRULE:FREQ=WEEKLY;BYDAY=${intent.weekdays.map((d) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][d - 1]).join(",")};COUNT=${changes.length}`,
              ];
            proposal = this.proposal(
              s,
              "Recurring activity",
              changes,
              `Repeat for the next 90 days (${changes.length} occurrences). ${sameClock ? "A recurring Google series will be created." : "Times adapt around your existing commitments; these will be linked individual events."}`,
            );
            if (sameClock && this.calendar.seriesChange)
              proposal.providerChanges = [changes[0]];
            reply = "Review the recurring schedule before adding it.";
          }
        }
      } else {
        const before =
          intent.type === "move"
            ? s.events.find((e) => e.id === intent.eventId)
            : undefined;
        if (intent.type === "move" && !before)
          throw new ServiceError(400, "Choose the event to move.");
        const input = {
          ...inputFor(s),
          events: s.events.filter((e) => e.id !== before?.id),
        };
        const candidates = findCandidates(
          input,
          r,
          intent.type === "reorganize" ||
            intent.type === "create" ||
            intent.type === "protect",
        );
        const best = candidates[0];
        if (!best) {
          reply =
            "I could not find enough room while respecting your commitments and preferences. Try a wider date window or a shorter duration.";
        } else if (intent.type === "find") {
          reply = `Available: ${candidates.map((v) => DateTime.fromISO(v.start).setZone(s.settings.timeZone).toFormat("ccc h:mm a")).join(", ")}.`;
        } else {
          const after = before
            ? eventSchema.parse({
                ...before,
                start: best.start,
                end: best.end,
                title: r.title,
                revision: before.revision + 1,
              })
            : this.event(s, r, best.start, best.end);
          after.allowOutsideWaking = Boolean(intent.exactStart);
          if (intent.type === "protect") after.flexibility = "protected";
          const changes: Change[] = [
            ...best.moves.map((m) => ({ kind: "update" as const, ...m })),
            { kind: before ? "update" : "create", before, after },
          ];
          proposal =
            before?.seriesId && intent.recurrenceScope === "series"
              ? await this.editSeries(s, before, after)
              : this.proposal(
                  s,
                  best.moves.length
                    ? "Make room for your plans"
                    : before
                      ? "Move your event"
                      : "Add to your calendar",
                  changes,
                  best.reasons.join(". ") + ".",
                );
          if (
            !before &&
            !best.moves.length &&
            intent.confidence >= 0.9 &&
            intent.type !== "reorganize"
          ) {
            await this.repo.save(s);
            proposal = await this.apply(s, proposal.id);
            event = proposal.appliedChanges?.at(-1)?.after;
            c.lastEventId = event?.id;
            reply = `Added ${after.title}. ${best.reasons[0] ?? "It fits your available time"}. You can edit or undo it below.`;
          } else
            reply = best.moves.length
              ? "I can make room by moving flexible time. Review the changes below."
              : "Here is the proposed change. Apply it when you are ready.";
        }
      }
    }
    if (proposal) c.proposalId = proposal.id;
    c.messages.push({
      id: randomUUID(),
      role: "assistant",
      text: reply,
      at: new Date().toISOString(),
      proposalId: proposal?.id,
      eventId: event?.id,
    });
    await this.repo.save(s);
    return { conversation: c, proposal, event, reply };
  }
  async apply(s: UserState, proposalId: string): Promise<Proposal> {
    const p = s.proposals.find((p) => p.id === proposalId);
    if (!p) throw new ServiceError(404, "Proposal not found.");
    if (p.status === "applied") return p;
    if (p.status !== "pending")
      throw new ServiceError(
        409,
        "This proposal is no longer available to apply.",
      );
    await this.calendar.sync(s);
    if (p.snapshotRevision !== s.revision) {
      await this.repo.save(s);
      throw new ServiceError(
        409,
        "Your calendar or preferences changed. Request a fresh proposal.",
      );
    }
    const changedIds = new Set(
        p.changes.flatMap((c) => (c.before ? [c.before.id] : [])),
      ),
      working = {
        ...inputFor(s),
        events: s.events.filter((e) => !changedIds.has(e.id)),
      };
    for (const change of p.changes) {
      if (change.before) {
        const current = s.events.find((e) => e.id === change.before!.id);
        if (
          !current ||
          current.revision !== change.before.revision ||
          current.etag !== change.before.etag
        )
          throw new ServiceError(
            409,
            "An event changed. Refresh the proposal.",
          );
      }
      if (change.after) {
        const e = eventSchema.parse(change.after),
          r = {
            title: e.title,
            activity: e.activity,
            categoryId: e.categoryId,
            priority: e.priority,
            duration:
              (DateTime.fromISO(e.end).toMillis() -
                DateTime.fromISO(e.start).toMillis()) /
              60000,
            windowStart: e.start,
            windowEnd: e.end,
            deadline: p.deadline?.due,
            allDay: e.allDay,
            allowOutsideWaking: e.allowOutsideWaking,
          };
        const metadataOnly =
          change.before &&
          change.before.start === e.start &&
          change.before.end === e.end;
        const historicalSeriesCorrection = Boolean(
          p.providerChanges &&
          change.before &&
          Date.parse(change.before.end) < Date.now(),
        );
        if (
          !metadataOnly &&
          !historicalSeriesCorrection &&
          !valid(working, r, e.start, e.end)
        )
          throw new ServiceError(
            409,
            "The proposed time is no longer available or violates a scheduling rule.",
          );
        working.events.push(e);
      }
    }
    // Free/busy is independently checked against the event snapshot; unknown occupied intervals block writes.
    if (p.changes.some((c) => c.after)) {
      const starts = p.changes
          .flatMap((c) => (c.after ? [c.after.start] : []))
          .sort((a, b) => Date.parse(a) - Date.parse(b)),
        ends = p.changes
          .flatMap((c) => (c.after ? [c.after.end] : []))
          .sort((a, b) => Date.parse(a) - Date.parse(b));
      const busy = await this.calendar.freeBusy(s, starts[0], ends.at(-1)!);
      for (const ch of p.changes.filter((c) => c.after))
        for (const b of unexplainedBusy(busy, s.events)) {
          if (overlaps(ch.after!.start, ch.after!.end, b.start, b.end))
            throw new ServiceError(
              409,
              "Google reports an occupied interval that is not in the local snapshot. Refresh and retry.",
            );
        }
    }
    p.status = "applying";
    await this.repo.save(s);
    const applied: Change[] = [],
      originalEvents = structuredClone(s.events),
      providerPlan = p.providerChanges ?? p.changes;
    await this.repo.journal(s.userId, p.id, {
      status: "applying",
      changes: p.changes,
      completed: [],
    });
    try {
      for (let i = 0; i < providerPlan.length; i++) {
        const ch = providerPlan[i];
        await this.repo.journal(s.userId, p.id, {
          status: "applying",
          changes: providerPlan,
          completed: applied,
          inFlight: i,
        });
        const result = await this.calendar.write(s, ch, `${p.id}:${i}`);
        applied.push(result);
        await this.repo.journal(s.userId, p.id, {
          status: "applying",
          changes: p.changes,
          completed: applied,
        });
      }
      const localChanges = p.providerChanges
        ? structuredClone(p.changes)
        : applied;
      if (p.providerChanges && applied[0]?.after?.googleId) {
        for (const ch of localChanges)
          if (ch.after) ch.after.seriesId = applied[0].after.googleId;
      }
      for (const ch of localChanges) {
        if (ch.before)
          s.events = s.events.filter((e) => e.id !== ch.before!.id);
        if (ch.after) s.events.push(structuredClone(ch.after));
      }
      if (p.providerChanges) {
        await this.calendar.sync(s);
        for (const ch of localChanges)
          if (ch.after) {
            const actual = s.events.find(
              (e) =>
                e.seriesId === ch.after!.seriesId &&
                Date.parse(e.start) === Date.parse(ch.after!.start),
            );
            if (actual) ch.after = actual;
          }
      }
      if (p.deadline) {
        s.deadlines = s.deadlines.filter((d) => d.id !== p.deadline!.id);
        s.deadlines.push(p.deadline);
      }
      s.revision++;
      p.status = "applied";
      p.appliedChanges = localChanges;
      p.appliedProviderChanges = applied;
      await this.repo.save(s);
      await this.repo.journal(s.userId, p.id, {
        status: "applied",
        completed: applied,
      });
      return p;
    } catch (error) {
      let recovered = !(error instanceof ServiceError && error.status >= 500);
      for (let i = applied.length - 1; i >= 0; i--) {
        const ch = applied[i];
        try {
          await this.calendar.write(s, inverse(ch), `${p.id}:rollback:${i}`);
        } catch {
          recovered = false;
        }
      }
      s.events = originalEvents;
      p.status = recovered ? "failed" : "recovery";
      p.error =
        error instanceof Error ? error.message : "Calendar changes failed.";
      p.appliedChanges = applied;
      await this.repo.journal(s.userId, p.id, {
        status: p.status,
        completed: applied,
        error: p.error,
      });
      await this.repo.save(s);
      throw new ServiceError(
        502,
        recovered
          ? `${p.error} Applied steps were rolled back.`
          : `${p.error} Some changes need recovery. Refresh Calendar and review the operation in the assistant.`,
      );
    }
  }
  async undo(s: UserState, id: string) {
    const p = s.proposals.find((p) => p.id === id);
    if (!p) throw new ServiceError(404, "Proposal not found.");
    if (p.status === "undone") return p;
    if (p.status !== "applied")
      throw new ServiceError(409, "Only applied changes can be undone.");
    await this.calendar.sync(s);
    const changes = (p.appliedChanges ?? p.changes).map(inverse).reverse();
    for (const c of changes) {
      if (c.before) {
        const current = s.events.find((e) => e.id === c.before!.id);
        if (
          !current ||
          current.etag !== c.before.etag ||
          current.revision !== c.before.revision
        )
          throw new ServiceError(
            409,
            "This event has changed since scheduling. Edit it directly to preserve the newer changes.",
          );
      }
    }
    const undo = this.proposal(
      s,
      `Undo ${p.title}`,
      changes,
      "Restore the previous schedule.",
    );
    if (p.providerChanges)
      undo.providerChanges = (p.appliedProviderChanges ?? p.providerChanges)
        .map(inverse)
        .reverse();
    await this.repo.save(s);
    await this.apply(s, undo.id);
    p.status = "undone";
    await this.repo.save(s);
    return p;
  }
}
export function inverse(c: Change): Change {
  if (c.kind === "create") return { kind: "delete", before: c.after };
  if (c.kind === "delete")
    return {
      kind: "create",
      restore: c.externalBefore,
      after: c.before
        ? { ...c.before, googleId: undefined, etag: undefined }
        : undefined,
    };
  return {
    kind: "update",
    restore: c.externalBefore,
    before: c.after,
    after: c.before
      ? {
          ...c.before,
          etag: c.after?.etag,
          revision: (c.after?.revision ?? 0) + 1,
        }
      : undefined,
  };
}
export function unexplainedBusy(
  busy: { start: string; end: string }[],
  events: CalendarEvent[],
) {
  let intervals = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]);
  for (const e of events.filter((e) => !e.transparent)) {
    const start = Date.parse(e.start),
      end = Date.parse(e.end);
    intervals = intervals.flatMap(([a, b]) =>
      end <= a || start >= b
        ? [[a, b]]
        : [
            ...(start > a ? [[a, Math.min(start, b)]] : []),
            ...(end < b ? [[Math.max(a, end), b]] : []),
          ],
    );
  }
  return intervals.map(([a, b]) => ({
    start: new Date(a).toISOString(),
    end: new Date(b).toISOString(),
  }));
}
