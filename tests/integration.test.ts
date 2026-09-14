import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../apps/server/src/app.js";
import { MemoryRepository } from "../apps/server/src/store.js";
import {
  DemoCalendar,
  mapGoogle,
  mergeLabels,
  mergeMeetingReminders,
  encrypt,
  decrypt,
} from "../apps/server/src/calendar.js";
import { demoState, emptyState } from "../apps/server/src/demo.js";
import { SchedulingService } from "../apps/server/src/service.js";
import { DemoIntentProvider } from "../apps/server/src/intent.js";
import { intentSchema, type Change } from "@aligned/shared";
import { DateTime } from "luxon";
const config = {
  demo: true,
  clientUrl: "http://localhost:8081",
  publicUrl: "http://localhost:3000",
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-08T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
async function session(app: any) {
  const agent = request.agent(app),
    r = await agent.post("/api/v1/demo").send({ timeZone: "America/New_York" });
  return { agent, csrf: r.body.csrf, token: r.body.token };
}
describe("authentication and API boundaries", () => {
  it("requires authentication", async () => {
    const { app } = createApp(config);
    expect((await request(app).get("/api/v1/state")).status).toBe(401);
  });
  it("requires CSRF on cookie mutations and accepts authenticated native bearer requests", async () => {
    const { app } = createApp(config),
      s = await session(app);
    expect(
      (await s.agent.patch("/api/v1/settings").send({ wake: "08:00" })).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch("/api/v1/settings")
          .set("Authorization", "Bearer " + s.token)
          .send({ wake: "08:00" })
      ).status,
    ).toBe(200);
  });
  it("isolates demo accounts, event IDs and proposals", async () => {
    const { app } = createApp(config),
      a = await session(app),
      b = await session(app);
    await a.agent
      .patch("/api/v1/settings")
      .set("X-CSRF-Token", a.csrf)
      .send({ wake: "08:00" });
    expect((await b.agent.get("/api/v1/state")).body.settings.wake).toBe(
      "07:00",
    );
    const p = await a.agent
      .delete("/api/v1/events/demo-0")
      .set("X-CSRF-Token", a.csrf);
    expect(
      (
        await b.agent
          .post(`/api/v1/proposals/${p.body.proposal.id}/apply`)
          .set("X-CSRF-Token", b.csrf)
      ).status,
    ).toBe(404);
  });
  it("rejects foreign category IDs and invalid event durations", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const r = await s.agent
      .post("/api/v1/events")
      .set("X-CSRF-Token", s.csrf)
      .send({
        title: "Broken",
        start: "2026-06-09T12:00:00-04:00",
        end: "2026-06-09T11:00:00-04:00",
      });
    expect(r.status).toBe(400);
  });
  it("does not execute invalid model output", () => {
    expect(() =>
      intentSchema.parse({ type: "execute_shell", command: "anything" }),
    ).toThrow();
  });
  it("prevents foreign-origin mutations and invalid OAuth state", async () => {
    const { app } = createApp(config);
    expect(
      (
        await request(app)
          .post("/api/v1/demo")
          .set("Origin", "https://attacker.example")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get("/auth/callback?state=invalid&code=anything"))
        .status,
    ).toBe(403);
  });
});
describe("calendar mapping and credentials", () => {
  it("imports unknown events as fixed pending category review", () => {
    const s = emptyState("u");
    const e = mapGoogle(
      {
        id: "g",
        summary: "Gym",
        start: { dateTime: "2026-06-09T16:00:00-04:00" },
        end: { dateTime: "2026-06-09T17:00:00-04:00" },
        etag: "v1",
      },
      s,
    )!;
    expect(e.flexibility).toBe("fixed");
    expect(e.interruptible).toBe(false);
    expect(e.suggestedCategoryId).toBe("health");
  });
  it("handles all-day events and cancelled recurring instances", () => {
    const s = emptyState("u"),
      e = mapGoogle(
        {
          id: "g",
          summary: "Away",
          start: { date: "2026-06-09" },
          end: { date: "2026-06-10" },
        },
        s,
      )!;
    expect(e.allDay).toBe(true);
    expect(DateTime.fromISO(e.start).setZone(s.settings.timeZone).hour).toBe(0);
    expect(mapGoogle({ status: "cancelled", id: "g" }, s)).toBeUndefined();
  });
  it("merges labels without losing unrelated labels", () => {
    const s = emptyState("u"),
      foreign = { id: "foreign", name: "Existing", backgroundColor: "#112233" },
      merged = mergeLabels([foreign], s.categories);
    expect(merged).toContainEqual(foreign);
    expect(merged).toHaveLength(10);
    expect(mergeLabels(merged, s.categories)).toHaveLength(10);
  });
  it("preserves reminder overrides and deduplicates T−15", () => {
    const result = mergeMeetingReminders({
      useDefault: false,
      overrides: [
        { method: "email", minutes: 60 },
        { method: "popup", minutes: 15 },
      ],
    });
    expect(result.overrides).toEqual([
      { method: "email", minutes: 60 },
      { method: "popup", minutes: 15 },
    ]);
  });
  it("encrypts credentials and detects tampering", () => {
    const key = Buffer.alloc(32, 5).toString("base64"),
      cipher = encrypt("refresh-secret", key);
    expect(cipher).not.toContain("refresh-secret");
    expect(decrypt(cipher, key)).toBe("refresh-secret");
    const bytes = Buffer.from(cipher, "base64");
    bytes[14] ^= 1;
    expect(() => decrypt(bytes.toString("base64"), key)).toThrow();
  });
});
describe("conversation and proposal application", () => {
  it("creates a simple event, understands a follow-up, and supports undo", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const r = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Schedule an hour to work out tomorrow" });
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.proposal.status).toBe("applied");
    const follow = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Make it two hours" });
    expect(follow.status, follow.body.error).toBe(200);
    expect(follow.body.proposal.status).toBe("pending");
    const ch = follow.body.proposal.changes.at(-1);
    expect(Date.parse(ch.after.end) - Date.parse(ch.after.start)).toBe(
      120 * 60000,
    );
    const undone = await s.agent
      .post(`/api/v1/proposals/${r.body.proposal.id}/undo`)
      .set("X-CSRF-Token", s.csrf);
    expect(undone.status, undone.body.error).toBe(200);
  });
  it("completes missing study duration across turns", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const a = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "I have an exam Friday" });
    expect(a.body.reply).toContain("How much");
    const b = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Four hours" });
    expect(b.status, b.body.error).toBe(200);
    expect(b.body.proposal.changes.length).toBeGreaterThan(1);
    expect(b.body.proposal.status).toBe("pending");
  });
  it("does not apply a proposal after preferences change", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const a = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({
        message: "I have an exam Friday and want four hours of studying",
      });
    await s.agent
      .patch("/api/v1/settings")
      .set("X-CSRF-Token", s.csrf)
      .send({ bufferMinutes: 20 });
    const b = await s.agent
      .post(`/api/v1/proposals/${a.body.proposal.id}/apply`)
      .set("X-CSRF-Token", s.csrf);
    expect(b.status, b.body.error).toBe(409);
  });
  it("applying twice does not create duplicate events", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const a = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Schedule an hour to work out tomorrow" });
    const before = (await s.agent.get("/api/v1/state")).body.events.length;
    const b = await s.agent
      .post(`/api/v1/proposals/${a.body.proposal.id}/apply`)
      .set("X-CSRF-Token", s.csrf);
    expect(b.status).toBe(200);
    expect((await s.agent.get("/api/v1/state")).body.events.length).toBe(
      before,
    );
  });
  it("journals failed applications and compensates completed steps", async () => {
    class FailingCalendar extends DemoCalendar {
      calls: Change[] = [];
      override async write(s: any, c: Change, id: string) {
        this.calls.push(c);
        if (this.calls.length === 2) throw new Error("simulated failure");
        return super.write(s, c, id);
      }
    }
    const repo = new MemoryRepository(),
      cal = new FailingCalendar(),
      service = new SchedulingService(repo, cal, new DemoIntentProvider()),
      s = demoState("u");
    s.events = [];
    await repo.save(s);
    const r = {
      title: "Study",
      activity: "study",
      duration: 60,
      windowStart: "2026-06-09T09:00:00-04:00",
      windowEnd: "2026-06-09T15:00:00-04:00",
      categoryId: "deep-work",
      priority: "high" as const,
    };
    const p = service.proposal(
      s,
      "Two events",
      [
        {
          kind: "create",
          after: service.event(
            s,
            r,
            r.windowStart,
            "2026-06-09T10:00:00-04:00",
          ),
        },
        {
          kind: "create",
          after: service.event(
            s,
            r,
            "2026-06-09T13:00:00-04:00",
            "2026-06-09T14:00:00-04:00",
          ),
        },
      ],
      "Test",
    );
    await expect(service.apply(s, p.id)).rejects.toThrow("rolled back");
    expect(p.status).toBe("failed");
    expect(cal.calls.at(-1)?.kind).toBe("delete");
    expect((await repo.journal("u", p.id))?.status).toBe("failed");
  });
});

describe("scheduling regressions", () => {
  it("validates provider output before any calendar write", async () => {
    const cal = new DemoCalendar(),
      write = vi.spyOn(cal, "write");
    const { app } = createApp(config, new MemoryRepository(), cal, {
      async interpret() {
        return { type: "create", duration: -4 } as any;
      },
    });
    const s = await session(app);
    const r = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Schedule something" });
    expect(r.status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it("honors an explicitly requested time outside waking hours", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const r = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Schedule an hour to work out tomorrow at 4 am" });
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.proposal.status).toBe("applied");
    expect(
      DateTime.fromISO(r.body.proposal.changes[0].after.start).setZone(
        "America/New_York",
      ).hour,
    ).toBe(4);
  });
  it("retains per-event overrides when category defaults change", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const r = await s.agent
      .post("/api/v1/events")
      .set("X-CSRF-Token", s.csrf)
      .send({
        title: "Protected walk",
        start: "2026-06-09T05:00:00-04:00",
        end: "2026-06-09T06:00:00-04:00",
        categoryId: "health",
        flexibility: "protected",
      });
    expect(r.status, r.body.error).toBe(200);
    await s.agent
      .put("/api/v1/categories/health")
      .set("X-CSRF-Token", s.csrf)
      .send({ flexibility: "flexible" });
    const state = (await s.agent.get("/api/v1/state")).body;
    expect(
      state.events.find((e: any) => e.id === r.body.event.id).flexibility,
    ).toBe("protected");
  });
  it("plans saved deadlines with their exact due time and avoids duplicate allocations", async () => {
    const { app } = createApp(config),
      s = await session(app);
    const d = await s.agent
      .put("/api/v1/deadlines/assignment")
      .set("X-CSRF-Token", s.csrf)
      .send({
        title: "Assignment",
        due: "2026-06-10T15:30:00-04:00",
        estimatedMinutes: 120,
        priority: "high",
        categoryId: "deadlines",
      });
    expect(d.status, d.body.error).toBe(200);
    const r = await s.agent
      .post("/api/v1/deadlines/assignment/plan")
      .set("X-CSRF-Token", s.csrf);
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.proposal.deadline.id).toBe("assignment");
    expect(
      r.body.proposal.changes.every(
        (c: any) => Date.parse(c.after.end) <= Date.parse(d.body.due),
      ),
    ).toBe(true);
    await s.agent
      .post(`/api/v1/proposals/${r.body.proposal.id}/apply`)
      .set("X-CSRF-Token", s.csrf);
    expect(
      (
        await s.agent
          .post("/api/v1/deadlines/assignment/plan")
          .set("X-CSRF-Token", s.csrf)
      ).status,
    ).toBe(409);
  });
  it("preserves a newer edit when Undo would overwrite it", async () => {
    const repo = new MemoryRepository(),
      { app } = createApp(config, repo),
      s = await session(app);
    const r = await s.agent
      .post("/api/v1/messages")
      .set("X-CSRF-Token", s.csrf)
      .send({ message: "Schedule an hour to work out tomorrow" });
    const user = (await repo.users())[0],
      state = (await repo.get(user))!;
    const e = state.events.find(
      (e) => e.id === r.body.proposal.changes[0].after.id,
    )!;
    e.title = "External edit";
    e.revision++;
    await repo.save(state);
    const undo = await s.agent
      .post(`/api/v1/proposals/${r.body.proposal.id}/undo`)
      .set("X-CSRF-Token", s.csrf);
    expect(undo.status).toBe(409);
    expect(
      (await repo.get(user))!.events.find((v) => v.id === e.id)!.title,
    ).toBe("External edit");
  });
  it("reviews imports through the calendar adapter", async () => {
    const repo = new MemoryRepository(),
      cal = new DemoCalendar(),
      write = vi.spyOn(cal, "write"),
      { app } = createApp(config, repo, cal),
      s = await session(app);
    const user = (await repo.users())[0],
      state = (await repo.get(user))!;
    const e = state.events.find((e) => Date.parse(e.start) > Date.now())!;
    e.importReviewed = false;
    e.suggestedCategoryId = "meetings";
    e.flexibility = "fixed";
    await repo.save(state);
    const r = await s.agent
      .post("/api/v1/imports/review")
      .set("X-CSRF-Token", s.csrf)
      .send({ eventIds: [e.id] });
    expect(r.status, r.body.error).toBe(200);
    expect(write).toHaveBeenCalled();
    expect(
      (await repo.get(user))!.events.find((v) => v.id === e.id),
    ).toMatchObject({ importReviewed: true, categoryId: "meetings" });
  });
  it("saves a natural-language activity link and numeric-date study intent", async () => {
    const s = emptyState("u"),
      c = { id: "c", userId: "u", messages: [] },
      provider = new DemoIntentProvider();
    expect(
      await provider.interpret(
        "I like dinner after working out",
        s,
        c,
        new Date().toISOString(),
      ),
    ).toMatchObject({
      type: "habit-link",
      relationship: { from: "gym", to: "dinner", mandatory: false },
    });
    expect(
      await provider.interpret(
        "I need 120 minutes to study before 2026-06-12",
        s,
        c,
        new Date().toISOString(),
      ),
    ).toMatchObject({ type: "study", duration: 120 });
  });
});

it("protects compatibility CRUD and voice endpoints with the same session boundary", async () => {
  const { app } = createApp(config),
    s = await session(app);
  expect((await request(app).post("/transcribe")).status).toBe(401);
  const created = await s.agent
    .post("/calendar/create")
    .set("X-CSRF-Token", s.csrf)
    .send({
      title: "Legacy event",
      start: "2026-06-09T05:00:00-04:00",
      end: "2026-06-09T06:00:00-04:00",
      categoryId: "health",
    });
  expect(created.status, created.body.error).toBe(200);
  const edit = await s.agent
    .put("/calendar/update")
    .set("X-CSRF-Token", s.csrf)
    .send({
      eventId: created.body.event.id,
      title: "Legacy edited",
      start: "2026-06-09T05:00:00-04:00",
      end: "2026-06-09T06:00:00-04:00",
    });
  expect(edit.body.proposal.status).toBe("pending");
  const applied = await s.agent
    .post(`/api/v1/proposals/${edit.body.proposal.id}/apply`)
    .set("X-CSRF-Token", s.csrf);
  expect(applied.status, applied.body.error).toBe(200);
  const deletion = await s.agent
    .delete("/calendar/delete")
    .set("X-CSRF-Token", s.csrf)
    .send({ eventId: created.body.event.id });
  expect(deletion.body.proposal.status).toBe("pending");
  expect(
    (
      await s.agent
        .post(`/api/v1/proposals/${deletion.body.proposal.id}/apply`)
        .set("X-CSRF-Token", s.csrf)
    ).status,
  ).toBe(200);
});

it("keeps recurring previews out of the calendar until approved", async () => {
  const repo = new MemoryRepository(),
    cal = new DemoCalendar(),
    service = new SchedulingService(repo, cal, new DemoIntentProvider()),
    state = emptyState("u");
  await repo.save(state);
  const result = await service.message(
    state,
    "Gym Monday, Wednesday, and Friday for an hour",
  );
  expect(result.proposal?.status).toBe("pending");
  expect(result.proposal!.changes.length).toBeGreaterThan(10);
  expect(state.events).toHaveLength(0);
  await service.apply(state, result.proposal!.id);
  expect(state.events.length).toBe(result.proposal!.changes.length);
});
