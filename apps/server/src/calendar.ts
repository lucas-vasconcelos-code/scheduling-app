import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { DateTime } from "luxon";
import type {
  CalendarEvent,
  Category,
  UserState,
  Change,
} from "@aligned/shared";
import type { Repository } from "./store.js";
import { classify } from "./intent.js";

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function encrypt(value: string, key: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  return Buffer.concat([
    iv,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(value: string, key: string) {
  const b = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64"),
      b.subarray(0, 12),
    );
  cipher.setAuthTag(b.subarray(-16));
  return Buffer.concat([
    cipher.update(b.subarray(12, -16)),
    cipher.final(),
  ]).toString();
}
export interface CalendarService {
  sync(state: UserState): Promise<void>;
  write(state: UserState, change: Change, operationId: string): Promise<Change>;
  labels(state: UserState): Promise<void>;
  freeBusy(
    state: UserState,
    start: string,
    end: string,
  ): Promise<{ start: string; end: string }[]>;
  disconnect?(state: UserState): Promise<void>;
  seriesChange?(
    state: UserState,
    before: CalendarEvent,
    after?: CalendarEvent,
  ): Promise<Change>;
}
export class DemoCalendar implements CalendarService {
  async sync(s: UserState) {
    s.sync.at = new Date().toISOString();
  }
  async write(_s: UserState, c: Change, _id: string) {
    return structuredClone(c);
  }
  async labels(s: UserState) {
    s.sync.labels = "unavailable";
  }
  async freeBusy(s: UserState, start: string, end: string) {
    return s.events
      .filter(
        (e) =>
          !e.transparent &&
          Date.parse(e.start) < Date.parse(end) &&
          Date.parse(e.end) > Date.parse(start),
      )
      .map(({ start, end }) => ({ start, end }));
  }
}
export function mergeMeetingReminders(reminders: any) {
  const overrides = Array.isArray(reminders?.overrides)
    ? reminders.overrides
    : [];
  const merged = [
    ...overrides.filter(
      (r: any) => !(r.method === "popup" && r.minutes === 15),
    ),
    { method: "popup", minutes: 15 },
  ];
  if (merged.length > 5)
    throw new ServiceError(
      409,
      "This meeting already has five reminders. Remove one before adding the 15-minute reminder.",
    );
  return { useDefault: false, overrides: merged };
}
export function mergeLabels(existing: any[], categories: Category[]) {
  const merged = existing.map((l) => ({ ...l }));
  for (const c of categories.filter((c) => c.active)) {
    if (!c.googleLabelId) c.googleLabelId = crypto.randomUUID();
    const i = merged.findIndex((l) => l.id === c.googleLabelId),
      label = { id: c.googleLabelId, name: c.name, backgroundColor: c.color };
    if (i >= 0) merged[i] = { ...merged[i], ...label };
    else merged.push(label);
  }
  if (merged.length > 200)
    throw new ServiceError(
      409,
      "Google Calendar’s 200-label limit has been reached. Categories still work in Aligned.",
    );
  return merged;
}
export function mapGoogle(
  raw: any,
  state: UserState,
): CalendarEvent | undefined {
  if (raw.status === "cancelled" || !raw.start || !raw.end) return;
  const old =
      state.events.find((e) => e.googleId === raw.id) ??
      state.events.find(
        (e) =>
          raw.recurringEventId &&
          e.seriesId === raw.recurringEventId &&
          Date.parse(e.start) === Date.parse(raw.start.dateTime),
      ),
    zone = raw.start.timeZone ?? state.settings.timeZone,
    allDay = Boolean(raw.start.date);
  const start =
      raw.start.dateTime ?? DateTime.fromISO(raw.start.date, { zone }).toISO(),
    end = raw.end.dateTime ?? DateTime.fromISO(raw.end.date, { zone }).toISO();
  if (!DateTime.fromISO(start).isValid || !DateTime.fromISO(end).isValid)
    throw new ServiceError(502, "Google returned an event with invalid dates.");
  const label = state.categories.find(
      (c) => c.googleLabelId === raw.eventLabelId,
    ),
    meta = raw.extendedProperties?.private ?? {},
    suggested = classify(raw.summary ?? "Untitled event", state);
  const categoryId =
    label?.id ??
    (state.categories.some((c) => c.id === meta.alignedCategory)
      ? meta.alignedCategory
      : old?.categoryId) ??
    suggested.categoryId;
  const reviewed = old?.importReviewed ?? false;
  return {
    id: old?.id ?? raw.id,
    googleId: raw.id,
    userId: state.userId,
    title: raw.summary ?? "Untitled event",
    start,
    end,
    timeZone: zone,
    categoryId,
    activity: old?.activity ?? meta.alignedActivity ?? suggested.activity,
    priority: old?.priority ?? "medium",
    flexibility: reviewed ? (old?.flexibility ?? "fixed") : "fixed",
    interruptible: reviewed ? (old?.interruptible ?? false) : false,
    allDay,
    transparent: raw.transparency === "transparent",
    etag: raw.etag,
    seriesId: raw.recurringEventId,
    originalStart:
      raw.originalStartTime?.dateTime ??
      (raw.originalStartTime?.date
        ? DateTime.fromISO(raw.originalStartTime.date, { zone }).toISO()
        : undefined),
    recurrence: raw.recurrence,
    importReviewed: reviewed,
    suggestedCategoryId: reviewed ? undefined : suggested.categoryId,
    deadlineId: old?.deadlineId,
    settingsOverrides: old?.settingsOverrides,
    allowOutsideWaking: old?.allowOutsideWaking,
    revision: (old?.revision ?? 0) + (old && old.etag !== raw.etag ? 1 : 0),
  };
}
export class GoogleCalendar implements CalendarService {
  private refreshed = new WeakMap<OAuth2Client, Record<string, unknown>>();
  constructor(
    private repo: Repository,
    private config: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      key: string;
      webhook?: string;
    },
  ) {}
  async client(userId: string) {
    const stored = await this.repo.credentials(userId);
    if (!stored)
      throw new ServiceError(401, "Reconnect Google Calendar to continue.");
    const auth = new OAuth2Client(
        this.config.clientId,
        this.config.clientSecret,
        this.config.redirectUri,
      ),
      tokens = JSON.parse(decrypt(stored, this.config.key));
    auth.setCredentials(tokens);
    auth.on("tokens", (next) => {
      this.refreshed.set(auth, {
        ...tokens,
        ...next,
        refresh_token: next.refresh_token ?? tokens.refresh_token,
      });
    });
    return auth;
  }
  async request(
    userId: string,
    path: string,
    method = "GET",
    data?: unknown,
    etag?: string,
  ) {
    let auth: OAuth2Client | undefined;
    try {
      auth = await this.client(userId);
      const response = await auth.request<any>({
        url: `https://www.googleapis.com/calendar/v3/${path}`,
        method: method as any,
        data,
        timeout: 30000,
        headers: etag ? { "If-Match": etag } : undefined,
      });
      return response.data;
    } catch (error: any) {
      const status =
        error.response?.data?.error === "invalid_grant"
          ? 401
          : (error.status ?? error.response?.status ?? 500);
      throw new ServiceError(
        status,
        status === 401
          ? "Google authorization expired. Please reconnect."
          : status === 412
            ? "This event changed in Google Calendar. Refresh and review a new proposal."
            : status === 429
              ? "Google Calendar is busy. Please retry shortly."
              : (error.response?.data?.error?.message ??
                "Google Calendar could not be reached. No calendar state was invented."),
      );
    } finally {
      const refreshed = auth && this.refreshed.get(auth);
      if (refreshed) {
        // Finish credential persistence before releasing the user's operation lock.
        await this.repo.credentials(
          userId,
          encrypt(JSON.stringify(refreshed), this.config.key),
        );
        this.refreshed.delete(auth!);
      }
    }
  }
  async disconnect(s: UserState) {
    if (s.sync.channelId && s.sync.resourceId)
      await this.request(s.userId, "channels/stop", "POST", {
        id: s.sync.channelId,
        resourceId: s.sync.resourceId,
      }).catch(() => {});
    const encrypted = await this.repo.credentials(s.userId);
    if (encrypted) {
      const tokens = JSON.parse(decrypt(encrypted, this.config.key));
      const token = tokens.refresh_token ?? tokens.access_token;
      if (token) {
        const result = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10000),
        });
        if (!result.ok && result.status !== 400)
          throw new ServiceError(
            503,
            "Google disconnect could not finish. Please retry.",
          );
      }
    }
  }
  async sync(s: UserState) {
    const staged = structuredClone(s);
    await this.syncSnapshot(staged);
    s.events = staged.events;
    s.sync = staged.sync;
    s.revision = staged.revision;
  }
  private async syncSnapshot(s: UserState) {
    const rows: any[] = [];
    let page: string | undefined,
      token = s.sync.token;
    for (let reset = 0; reset < 2; reset++) {
      try {
        do {
          const query = new URLSearchParams({
            maxResults: "2500",
            singleEvents: "false",
            showDeleted: "true",
          });
          if (s.sync.labels === "available")
            query.set("eventLabelVersion", "1");
          if (token) query.set("syncToken", token);
          if (page) query.set("pageToken", page);
          const result = await this.request(
            s.userId,
            `calendars/primary/events?${query}`,
          );
          rows.push(...(result.items ?? []));
          page = result.nextPageToken;
          if (!page) s.sync.token = result.nextSyncToken;
        } while (page);
        break;
      } catch (e) {
        if (e instanceof ServiceError && e.status === 410 && token) {
          token = undefined;
          page = undefined;
          rows.length = 0;
          continue;
        }
        throw e;
      }
    }
    const currentDay = DateTime.now().toISODate()!,
      seriesIds = new Set(token ? (s.sync.seriesIds ?? []) : []);
    if (s.sync.horizonDate !== currentDay)
      for (const id of seriesIds)
        if (!rows.some((r) => r.id === id))
          rows.push({ id, recurrence: ["cached"] });
    const next = token ? [...s.events] : s.events.filter((e) => !e.googleId);
    for (const raw of rows) {
      const i = next.findIndex((e) => e.googleId === raw.id);
      if (i >= 0) next.splice(i, 1);
      if (
        raw.recurrence ||
        (raw.status === "cancelled" && !raw.recurringEventId)
      ) {
        for (let j = next.length - 1; j >= 0; j--)
          if (next[j].seriesId === raw.id) next.splice(j, 1);
      }
      if (raw.status === "cancelled") {
        seriesIds.delete(raw.id);
        continue;
      }
      if (raw.recurrence) {
        seriesIds.add(raw.id);
        let p: string | undefined;
        do {
          const q = new URLSearchParams({
            timeMin: DateTime.now().minus({ days: 180 }).toISO()!,
            timeMax: DateTime.now().plus({ days: 180 }).toISO()!,
            maxResults: "2500",
          });
          if (p) q.set("pageToken", p);
          if (s.sync.labels === "available") q.set("eventLabelVersion", "1");
          const r = await this.request(
            s.userId,
            `calendars/primary/events/${encodeURIComponent(raw.id)}/instances?${q}`,
          );
          for (const instance of r.items ?? []) {
            const mapped = mapGoogle(instance, s);
            if (mapped) {
              const duplicate = next.findIndex(
                (e) => e.googleId === mapped.googleId,
              );
              if (duplicate >= 0) next.splice(duplicate, 1);
              next.push(mapped);
            }
          }
          p = r.nextPageToken;
        } while (p);
      } else {
        const mapped = mapGoogle(raw, s);
        if (mapped) next.push(mapped);
      }
    }
    const changed =
      JSON.stringify(s.events.map((e) => [e.id, e.etag]).sort()) !==
      JSON.stringify(next.map((e) => [e.id, e.etag]).sort());
    s.sync.seriesIds = [...seriesIds];
    s.sync.horizonDate = currentDay;
    s.events = next;
    if (changed) s.revision++;
    s.sync.at = new Date().toISOString();
    delete s.sync.error;
    if (
      this.config.webhook &&
      (!s.sync.channelExpires || s.sync.channelExpires < Date.now() + 3600000)
    ) {
      const channelId = crypto.randomUUID(),
        channelToken = randomBytes(24).toString("hex");
      // Persist authentication before Google can send its initial notification.
      s.sync.pendingChannel = {
        id: channelId,
        token: channelToken,
        expires: Date.now() + 600000,
      };
      await this.repo.save(s);
      const response = await this.request(
        s.userId,
        "calendars/primary/events/watch",
        "POST",
        {
          id: channelId,
          type: "web_hook",
          address: this.config.webhook,
          token: channelToken,
        },
      );
      if (s.sync.channelId && s.sync.resourceId)
        await this.request(s.userId, "channels/stop", "POST", {
          id: s.sync.channelId,
          resourceId: s.sync.resourceId,
        }).catch(() => {});
      delete s.sync.pendingChannel;
      Object.assign(s.sync, {
        channelId,
        channelToken,
        resourceId: response.resourceId,
        channelExpires: Number(response.expiration),
      });
    }
  }
  async labels(s: UserState) {
    try {
      const calendar = await this.request(s.userId, "calendars/primary"),
        existing = calendar.labelProperties?.eventLabels ?? [];
      const previous = JSON.stringify(s.categories);
      for (const c of s.categories) {
        const remote = existing.find((l: any) => l.id === c.googleLabelId);
        if (!remote || !c.lastSyncedLabel) continue;
        const external =
            remote.name !== c.lastSyncedLabel.name ||
            remote.backgroundColor !== c.lastSyncedLabel.color,
          local =
            c.name !== c.lastSyncedLabel.name ||
            c.color !== c.lastSyncedLabel.color;
        if (
          external &&
          local &&
          (remote.name !== c.name || remote.backgroundColor !== c.color)
        )
          throw new ServiceError(
            409,
            `The category “${c.name}” also changed in Google Calendar. Refresh its mapping before syncing.`,
          );
        if (external && !local) {
          c.name = remote.name ?? c.name;
          c.color = remote.backgroundColor;
        }
      }
      const labels = mergeLabels(existing, s.categories);
      if (JSON.stringify(labels) !== JSON.stringify(existing))
        await this.request(
          s.userId,
          "calendars/primary?eventLabelVersion=1",
          "PUT",
          {
            ...calendar,
            labelProperties: {
              ...calendar.labelProperties,
              eventLabels: labels,
            },
          },
          calendar.etag,
        );
      s.categories.forEach((c) => {
        c.lastSyncedLabel = { name: c.name, color: c.color };
      });
      s.sync.labels = "available";
      if (previous !== JSON.stringify(s.categories)) s.revision++;
    } catch (e) {
      if (e instanceof ServiceError && [400, 403, 404].includes(e.status)) {
        s.sync.labels = "unavailable";
        s.sync.error =
          "Google labels are unavailable; your categories still work in Aligned.";
      } else throw e;
    }
  }
  async freeBusy(s: UserState, start: string, end: string) {
    const r = await this.request(s.userId, "freeBusy", "POST", {
      timeMin: start,
      timeMax: end,
      timeZone: s.settings.timeZone,
      items: [{ id: "primary" }],
    });
    const c = r.calendars?.primary;
    if (!c || c.errors?.length)
      throw new ServiceError(502, "Google could not confirm availability.");
    return c.busy ?? [];
  }
  async seriesChange(
    s: UserState,
    before: CalendarEvent,
    after?: CalendarEvent,
  ): Promise<Change> {
    const seriesId = before.seriesId ?? before.googleId;
    if (!seriesId) throw new ServiceError(400, "Recurring series not found.");
    const raw = await this.request(
        s.userId,
        `calendars/primary/events/${encodeURIComponent(seriesId)}`,
      ),
      mapped = mapGoogle(raw, s);
    if (!mapped || !raw.recurrence)
      throw new ServiceError(
        409,
        "This recurring series is no longer available. Refresh your calendar.",
      );
    const master = {
      ...before,
      ...mapped,
      id: before.id,
      googleId: seriesId,
      etag: raw.etag,
      categoryId: before.categoryId,
      activity: before.activity,
      flexibility: before.flexibility,
      interruptible: before.interruptible,
      importReviewed: before.importReviewed,
    };
    if (!after) return { kind: "delete", before: master, externalBefore: raw };
    const old = DateTime.fromISO(before.start).setZone(before.timeZone),
      next = DateTime.fromISO(after.start).setZone(after.timeZone),
      days = Math.round(
        next.startOf("day").diff(old.startOf("day"), "days").days,
      ),
      duration = Date.parse(after.end) - Date.parse(after.start),
      rule = String(
        raw.recurrence.find((r: string) => r.startsWith("RRULE:")) ?? "",
      );
    const movesTime = before.start !== after.start || before.end !== after.end;
    const until = rule.match(/UNTIL=([^;]+)/)?.[1];
    const untilDate = until
      ? DateTime.fromISO(until, { zone: before.timeZone })
      : undefined;
    if (
      movesTime &&
      (!/COUNT=|UNTIL=/.test(rule) ||
        (untilDate &&
          (!untilDate.isValid ||
            untilDate > DateTime.now().plus({ days: 180 }))) ||
        Number(rule.match(/COUNT=(\d+)/)?.[1] ?? 0) >
          s.events.filter((e) => e.seriesId === seriesId).length)
    )
      throw new ServiceError(
        422,
        "The complete series is outside the synchronized horizon. Shorten its date range in Google before moving the entire series, or edit this occurrence.",
      );
    if (days && !/FREQ=(DAILY|WEEKLY)/.test(rule))
      throw new ServiceError(
        422,
        "Date shifts for monthly or yearly series require editing an individual occurrence.",
      );
    const codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const recurrence = raw.recurrence.map((r: string) =>
      days
        ? r.replace(
            /BYDAY=([A-Z,]+)/,
            (_m, list: string) =>
              "BYDAY=" +
              list
                .split(",")
                .map((c) => codes[(codes.indexOf(c) + (days % 7) + 7) % 7])
                .join(","),
          )
        : r,
    );
    const start = DateTime.fromISO(master.start)
      .setZone(after.timeZone)
      .plus({ days })
      .set({ hour: next.hour, minute: next.minute });
    return {
      kind: "update",
      before: master,
      after: {
        ...master,
        ...after,
        id: master.id,
        googleId: seriesId,
        start: start.toISO()!,
        end: new Date(start.toMillis() + duration).toISOString(),
        recurrence,
      },
      externalBefore: raw,
    };
  }
  async write(
    s: UserState,
    change: Change,
    operationId: string,
  ): Promise<Change> {
    const before = change.before,
      after = change.after,
      query = `sendUpdates=none${s.sync.labels === "available" ? "&eventLabelVersion=1" : ""}`;
    const googleId =
      before?.googleId ??
      createHash("sha256").update(operationId).digest("hex").slice(0, 40);
    let raw: any = change.restore ?? {};
    if (before?.googleId)
      raw = await this.request(
        s.userId,
        `calendars/primary/events/${encodeURIComponent(before.googleId)}?${query}`,
      );
    if (before?.etag && raw.etag !== before.etag)
      throw new ServiceError(
        409,
        "The event changed externally. Refresh and try again.",
      );
    if (change.kind === "delete") {
      await this.request(
        s.userId,
        `calendars/primary/events/${encodeURIComponent(googleId)}?${query}`,
        "DELETE",
        undefined,
        raw.etag,
      );
      return { ...change, externalBefore: raw };
    }
    if (!after) throw new ServiceError(400, "Missing proposed event.");
    const c = s.categories.find((c) => c.id === after.categoryId)!;
    const date = (instant: string) =>
      DateTime.fromISO(instant).setZone(after.timeZone).toISODate();
    const payload: any = {
      ...raw,
      summary: after.title,
      start: after.allDay
        ? { date: date(after.start) }
        : { dateTime: after.start, timeZone: after.timeZone },
      end: after.allDay
        ? { date: date(after.end) }
        : { dateTime: after.end, timeZone: after.timeZone },
      extendedProperties: {
        ...raw.extendedProperties,
        private: {
          ...raw.extendedProperties?.private,
          alignedCategory: c.id,
          alignedActivity: after.activity,
        },
      },
      ...(after.recurrence ? { recurrence: after.recurrence } : {}),
    };
    if (change.kind === "create") {
      payload.id = googleId;
      delete payload.etag;
      delete payload.created;
      delete payload.updated;
      delete payload.recurringEventId;
      delete payload.originalStartTime;
      delete payload.status;
    }
    if (c.role === "meetings")
      payload.reminders = mergeMeetingReminders(raw.reminders);
    if (s.sync.labels === "available" && c.googleLabelId) {
      payload.eventLabelId = c.googleLabelId;
      delete payload.colorId;
    }
    let result: any;
    try {
      result = await this.request(
        s.userId,
        `calendars/primary/events${change.kind === "create" ? "" : "/" + encodeURIComponent(googleId)}?${query}`,
        change.kind === "create" ? "POST" : "PUT",
        payload,
        raw.etag,
      );
    } catch (e) {
      if (
        change.kind === "create" &&
        e instanceof ServiceError &&
        e.status === 409
      ) {
        result = await this.request(
          s.userId,
          `calendars/primary/events/${googleId}?${query}`,
        );
        if (
          result.extendedProperties?.private?.alignedActivity !== after.activity
        )
          throw e;
      } else throw e;
    }
    return {
      ...change,
      externalBefore: raw,
      after: { ...after, googleId: result.id, etag: result.etag },
    };
  }
}
