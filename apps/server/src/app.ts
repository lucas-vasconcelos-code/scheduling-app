import express from "express";
import { resolve } from "node:path";
import {
  LocalChangeBroker,
  SyncQueue,
  streamChanges,
  type ChangeBroker,
} from "./realtime.js";
import { PushInvalidator } from "./push.js";
import cors from "cors";
import multer from "multer";
import { tmpdir } from "node:os";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { DateTime } from "luxon";
import { z } from "zod";
import {
  settingsSchema,
  categorySchema,
  eventSchema,
  preferenceSchema,
  habitSchema,
  relationshipSchema,
  deadlineSchema,
  timezone,
} from "@aligned/shared";
import { alignment, meetingAlerts, learnHabits } from "@aligned/scheduler";
import {
  MemoryRepository,
  PostgresRepository,
  withUserLock,
  type Repository,
} from "./store.js";
import {
  DemoCalendar,
  GoogleCalendar,
  ServiceError,
  encrypt,
  decrypt,
  type CalendarService,
} from "./calendar.js";
import {
  DemoIntentProvider,
  GeminiIntentProvider,
  type IntentProvider,
} from "./intent.js";
import { SchedulingService, inputFor } from "./service.js";
import { demoState, emptyState } from "./demo.js";
import { transcribe } from "./transcribe.js";
import { ConfigurationError } from "./startup-errors.js";
export interface Config {
  demo: boolean;
  clientUrl: string;
  publicUrl: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  key?: string;
  geminiKey?: string;
  geminiModel?: string;
  webhook?: string;
  legacyClientUrl?: string;
  webRoot?: string;
  diagnostics?: boolean;
  pushEnabled?: boolean;
}
const cookie = (req: express.Request, key: string) =>
  req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(key + "="))
    ?.slice(key.length + 1);
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
export function createApp(
  config: Config,
  repo: Repository = config.demo
    ? new MemoryRepository()
    : new PostgresRepository(),
  calendar?: CalendarService,
  intents?: IntentProvider,
  broker: ChangeBroker = new LocalChangeBroker(),
) {
  if (!config.demo) {
    for (const [name, value] of Object.entries({
      CLIENT_ID: config.clientId,
      CLIENT_SECRET: config.clientSecret,
      TOKEN_ENCRYPTION_KEY: config.key,
    }))
      if (!value) throw new ConfigurationError(`Google mode requires ${name}.`);
    if (Buffer.from(config.key!, "base64").length !== 32)
      throw new ConfigurationError(
        "TOKEN_ENCRYPTION_KEY must decode from base64 to exactly 32 bytes.",
      );
  }
  const app = express(),
    cal: CalendarService =
      calendar ??
      (config.demo
        ? new DemoCalendar()
        : new GoogleCalendar(repo, {
            clientId: config.clientId!,
            clientSecret: config.clientSecret!,
            redirectUri: config.redirectUri!,
            key: config.key!,
            webhook: config.webhook,
          })),
    provider =
      intents ??
      (config.demo
        ? new DemoIntentProvider()
        : config.geminiKey
          ? new GeminiIntentProvider(
              config.geminiKey,
              config.geminiModel ?? "gemini-2.5-flash",
            )
          : {
              async interpret() {
                throw new ServiceError(
                  503,
                  "Gemini is not configured. You can still use the event editor.",
                );
              },
            }),
    service = new SchedulingService(repo, cal, provider);
  const streams = new Set<express.Response>();
  const push = new PushInvalidator(repo, Boolean(config.pushEnabled));
  const changed = (id: string) => {
    broker.publish(id);
    push.changed(id);
  };
  const syncQueue = new SyncQueue(repo, service, changed, (s) => cal.labels(s));
  const rejectDuringSync: express.RequestHandler = (_req, _res, next) => {
    if (syncQueue.isActive(_res.locals.userId))
      return next(
        new ServiceError(
          409,
          "Google Calendar is still synchronizing. Wait for the current import to finish, then try again.",
        ),
      );
    next();
  };
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const allowedOrigins = [
    config.clientUrl,
    config.publicUrl,
    ...(config.legacyClientUrl
      ? [config.legacyClientUrl]
      : config.demo
        ? ["http://localhost:5173"]
        : []),
  ];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      !allowedOrigins.includes(req.headers.origin)
    )
      return next(new ServiceError(403, "Origin not allowed."));
    next();
  });
  const limits = new Map<string, { count: number; until: number }>();
  app.use(async (req, _res, next) => {
    const credential = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : cookie(req, "aligned_session");
    const authenticated = credential
      ? await repo.session(credential)
      : undefined;
    const key = authenticated
        ? "session:" + sha(credential!)
        : "ip:" + (req.ip ?? "unknown"),
      now = Date.now(),
      bucket = limits.get(key);
    if (!bucket || bucket.until < now)
      limits.set(key, { count: 1, until: now + 60000 });
    else if (++bucket.count > 180)
      return next(
        new ServiceError(429, "Too many requests. Please wait a moment."),
      );
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    next();
  });
  const oauthPending = new Map<
      string,
      { expires: number; verifier: string; nativeChallenge?: string }
    >(),
    exchanges = new Map<
      string,
      { expires: number; userId: string; challenge: string }
    >();
  const setSession = async (res: express.Response, userId: string) => {
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(24).toString("base64url");
    await repo.session(token, {
      userId,
      csrf,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    res.cookie("aligned_session", token, {
      httpOnly: true,
      secure: config.publicUrl.startsWith("https:"),
      sameSite: "lax",
      maxAge: 30 * 86400000,
      path: "/",
    });
    return { token, csrf };
  };
  app.get("/health", (_req, res) =>
    res.json({ ok: true, mode: config.demo ? "demo" : "google" }),
  );
  app.get("/api/v1/config", (_req, res) =>
    res.json({
      demo: config.demo,
      googleConfigured: Boolean(config.clientId),
      voiceUpload: Boolean(
        process.env.WHISPER_CLI && process.env.WHISPER_MODEL,
      ),
    }),
  );
  app.post("/api/v1/demo", async (req, res) => {
    if (!config.demo) throw new ServiceError(404, "Demo mode is disabled.");
    const zone = timezone.parse(req.body.timeZone ?? "America/New_York"),
      userId = randomUUID(),
      s = demoState(userId, zone);
    s.habits = learnHabits(inputFor(s));
    await repo.save(s);
    const session = await setSession(res, userId);
    res.json({ ...session, userId });
  });
  app.get("/auth/google", async (req, res) => {
    if (config.demo)
      throw new ServiceError(
        409,
        "This server is running in demo mode. Start it with APP_MODE=google and your Google/PostgreSQL configuration to connect a real account.",
      );
    if (!config.clientId || !config.clientSecret)
      throw new ServiceError(
        503,
        "Configure Google OAuth to connect a real calendar. You can use demo mode now.",
      );
    const auth = new OAuth2Client(
        config.clientId,
        config.clientSecret,
        config.redirectUri,
      ),
      state = randomBytes(32).toString("base64url"),
      pkce = await auth.generateCodeVerifierAsync();
    const challenge = req.query.challenge
      ? z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .parse(req.query.challenge)
      : undefined;
    for (const [id, entry] of oauthPending)
      if (entry.expires < Date.now()) oauthPending.delete(id);
    for (const [id, entry] of exchanges)
      if (entry.expires < Date.now()) exchanges.delete(id);
    oauthPending.set(state, {
      expires: Date.now() + 600000,
      verifier: pkce.codeVerifier,
      nativeChallenge: challenge,
    });
    res.cookie("aligned_oauth", state, {
      httpOnly: true,
      secure: config.publicUrl.startsWith("https:"),
      sameSite: "lax",
      maxAge: 600000,
      path: "/auth",
    });
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256" as any,
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events.owned",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.calendars",
      ],
    });
    res.redirect(url);
  });
  app.get("/auth/callback", async (req, res) => {
    const state = z.string().parse(req.query.state),
      pending = oauthPending.get(state);
    oauthPending.delete(state);
    if (
      !pending ||
      pending.expires < Date.now() ||
      cookie(req, "aligned_oauth") !== state
    )
      throw new ServiceError(
        403,
        "Sign-in expired. Start Google sign-in again.",
      );
    if (req.query.error) {
      res.clearCookie("aligned_oauth", { path: "/auth" });
      return res.redirect(
        pending.nativeChallenge
          ? "aligned://auth?error=cancelled"
          : config.clientUrl + "?signin=cancelled",
      );
    }
    const auth = new OAuth2Client(
        config.clientId,
        config.clientSecret,
        config.redirectUri,
      ),
      { tokens } = await auth.getToken({
        code: z.string().parse(req.query.code),
        codeVerifier: pending.verifier,
      });
    if (!tokens.id_token)
      throw new ServiceError(401, "Google did not return an identity.");
    const ticket = await auth.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      }),
      identity = ticket.getPayload();
    if (!identity?.sub)
      throw new ServiceError(401, "Google identity could not be verified.");
    const userId = await withUserLock(
      repo,
      "identity:" + identity.sub,
      async () => {
        const userId = (await repo.findGoogle(identity.sub)) ?? randomUUID();
        let s = await repo.get(userId);
        if (!s) {
          s = emptyState(userId, identity.given_name ?? "Your");
          await repo.save(s);
          await repo.bindGoogle(userId, identity.sub);
        }
        s.sync.email = identity.email;
        await repo.save(s);
        const previous = await repo.credentials(userId),
          old = previous ? JSON.parse(decrypt(previous, config.key!)) : {};
        if (!tokens.refresh_token && !old.refresh_token)
          throw new ServiceError(
            401,
            "Google did not provide offline access. Reconnect and grant calendar access.",
          );
        await repo.credentials(
          userId,
          encrypt(
            JSON.stringify({
              ...old,
              ...tokens,
              refresh_token: tokens.refresh_token ?? old.refresh_token,
            }),
            config.key!,
          ),
        );
        return userId;
      },
    );
    void syncQueue.enqueue(userId);
    res.clearCookie("aligned_oauth", { path: "/auth" });
    if (pending.nativeChallenge) {
      const code = randomBytes(32).toString("base64url");
      exchanges.set(code, {
        expires: Date.now() + 60000,
        userId,
        challenge: pending.nativeChallenge,
      });
      res.redirect(`aligned://auth?code=${code}`);
    } else {
      await setSession(res, userId);
      res.redirect(config.clientUrl);
    }
  });
  app.post("/auth/exchange", async (req, res) => {
    const body = z
        .object({ code: z.string(), verifier: z.string().min(43).max(128) })
        .parse(req.body),
      exchange = exchanges.get(body.code);
    exchanges.delete(body.code);
    if (
      !exchange ||
      exchange.expires < Date.now() ||
      sha(body.verifier) !== exchange.challenge
    )
      throw new ServiceError(401, "Sign-in exchange expired or invalid.");
    res.json(await setSession(res, exchange.userId));
  });
  app.post("/api/v1/google/webhook", async (req, res) => {
    for (const userId of await repo.users()) {
      const s = await repo.get(userId);
      if (!s) continue;
      const id = req.headers["x-goog-channel-id"],
        pending = s.sync.pendingChannel;
      const isPending =
        pending && pending.id === id && pending.expires > Date.now();
      if (s.sync.channelId !== id && !isPending) continue;
      const token = Buffer.from(
        String(req.headers["x-goog-channel-token"] ?? ""),
      );
      const expected = Buffer.from(
        isPending ? pending!.token : (s.sync.channelToken ?? ""),
      );
      if (
        !expected.length ||
        token.length !== expected.length ||
        !timingSafeEqual(token, expected)
      )
        break;
      if (
        !isPending &&
        s.sync.resourceId &&
        req.headers["x-goog-resource-id"] !== s.sync.resourceId
      )
        break;
      res.status(204).end();
      void syncQueue.enqueue(userId);
      return;
    }
    throw new ServiceError(403, "Unknown notification channel.");
  });
  // Public web routes come before API authentication; reserved paths never become HTML.
  if (config.webRoot) {
    const root = resolve(config.webRoot);
    app.use((req, res, next) => {
      if (
        /^\/(api|auth|health|ai|transcribe|checkSignedIn|calendar\/(events|create|update|delete))(\/|$)/.test(
          req.path,
        ) ||
        !["GET", "HEAD"].includes(req.method)
      )
        return next();
      express.static(root)(req, res, () => {
        if (!req.accepts("html")) return next();
        res.sendFile(resolve(root, "index.html"));
      });
    });
  }
  app.use(async (req, res, next) => {
    try {
      const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined;
      const token = bearer ?? cookie(req, "aligned_session");
      const session = token ? await repo.session(token) : undefined;
      if (!session)
        throw new ServiceError(401, "Sign in or start the demo to continue.");
      if (
        !bearer &&
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers["x-csrf-token"] !== session.csrf
      )
        throw new ServiceError(403, "Refresh the app to renew your session.");
      res.locals = {
        ...res.locals,
        userId: session.userId,
        csrf: session.csrf,
        token,
      };
      next();
    } catch (e) {
      next(e);
    }
  });
  const read = async (res: express.Response) =>
    service.state(res.locals.userId);
  const mutate =
    (
      fn: (
        req: express.Request,
        res: express.Response,
        s: Awaited<ReturnType<typeof read>>,
      ) => Promise<unknown>,
    ): express.RequestHandler =>
    async (req, res, next) => {
      try {
        await withUserLock(repo, res.locals.userId, async () =>
          fn(req, res, await read(res)),
        );
      } catch (e) {
        next(e);
      } finally {
        // Journals/recovery may also change after a failed remote operation.
        if (req.path !== "/api/v1/devices") changed(res.locals.userId);
      }
    };
  app.get(["/checkSignedIn", "/api/v1/session"], async (_req, res) => {
    const s = await read(res);
    res.json({
      userId: s.userId,
      name: s.name,
      csrf: res.locals.csrf,
      demo: config.demo,
    });
  });
  app.get("/api/v1/changes", (req, res) => {
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
      throw new ServiceError(403, "Origin not allowed.");
    streams.add(res);
    res.on("close", () => streams.delete(res));
    streamChanges(res, broker, res.locals.userId, async () =>
      Boolean(await repo.session(res.locals.token)),
    );
  });
  app.get("/api/v1/diagnostics", async (_req, res) => {
    if (!config.diagnostics) throw new ServiceError(404, "Not found.");
    const s = await read(res);
    res.json({
      userId: s.userId,
      connected: Boolean(await repo.credentials(s.userId)),
      lastSync: s.sync.at,
      hasSyncToken: Boolean(s.sync.token),
      channelExpires: s.sync.channelExpires,
      channelActive: Boolean(
        s.sync.channelExpires && s.sync.channelExpires > Date.now(),
      ),
      activeStreams: broker.count(s.userId),
      devices: s.devices.map(
        ({
          id,
          platform,
          appVersion,
          lastSeen,
          capability,
          registrations,
          pushStatus,
        }) => ({
          id,
          platform,
          appVersion,
          lastSeen,
          capability,
          registrations,
          pushStatus,
        }),
      ),
    });
  });
  app.post(
    "/api/v1/google/disconnect",
    mutate(async (_req, res, s) => {
      await cal.disconnect?.(s);
      await repo.disconnect(s.userId);
      s.sync = {
        email: s.sync.email,
        labels: s.sync.labels,
        error: "Google is disconnected. Reconnect to update your calendar.",
      };
      for (const d of s.devices) {
        d.alerts = [];
        d.registrations = [];
      }
      await repo.save(s);
      res.json({ ok: true });
    }),
  );
  app.post("/api/v1/logout", async (_req, res) => {
    await withUserLock(repo, res.locals.userId, async () => {
      const s = await read(res);
      s.devices = s.devices.filter(
        (d) => d.sessionHash !== sha(res.locals.token),
      );
      await repo.save(s);
      await repo.revoke(res.locals.token);
    });
    changed(res.locals.userId);
    res.clearCookie("aligned_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/v1/state", async (_req, res) => {
    const s = await read(res),
      now = DateTime.now().setZone(s.settings.timeZone),
      input = inputFor(s);
    res.json({
      ...s,
      sync: {
        at: s.sync.at,
        error: s.sync.error,
        labels: s.sync.labels,
        email: s.sync.email,
      },
      connected: config.demo || Boolean(await repo.credentials(s.userId)),
      devices: s.devices.map(
        ({ token: _token, sessionHash: _hash, ...device }) => device,
      ),
      demo: config.demo,
      alerts:
        config.demo || (await repo.credentials(s.userId))
          ? meetingAlerts(input)
          : [],
      alignment: {
        today: alignment(
          input,
          now.startOf("day").toISO()!,
          now.endOf("day").toISO()!,
        ),
        week: alignment(
          input,
          now.startOf("week").toISO()!,
          now.endOf("week").toISO()!,
        ),
        days: Array.from({ length: 7 }, (_, i) => {
          const d = now.startOf("week").plus({ days: i });
          return {
            date: d.toISODate(),
            ...alignment(input, d.toISO()!, d.plus({ days: 1 }).toISO()!),
          };
        }),
      },
    });
  });
  app.post(
    "/api/v1/demo/reset",
    mutate(async (_req, res, s) => {
      if (!config.demo) throw new ServiceError(404, "Demo is disabled.");
      await repo.save(demoState(s.userId, s.settings.timeZone));
      res.json({ ok: true });
    }),
  );
  app.post("/api/v1/sync", async (_req, res, next) => {
    try {
      // Do not acquire the per-user operation lock here. A full import may
      // already hold it; the queue coalesces this request and runs it next.
      void syncQueue.enqueue(res.locals.userId);
      res.status(202).json({ ok: true, queued: true });
    } catch (error) {
      next(error);
    }
  });
  app.post(
    ["/api/v1/messages", "/ai"],
    mutate(async (req, res, s) => {
      const b = z
        .object({
          message: z.string().trim().min(1).max(4000),
          conversationId: z.string().optional(),
        })
        .parse(req.body);
      await service.sync(s);
      res.json(await service.message(s, b.message, b.conversationId));
    }),
  );
  app.post(
    "/api/v1/proposals/:id/apply",
    mutate(async (req, res, s) =>
      res.json(await service.apply(s, String(req.params.id))),
    ),
  );
  app.post(
    "/api/v1/proposals/:id/undo",
    mutate(async (req, res, s) =>
      res.json(await service.undo(s, String(req.params.id))),
    ),
  );
  app.post(
    "/api/v1/proposals/:id/reject",
    mutate(async (req, res, s) => {
      const p = s.proposals.find((p) => p.id === req.params.id);
      if (!p) throw new ServiceError(404, "Proposal not found.");
      if (p.status !== "pending")
        throw new ServiceError(409, "Proposal is no longer pending.");
      p.status = "rejected";
      await repo.save(s);
      res.json(p);
    }),
  );
  app.get(["/api/v1/events", "/calendar/events"], async (req, res) => {
    const s = await read(res),
      from = String(req.query.start ?? new Date().toISOString()),
      to = String(req.query.end ?? DateTime.now().plus({ days: 90 }).toISO());
    res.json({
      events: s.events.filter(
        (e) =>
          DateTime.fromISO(e.end).toMillis() >
            DateTime.fromISO(from).toMillis() &&
          DateTime.fromISO(e.start).toMillis() <
            DateTime.fromISO(to).toMillis(),
      ),
    });
  });
  app.post(
    ["/api/v1/events", "/calendar/create"],
    rejectDuringSync,
    mutate(async (req, res, s) => {
      if (
        req.body.categoryId &&
        !s.categories.some((c) => c.id === req.body.categoryId && c.active)
      )
        throw new ServiceError(400, "Choose an active category.");
      const cat =
        s.categories.find((c) => c.id === req.body.categoryId) ??
        s.categories.find((c) => c.active)!;
      const after = eventSchema.parse({
        ...req.body,
        allowOutsideWaking: true,
        settingsOverrides: Object.fromEntries(
          (["flexibility", "priority", "interruptible"] as const)
            .filter((key) => req.body[key] !== undefined)
            .map((key) => [key, req.body[key]]),
        ),
        id: randomUUID(),
        userId: s.userId,
        timeZone: req.body.timeZone ?? s.settings.timeZone,
        categoryId: cat.id,
        activity: req.body.activity ?? cat.role,
        priority: req.body.priority ?? cat.priority,
        flexibility: req.body.flexibility ?? cat.flexibility,
        interruptible: req.body.interruptible ?? cat.interruptible,
        importReviewed: true,
      });
      const p = service.proposal(
        s,
        "Create event",
        [{ kind: "create", after }],
        "Your event details.",
      );
      await repo.save(s);
      const result = await service.apply(s, p.id);
      res.json({ proposal: result, event: result.appliedChanges?.[0].after });
    }),
  );
  app.patch(
    "/api/v1/events/:id",
    mutate(async (req, res, s) => {
      const before = s.events.find((e) => e.id === req.params.id);
      if (!before) throw new ServiceError(404, "Event not found.");
      const after = eventSchema.parse({
        ...before,
        ...req.body,
        allowOutsideWaking: true,
        settingsOverrides: {
          ...before.settingsOverrides,
          ...Object.fromEntries(
            (["flexibility", "priority", "interruptible"] as const)
              .filter((key) => req.body[key] !== undefined)
              .map((key) => [key, req.body[key]]),
          ),
        },
        id: before.id,
        userId: s.userId,
        googleId: before.googleId,
        etag: before.etag,
        revision: before.revision + 1,
      });
      if (!s.categories.some((c) => c.id === after.categoryId))
        throw new ServiceError(400, "Category not found.");
      const p =
        before.seriesId && req.body.scope === "series"
          ? await service.editSeries(s, before, after)
          : service.proposal(
              s,
              "Edit event",
              [{ kind: "update", before, after }],
              "Review your event changes.",
            );
      await repo.save(s);
      res.json({ proposal: p });
    }),
  );
  app.delete(
    "/api/v1/events/:id",
    mutate(async (req, res, s) => {
      const before = s.events.find((e) => e.id === req.params.id);
      if (!before) throw new ServiceError(404, "Event not found.");
      const p =
        before.seriesId && req.body.scope === "series"
          ? await service.editSeries(s, before)
          : service.proposal(
              s,
              "Delete event",
              [{ kind: "delete", before }],
              "Review this deletion.",
            );
      await repo.save(s);
      res.json({ proposal: p });
    }),
  );
  app.put(
    "/calendar/update",
    mutate(async (req, res, s) => {
      const before = s.events.find(
        (e) => e.id === req.body.eventId || e.googleId === req.body.eventId,
      );
      if (!before) throw new ServiceError(404, "Event not found.");
      const after = eventSchema.parse({
          ...before,
          title: req.body.title,
          start: req.body.start,
          end: req.body.end,
          revision: before.revision + 1,
        }),
        p = service.proposal(
          s,
          "Update event",
          [{ kind: "update", before, after }],
          "Apply this event update in Aligned.",
        );
      await repo.save(s);
      res.json({ proposal: p });
    }),
  );
  app.delete(
    "/calendar/delete",
    mutate(async (req, res, s) => {
      const before = s.events.find(
        (e) => e.id === req.body.eventId || e.googleId === req.body.eventId,
      );
      if (!before) throw new ServiceError(404, "Event not found.");
      const p = service.proposal(
        s,
        "Delete event",
        [{ kind: "delete", before }],
        "Apply this deletion in Aligned.",
      );
      await repo.save(s);
      res.json({ proposal: p });
    }),
  );
  app.patch(
    "/api/v1/settings",
    mutate(async (req, res, s) => {
      s.settings = settingsSchema.parse({ ...s.settings, ...req.body });
      s.revision++;
      await repo.save(s);
      res.json(s.settings);
    }),
  );
  app.put(
    "/api/v1/categories/:id",
    mutate(async (req, res, s) => {
      const old = s.categories.find((c) => c.id === req.params.id),
        c = categorySchema.parse({
          ...old,
          ...req.body,
          id: req.params.id,
          userId: s.userId,
          role: old?.role ?? req.body.role,
          googleLabelId: old?.googleLabelId,
          lastSyncedLabel: old?.lastSyncedLabel,
        });
      if (
        !c.active &&
        s.categories.filter((v) => v.active && v.id !== c.id).length === 0
      )
        throw new ServiceError(400, "Keep at least one active category.");
      s.categories = s.categories.filter((v) => v.id !== c.id);
      s.categories.push(c);
      for (const event of s.events.filter(
        (e) => e.categoryId === c.id && e.importReviewed,
      )) {
        event.flexibility =
          event.settingsOverrides?.flexibility ?? c.flexibility;
        event.priority = event.settingsOverrides?.priority ?? c.priority;
        event.interruptible =
          event.settingsOverrides?.interruptible ?? c.interruptible;
        event.revision++;
      }
      s.revision++;
      await repo.save(s);
      await cal.labels(s);
      await repo.save(s);
      res.json(c);
    }),
  );
  app.post(
    "/api/v1/imports/review",
    mutate(async (req, res, s) => {
      const b = z
        .object({
          eventIds: z.array(z.string()).max(500),
          categoryId: z.string().optional(),
        })
        .parse(req.body);
      const changes = [];
      for (const eventId of b.eventIds) {
        const e = s.events.find((e) => e.id === eventId);
        if (!e) throw new ServiceError(404, "Event not found.");
        const c = s.categories.find(
          (c) => c.id === (b.categoryId ?? e.suggestedCategoryId),
        );
        if (!c) throw new ServiceError(400, "Choose a category.");
        const after = {
          ...e,
          categoryId: c.id,
          priority: c.priority,
          flexibility: c.flexibility,
          interruptible: c.interruptible,
          importReviewed: true,
          revision: e.revision + 1,
        };
        delete after.suggestedCategoryId;
        changes.push({ kind: "update" as const, before: e, after });
      }
      const proposal = service.proposal(
        s,
        "Review imported categories",
        changes,
        "Apply the category defaults you accepted, including labels and meeting reminders.",
      );
      await repo.save(s);
      res.json({ ok: true, proposal: await service.apply(s, proposal.id) });
    }),
  );
  app.post(
    "/api/v1/deadlines/:id/plan",
    mutate(async (req, res, s) => {
      const d = s.deadlines.find((d) => d.id === req.params.id);
      if (!d) throw new ServiceError(404, "Deadline not found.");
      const planned = s.events
          .filter(
            (e) => e.deadlineId === d.id && Date.parse(e.end) > Date.now(),
          )
          .reduce(
            (n, e) => n + (Date.parse(e.end) - Date.parse(e.start)) / 60000,
            0,
          ),
        remaining = Math.max(
          0,
          d.estimatedMinutes - d.completedMinutes - planned,
        );
      if (!remaining)
        throw new ServiceError(
          409,
          "All remaining work already has calendar time.",
        );
      const planner = new SchedulingService(repo, cal, {
        async interpret() {
          return {
            type: "study",
            title: d.title,
            activity: "study",
            duration: remaining,
            windowStart: new Date().toISOString(),
            windowEnd: d.due,
            due: d.due,
            categoryId:
              s.categories.find((c) => c.active && c.role === "deep-work")
                ?.id ?? d.categoryId,
            priority: d.priority,
            confidence: 1,
          };
        },
      });
      res.json(
        await planner.message(s, `Plan the remaining work for ${d.title}`),
      );
    }),
  );
  const schemas = {
    preferences: preferenceSchema,
    habits: habitSchema,
    relationships: relationshipSchema,
    deadlines: deadlineSchema,
  };
  for (const [collection, schema] of Object.entries(schemas)) {
    app.put(
      `/api/v1/${collection}/:id`,
      mutate(async (req, res, s) => {
        const list = (s as any)[collection] as any[],
          old = list.find((v) => v.id === req.params.id),
          value = schema.parse({
            ...old,
            ...req.body,
            id: req.params.id,
            userId: s.userId,
          });
        if (collection === "deadlines") {
          const d = value as z.infer<typeof deadlineSchema>;
          if (!s.categories.some((c) => c.id === d.categoryId))
            throw new ServiceError(400, "Category not found.");
          if (d.completedMinutes > d.estimatedMinutes)
            throw new ServiceError(
              400,
              "Completed work cannot exceed the estimated work.",
            );
        }
        (s as any)[collection] = [
          ...list.filter((v) => v.id !== value.id),
          value,
        ];
        s.revision++;
        await repo.save(s);
        res.json(value);
      }),
    );
    app.delete(
      `/api/v1/${collection}/:id`,
      mutate(async (req, res, s) => {
        const list = (s as any)[collection] as any[];
        if (!list.some((v) => v.id === req.params.id))
          throw new ServiceError(404, "Item not found.");
        (s as any)[collection] = list.filter((v) => v.id !== req.params.id);
        s.revision++;
        await repo.save(s);
        res.json({ ok: true });
      }),
    );
  }
  app.post(
    "/api/v1/devices",
    mutate(async (req, res, s) => {
      const b = z
          .object({
            id: z.string().min(1).max(200),
            appVersion: z.string().max(80).optional(),
            capability: z.string().max(300).optional(),
            pushStatus: z.string().max(300).optional(),
            platform: z.enum(["ios", "android", "web"]),
            token: z
              .string()
              .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
              .optional(),
            registrations: z
              .array(
                z.object({
                  id: z.string(),
                  notification: z.boolean(),
                  prominent: z.boolean(),
                  reason: z.string(),
                }),
              )
              .max(100)
              .optional(),
          })
          .parse(req.body),
        device = {
          ...b,
          sessionHash: sha(res.locals.token),
          lastSeen: new Date().toISOString(),
          alerts: meetingAlerts(inputFor(s)),
        };
      s.devices = s.devices.filter((d) => d.id !== b.id);
      s.devices.push(device);
      await repo.save(s);
      const { token: _token, sessionHash: _hash, ...publicDevice } = device;
      res.json(publicDevice);
    }),
  );
  const upload = multer({
    dest: tmpdir(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });
  app.post("/transcribe", upload.single("audio"), async (req, res) => {
    if (!req.file) throw new ServiceError(400, "Upload an audio recording.");
    res.json({ transcript: await transcribe(req.file.path) });
  });
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        err instanceof z.ZodError
          ? 400
          : err.code === "LIMIT_FILE_SIZE"
            ? 413
            : (err.status ?? 500);
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error:
          err instanceof z.ZodError
            ? err.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : status < 500
              ? err.message
              : err instanceof ServiceError
                ? err.message
                : "The request could not be completed. Please retry.",
        code:
          err instanceof z.ZodError
            ? "VALIDATION_ERROR"
            : status === 401
              ? "AUTH_REQUIRED"
              : "REQUEST_FAILED",
      });
    },
  );
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  return {
    app,
    repo,
    service,
    calendar: cal,
    broker,
    syncQueue,
    changed,
    close: async () => {
      for (const stream of streams) stream.end();
      push.close();
      await syncQueue.close();
    },
  };
}
