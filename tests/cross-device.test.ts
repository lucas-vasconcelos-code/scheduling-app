import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { OAuth2Client } from "google-auth-library";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/app.js";
import { DemoCalendar, GoogleCalendar } from "../apps/server/src/calendar.js";
import { MemoryRepository } from "../apps/server/src/store.js";
import { emptyState } from "../apps/server/src/demo.js";
import { DemoIntentProvider } from "../apps/server/src/intent.js";
import { environmentConfig } from "../apps/server/src/config.js";
const config = {
  demo: false,
  clientUrl: "http://localhost:8081",
  publicUrl: "http://localhost:3000",
  clientId: "test",
  clientSecret: "test",
  key: Buffer.alloc(32).toString("base64"),
  redirectUri: "http://localhost:3000/auth/callback",
  diagnostics: true,
};
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const repo = new MemoryRepository();
  const runtime = createApp(
    config,
    repo,
    new DemoCalendar(),
    new DemoIntentProvider(),
  );
  vi.spyOn(OAuth2Client.prototype, "getToken").mockResolvedValue({
    tokens: { id_token: "identity", refresh_token: "server-only" },
  } as never);
  vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
    getPayload: () => ({
      sub: "same-google-sub",
      email: "test@example.invalid",
      given_name: "Test",
    }),
  } as never);
  const web = request.agent(runtime.app);
  const start = await web.get("/auth/google");
  const state = new URL(start.headers.location).searchParams.get("state");
  expect(
    (await web.get("/auth/callback").query({ state, code: "web" })).status,
  ).toBe(302);
  const session = (await web.get("/api/v1/session")).body;
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const nativeBrowser = request.agent(runtime.app);
  const nstart = await nativeBrowser.get("/auth/google").query({ challenge });
  const callback = await nativeBrowser.get("/auth/callback").query({
    state: new URL(nstart.headers.location).searchParams.get("state"),
    code: "phone",
  });
  const code = new URL(callback.headers.location).searchParams.get("code");
  const exchange = await request(runtime.app)
    .post("/auth/exchange")
    .send({ code, verifier });
  expect(exchange.status).toBe(200);
  const token = exchange.body.token;
  const phone = (method: "get" | "post" | "patch", path: string) =>
    request(runtime.app)[method](path).set("Authorization", `Bearer ${token}`);
  return { ...runtime, web, phone, session, token, code, verifier };
}
describe("cross-device account and synchronization", () => {
  it("uses one Google subject with independent web/native sessions and shared domain data", async () => {
    const r = await setup();
    expect(await r.repo.users()).toEqual([r.session.userId]);
    expect((await r.phone("get", "/api/v1/session")).body.userId).toBe(
      r.session.userId,
    );
    expect((await r.phone("get", "/api/v1/session")).body.csrf).not.toBe(
      r.session.csrf,
    );
    expect(
      (
        await request(r.app)
          .post("/auth/exchange")
          .send({ code: r.code, verifier: r.verifier })
      ).status,
    ).toBe(401);
    await r.web
      .patch("/api/v1/settings")
      .set("X-CSRF-Token", r.session.csrf)
      .send({ wake: "08:00" })
      .expect(200);
    expect((await r.phone("get", "/api/v1/state")).body.settings.wake).toBe(
      "08:00",
    );
    await r
      .phone("patch", "/api/v1/settings")
      .send({ focusMinutes: 75 })
      .expect(200);
    expect((await r.web.get("/api/v1/state")).body.settings.focusMinutes).toBe(
      75,
    );
    await r
      .phone("post", "/api/v1/messages")
      .send({ message: "I hate doing homework after 9 PM" })
      .expect(200);
    const shared = (await r.web.get("/api/v1/state")).body;
    expect(
      shared.preferences.some((p: any) => p.statement.includes("homework")),
    ).toBe(true);
    expect(shared.conversations.length).toBeGreaterThan(0);
    await r.close();
  });
  it("propagates journaled web and phone calendar creates to the other session", async () => {
    const r = await setup();
    for (const [client, title, hour] of [
      ["web", "Laptop event", "15"],
      ["phone", "Phone event", "18"],
    ]) {
      const operation =
        client === "web"
          ? r.web.post("/api/v1/events").set("X-CSRF-Token", r.session.csrf)
          : r.phone("post", "/api/v1/events");
      const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const result = await operation.send({
        title,
        start: `${day}T${hour}:00:00-04:00`,
        end: `${day}T${hour}:30:00-04:00`,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      const state = await (client === "web"
        ? r.phone("get", "/api/v1/state")
        : r.web.get("/api/v1/state"));
      expect(state.body.events.some((e: any) => e.title === title)).toBe(true);
    }
    await r.close();
  });
  it("logs out only the phone and its device; disconnect is separate and preserves app data", async () => {
    const r = await setup();
    await r
      .phone("post", "/api/v1/devices")
      .send({
        id: "phone-install",
        platform: "ios",
        token: "ExpoPushToken[test]",
        appVersion: "1",
        registrations: [],
      })
      .expect(200);
    const state = (await r.web.get("/api/v1/state")).body;
    expect(state.devices[0].token).toBeUndefined();
    expect(state.devices[0].sessionHash).toBeUndefined();
    await r.phone("post", "/api/v1/logout").expect(200);
    await r.phone("get", "/api/v1/session").expect(401);
    await r.web.get("/api/v1/session").expect(200);
    expect(await r.repo.credentials(r.session.userId)).toBeTruthy();
    expect((await r.repo.get(r.session.userId))!.devices).toHaveLength(0);
    await r.web
      .post("/api/v1/google/disconnect")
      .set("X-CSRF-Token", r.session.csrf)
      .expect(200);
    expect(await r.repo.credentials(r.session.userId)).toBeUndefined();
    expect((await r.web.get("/api/v1/state")).body.connected).toBe(false);
    await r.close();
  });
  it("authenticates SSE, delivers own changes, and excludes another user's changes", async () => {
    const r = await setup();
    await request(r.app).get("/api/v1/changes").expect(401);
    const server = r.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const abort = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/changes`, {
        headers: { Authorization: `Bearer ${r.token}` },
        signal: abort.signal,
      });
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const reader = response.body!.getReader();
      await reader.read();
      expect(r.broker.count(r.session.userId)).toBe(1);
      expect(r.broker.count("user-b")).toBe(0);
      r.broker.publish("user-b");
      await r.web
        .patch("/api/v1/settings")
        .set("X-CSRF-Token", r.session.csrf)
        .send({ wake: "09:00" });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: change",
      );
    } finally {
      abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await r.close();
    }
  });
  it("acknowledges watches before sync, persists external changes, then invalidates the owner", async () => {
    const repo = new MemoryRepository(),
      s = emptyState("owner");
    s.sync = {
      labels: "unknown",
      token: "before",
      channelId: "channel",
      channelToken: "secret",
      resourceId: "resource",
    };
    await repo.save(s);
    await repo.credentials(s.userId, "test");
    const cal = new GoogleCalendar(repo, {
      clientId: "test",
      clientSecret: "test",
      redirectUri: "http://localhost",
      key: config.key,
    });
    let release!: (v: any) => void;
    vi.spyOn(cal, "request").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const r = createApp(config, repo, cal, new DemoIntentProvider());
    const owner = vi.fn(),
      foreign = vi.fn();
    r.broker.subscribe("owner", owner);
    r.broker.subscribe("other", foreign);
    await request(r.app)
      .post("/api/v1/google/webhook")
      .set({ "x-goog-channel-id": "channel", "x-goog-channel-token": "wrong" })
      .expect(403);
    await request(r.app)
      .post("/api/v1/google/webhook")
      .set({
        "x-goog-channel-id": "channel",
        "x-goog-channel-token": "secret",
        "x-goog-resource-id": "resource",
      })
      .expect(204);
    expect(owner).not.toHaveBeenCalled();
    release({
      items: [
        {
          id: "external",
          etag: "v1",
          summary: "Google change",
          start: { dateTime: "2026-09-14T12:00:00Z" },
          end: { dateTime: "2026-09-14T13:00:00Z" },
        },
      ],
      nextSyncToken: "after",
    });
    await r.close();
    expect((await repo.get("owner"))!.events[0].title).toBe("Google change");
    expect((await repo.get("owner"))!.sync.token).toBe("after");
    expect(owner).toHaveBeenCalledOnce();
    expect(foreign).not.toHaveBeenCalled();
  });
  it("serves the SPA without swallowing protected or unknown API/auth routes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aligned-web-"));
    try {
      await writeFile(join(dir, "index.html"), "<html>Aligned export</html>");
      const { app } = createApp({ ...config, demo: true, webRoot: dir });
      expect(
        (await request(app).get("/calendar").set("Accept", "text/html")).text,
      ).toContain("Aligned export");
      for (const path of ["/api/missing", "/auth/missing", "/health/missing"]) {
        const response = await request(app)
          .get(path)
          .set("Accept", "text/html");
        expect(response.headers["content-type"]).toContain("application/json");
      }
      await request(app).get("/health").expect(200);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
  it("validates production mode, HTTPS, database, and same-origin configuration", () => {
    expect(() => environmentConfig({ NODE_ENV: "production" })).toThrow(
      "APP_MODE",
    );
    expect(() => environmentConfig({ APP_MODE: "google" })).toThrow(
      "DATABASE_URL",
    );
    expect(() =>
      environmentConfig({
        APP_MODE: "demo",
        NODE_ENV: "production",
        PUBLIC_URL: "http://localhost",
      }),
    ).toThrow("HTTPS");
    expect(
      environmentConfig({
        APP_MODE: "google",
        NODE_ENV: "production",
        PUBLIC_URL: "https://aligned.example",
        DATABASE_URL: "postgresql://test",
      }).clientUrl,
    ).toBe("https://aligned.example");
  });
});

it("persists watch authentication before registration and replaces the old channel", async () => {
  const repo = new MemoryRepository(),
    s = emptyState("watch-owner");
  s.sync = {
    labels: "unknown",
    channelId: "old",
    channelToken: "old-secret",
    resourceId: "old-resource",
    channelExpires: 1,
  };
  await repo.save(s);
  const cal = new GoogleCalendar(repo, {
    clientId: "test",
    clientSecret: "test",
    key: config.key,
    redirectUri: config.redirectUri,
    webhook: "https://example.invalid/api/v1/google/webhook",
  });
  const calls: string[] = [];
  vi.spyOn(cal, "request").mockImplementation(
    async (_id, path, _method, body: any) => {
      calls.push(path);
      if (path.endsWith("/watch")) {
        const persisted = (await repo.get(s.userId))!.sync.pendingChannel!;
        expect(persisted.id).toBe(body.id);
        expect(persisted.token).toBe(body.token);
        expect(persisted.expires).toBeGreaterThan(Date.now());
        return {
          resourceId: "new-resource",
          expiration: String(Date.now() + 86400000),
        };
      }
      if (path === "channels/stop") {
        expect(body.id).toBe("old");
        return {};
      }
      return { items: [], nextSyncToken: "new-sync" };
    },
  );
  await cal.sync(s);
  expect(s.sync.resourceId).toBe("new-resource");
  expect(s.sync.pendingChannel).toBeUndefined();
  expect(calls.indexOf("channels/stop")).toBeGreaterThan(
    calls.indexOf("calendars/primary/events/watch"),
  );
});
