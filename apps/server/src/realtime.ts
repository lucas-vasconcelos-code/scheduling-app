import { setInterval } from "node:timers";
import type { Response } from "express";
import { createHash } from "node:crypto";
import type { UserState } from "@aligned/shared";
import { withUserLock, type Repository } from "./store.js";
import type { SchedulingService } from "./service.js";

export interface ChangeBroker {
  subscribe(userId: string, listener: () => void): () => void;
  publish(userId: string): void;
  count(userId: string): number;
}
/** Replace with a shared broker before running more than one server instance. */
export class LocalChangeBroker implements ChangeBroker {
  private listeners = new Map<string, Set<() => void>>();
  subscribe(userId: string, listener: () => void) {
    const group = this.listeners.get(userId) ?? new Set();
    group.add(listener);
    this.listeners.set(userId, group);
    return () => {
      group.delete(listener);
      if (!group.size) this.listeners.delete(userId);
    };
  }
  publish(userId: string) {
    for (const listener of this.listeners.get(userId) ?? []) listener();
  }
  count(userId: string) {
    return this.listeners.get(userId)?.size ?? 0;
  }
}
export const stateFingerprint = (s: UserState) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        events: s.events,
        settings: s.settings,
        preferences: s.preferences,
        categories: s.categories,
        habits: s.habits,
        relationships: s.relationships,
        deadlines: s.deadlines,
        conversations: s.conversations,
        proposals: s.proposals,
        error: s.sync.error,
      }),
    )
    .digest("hex");

export class SyncQueue {
  private jobs = new Map<string, Promise<void>>();
  private dirty = new Set<string>();
  private stopping = false;
  constructor(
    private repo: Repository,
    private service: SchedulingService,
    private changed: (id: string) => void,
  ) {}
  enqueue(id: string): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.dirty.add(id);
    const active = this.jobs.get(id);
    if (active) return active;
    const job = Promise.resolve()
      .then(async () => {
        while (this.dirty.delete(id)) {
          await withUserLock(this.repo, id, async () => {
            const s = await this.service.state(id),
              before = stateFingerprint(s);
            if (!(await this.repo.credentials(id))) return;
            try {
              await this.service.sync(s);
            } catch (error) {
              if ((error as { status?: number }).status === 401) {
                await this.repo.disconnect(id);
                delete s.sync.channelId;
                delete s.sync.channelToken;
                delete s.sync.resourceId;
                delete s.sync.channelExpires;
                delete s.sync.pendingChannel;
              }
              s.sync.error =
                "Calendar refresh failed. Try Sync now or reconnect Google.";
              await this.repo.save(s);
            }
            if (before !== stateFingerprint(s)) this.changed(id);
          });
        }
      })
      .catch(() => {
        /* Persisted sync tokens and periodic polling repair a failed job. */
      })
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    return job;
  }
  async close() {
    this.stopping = true;
    await Promise.allSettled(this.jobs.values());
  }
}

export function streamChanges(
  res: Response,
  broker: ChangeBroker,
  userId: string,
  valid: () => Promise<boolean>,
) {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = () => {
    if (!res.destroyed && !res.write("event: change\ndata: {}\n\n")) res.end();
  };
  const unsubscribe = broker.subscribe(userId, send);
  send(); // Always refresh after reconnect; no domain data or credentials in stream.
  const heartbeat = setInterval(() => {
    void valid()
      .then((ok) => {
        if (!ok) res.end();
        else res.write(": keepalive\n\n");
      })
      .catch(() => res.end());
  }, 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
