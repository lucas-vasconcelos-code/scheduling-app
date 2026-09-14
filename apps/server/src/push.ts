import { setTimeout, clearTimeout } from "node:timers";
import type { Repository } from "./store.js";
/** Best-effort data-only hints. Foreground refresh and polling remain authoritative. */
export class PushInvalidator {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private repo: Repository,
    private enabled: boolean,
  ) {}
  changed(userId: string) {
    if (!this.enabled || this.timers.has(userId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(userId);
      void this.deliver(userId).catch(() => {});
    }, 1500);
    this.timers.set(userId, timer);
  }
  private async deliver(userId: string) {
    const s = await this.repo.get(userId);
    const tokens = [
      ...new Set(
        s?.devices
          .filter((d) => d.token && d.sessionHash)
          .map((d) => d.token!) ?? [],
      ),
    ];
    for (let i = 0; i < tokens.length; i += 100) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(
          tokens
            .slice(i, i + 100)
            .map((to) => ({
              to,
              data: { type: "aligned.changed" },
              contentAvailable: true,
              _contentAvailable: true,
              ttl: 300,
            })),
        ),
        signal: AbortSignal.timeout(10000),
      });
    }
  }
  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
