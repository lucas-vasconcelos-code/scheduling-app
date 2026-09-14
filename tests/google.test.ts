import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleCalendar,
  ServiceError,
  mapGoogle,
} from "../apps/server/src/calendar.js";
import { MemoryRepository } from "../apps/server/src/store.js";
import { emptyState } from "../apps/server/src/demo.js";
import { inverse } from "../apps/server/src/service.js";
const raw = (id = "g") => ({
  id,
  etag: "v1",
  summary: "Meeting",
  start: {
    dateTime: "2026-06-09T10:00:00-04:00",
    timeZone: "America/New_York",
  },
  end: { dateTime: "2026-06-09T11:00:00-04:00" },
  description: "Keep my notes",
  location: "Library",
  reminders: {
    useDefault: false,
    overrides: [{ method: "email", minutes: 60 }],
  },
  extendedProperties: { private: { foreign: "keep" } },
});
function setup() {
  const s = emptyState("u");
  const cal = new GoogleCalendar(new MemoryRepository(), {
    clientId: "test",
    clientSecret: "test",
    redirectUri: "http://localhost",
    key: Buffer.alloc(32).toString("base64"),
  });
  const http = vi.spyOn(cal, "request");
  return { s, cal, http };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-08T12:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("Google synchronization", () => {
  it("paginates initial sync and consumes incremental deletions", async () => {
    const { s, cal, http } = setup();
    http
      .mockResolvedValueOnce({ items: [raw()], nextPageToken: "page2" })
      .mockResolvedValueOnce({ items: [raw("g2")], nextSyncToken: "token1" });
    await cal.sync(s);
    expect(s.events).toHaveLength(2);
    expect(http.mock.calls[1][1]).toContain("pageToken=page2");
    http.mockResolvedValueOnce({
      items: [{ id: "g", status: "cancelled" }],
      nextSyncToken: "token2",
    });
    await cal.sync(s);
    expect(http.mock.calls[2][1]).toContain("syncToken=token1");
    expect(s.events.map((e) => e.id)).toEqual(["g2"]);
  });
  it("resynchronizes after 410 without retaining deleted Google events", async () => {
    const { s, cal, http } = setup();
    s.sync.token = "expired";
    s.events = [mapGoogle(raw("stale"), s)!];
    http
      .mockRejectedValueOnce(new ServiceError(410, "expired"))
      .mockResolvedValueOnce({ items: [raw("fresh")], nextSyncToken: "new" });
    await cal.sync(s);
    expect(s.events.map((e) => e.id)).toEqual(["fresh"]);
    expect(http.mock.calls[1][1]).not.toContain("syncToken");
  });
  it("does not advance tokens or lose events if recurrence expansion fails", async () => {
    const { s, cal, http } = setup();
    s.sync.token = "old";
    s.events = [mapGoogle(raw(), s)!];
    const original = structuredClone(s);
    http
      .mockResolvedValueOnce({
        items: [{ ...raw("series"), recurrence: ["RRULE:FREQ=WEEKLY"] }],
        nextSyncToken: "new",
      })
      .mockRejectedValueOnce(new ServiceError(503, "offline"));
    await expect(cal.sync(s)).rejects.toThrow("offline");
    expect(s).toEqual(original);
  });
  it("keeps moved occurrences and omits cancelled exceptions", async () => {
    const { s, cal, http } = setup();
    http
      .mockResolvedValueOnce({
        items: [{ ...raw("series"), recurrence: ["RRULE:FREQ=WEEKLY"] }],
        nextSyncToken: "t",
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...raw("instance"),
            recurringEventId: "series",
            originalStartTime: { dateTime: "2026-06-09T09:00:00-04:00" },
          },
          { id: "cancelled", status: "cancelled" },
        ],
      });
    await cal.sync(s);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].originalStart).toContain("09:00");
    expect(s.events[0].start).toContain("10:00");
  });
  it("refreshes the recurrence horizon even when no master changed", async () => {
    const { s, cal, http } = setup();
    s.sync = {
      token: "t",
      seriesIds: ["series"],
      horizonDate: "2026-06-07",
      labels: "unavailable",
    };
    http
      .mockResolvedValueOnce({ items: [], nextSyncToken: "next" })
      .mockResolvedValueOnce({
        items: [{ ...raw("instance"), recurringEventId: "series" }],
      });
    await cal.sync(s);
    expect(http.mock.calls[1][1]).toContain("/series/instances?");
    expect(s.events).toHaveLength(1);
  });
});
describe("Google writes and labels", () => {
  it("preserves unrelated fields, labels and reminders when updating a meeting", async () => {
    const { s, cal, http } = setup();
    s.sync.labels = "available";
    s.categories.find((c) => c.id === "meetings")!.googleLabelId =
      "meeting-label";
    const before = {
      ...mapGoogle(raw(), s)!,
      categoryId: "meetings",
      importReviewed: true,
    };
    http
      .mockResolvedValueOnce(raw())
      .mockResolvedValueOnce({ ...raw(), etag: "v2" });
    await cal.write(
      s,
      { kind: "update", before, after: { ...before, title: "New title" } },
      "op",
    );
    const [, path, method, payload, etag] = http.mock.calls[1];
    expect(path).toContain("eventLabelVersion=1");
    expect(method).toBe("PUT");
    expect(etag).toBe("v1");
    expect(payload).toMatchObject({
      description: "Keep my notes",
      location: "Library",
      eventLabelId: "meeting-label",
      extendedProperties: { private: { foreign: "keep" } },
      reminders: {
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    });
  });
  it("refuses a stale event before issuing a mutation", async () => {
    const { s, cal, http } = setup();
    const before = mapGoogle(raw(), s)!;
    http.mockResolvedValue({ ...raw(), etag: "external" });
    await expect(
      cal.write(s, { kind: "delete", before }, "op"),
    ).rejects.toMatchObject({ status: 409 });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("retains full event details through deletion and Undo", async () => {
    const { s, cal, http } = setup();
    const before = mapGoogle(raw(), s)!;
    http.mockResolvedValueOnce(raw()).mockResolvedValueOnce({});
    const deletion = await cal.write(s, { kind: "delete", before }, "delete");
    http.mockResolvedValueOnce({ ...raw("restored"), etag: "v2" });
    await cal.write(s, inverse(deletion), "undo");
    expect(http.mock.calls[2][3]).toMatchObject({
      description: "Keep my notes",
      location: "Library",
    });
  });
  it("merges calendar labels and preserves other calendar metadata", async () => {
    const { s, cal, http } = setup();
    http
      .mockResolvedValueOnce({
        etag: "calendar-v1",
        summary: "Personal",
        labelProperties: {
          eventLabels: [
            { id: "foreign", name: "Outside", backgroundColor: "#123456" },
          ],
        },
      })
      .mockResolvedValueOnce({});
    await cal.labels(s);
    expect(http.mock.calls[1][3]).toMatchObject({
      summary: "Personal",
      labelProperties: {
        eventLabels: expect.arrayContaining([
          { id: "foreign", name: "Outside", backgroundColor: "#123456" },
        ]),
      },
    });
    expect(s.sync.labels).toBe("available");
  });
  it("falls back for unsupported label accounts and surfaces competing edits", async () => {
    const { s, cal, http } = setup();
    http.mockRejectedValueOnce(new ServiceError(403, "unsupported"));
    await cal.labels(s);
    expect(s.sync.labels).toBe("unavailable");
    const c = s.categories[0];
    c.googleLabelId = "label";
    c.lastSyncedLabel = { name: c.name, color: c.color };
    c.name = "My edit";
    http.mockResolvedValueOnce({
      labelProperties: {
        eventLabels: [
          { id: "label", name: "External edit", backgroundColor: c.color },
        ],
      },
    });
    await expect(cal.labels(s)).rejects.toMatchObject({ status: 409 });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("rejects unbounded series moves and uses the master etag for a bounded series", async () => {
    const { s, cal, http } = setup();
    const before = { ...mapGoogle(raw("occurrence"), s)!, seriesId: "series" };
    s.events = [before];
    const after = {
      ...before,
      start: "2026-06-09T12:00:00-04:00",
      end: "2026-06-09T13:00:00-04:00",
    };
    http.mockResolvedValueOnce({
      ...raw("series"),
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });
    await expect(cal.seriesChange(s, before, after)).rejects.toMatchObject({
      status: 422,
    });
    http.mockResolvedValueOnce({
      ...raw("series"),
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=1"],
    });
    expect((await cal.seriesChange(s, before, after)).before).toMatchObject({
      googleId: "series",
      etag: "v1",
    });
  });
});
