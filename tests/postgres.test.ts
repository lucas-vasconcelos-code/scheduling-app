import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PostgresRepository, withUserLock } from "../apps/server/src/store.js";
import { demoState } from "../apps/server/src/demo.js";
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "persists users, scoped metadata, sessions and operation journals across repository instances",
  async () => {
    const db = new PrismaClient({
        datasourceUrl: process.env.TEST_DATABASE_URL,
      }),
      repo = new PostgresRepository(db),
      id = randomUUID(),
      other = randomUUID();
    try {
      const s = demoState(id),
        b = demoState(other);
      await repo.save(s);
      await repo.save(b);
      s.settings.wake = "08:15";
      s.revision++;
      await repo.save(s);
      await repo.session("test-" + id, {
        userId: id,
        csrf: "csrf",
        expiresAt: new Date(Date.now() + 60000),
      });
      await repo.bindGoogle(id, "subject-" + id);
      await repo.session("native-" + id, {
        userId: id,
        csrf: "native-csrf",
        expiresAt: new Date(Date.now() + 60000),
      });
      s.devices.push({
        id: "phone",
        platform: "ios",
        appVersion: "1",
        lastSeen: new Date().toISOString(),
        alerts: [],
      });
      await repo.save(s);
      await repo.journal(id, "operation", { status: "applied", completed: [] });
      await Promise.all(
        [1, 2].map(() =>
          withUserLock(repo, id, async () => {
            const state = (await repo.get(id))!;
            state.revision++;
            await repo.save(state);
          }),
        ),
      );
      expect((await repo.get(id))!.revision).toBe(s.revision + 2);
      const fresh = new PostgresRepository(db);
      expect((await fresh.get(id))?.settings.wake).toBe("08:15");
      expect((await fresh.get(other))?.settings.wake).toBe("07:00");
      expect((await fresh.get(id))?.events.length).toBe(s.events.length);
      expect((await fresh.session("test-" + id))?.userId).toBe(id);
      expect(await fresh.findGoogle("subject-" + id)).toBe(id);
      expect((await fresh.session("native-" + id))?.userId).toBe(id);
      expect((await fresh.get(id))?.devices[0].appVersion).toBe("1");
      await fresh.revoke("native-" + id);
      expect(await fresh.session("native-" + id)).toBeUndefined();
      expect((await fresh.session("test-" + id))?.userId).toBe(id);
      expect(await fresh.journal(other, "operation")).toBeUndefined();
      expect((await fresh.journal(id, "operation"))?.status).toBe("applied");
    } finally {
      await db.user.deleteMany({ where: { id: { in: [id, other] } } });
      await db.$disconnect();
    }
  },
);
