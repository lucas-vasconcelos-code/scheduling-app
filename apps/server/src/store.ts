import { PrismaClient, Prisma } from "@prisma/client";
import { settingsSchema, type UserState } from "@aligned/shared";
import { createHash } from "node:crypto";

export interface Session {
  userId: string;
  csrf: string;
  expiresAt: Date;
}
export interface Repository {
  get(userId: string): Promise<UserState | undefined>;
  save(state: UserState): Promise<void>;
  findGoogle(subject: string): Promise<string | undefined>;
  bindGoogle(userId: string, subject: string): Promise<void>;
  credentials(userId: string, value?: string): Promise<string | undefined>;
  session(token: string, value?: Session): Promise<Session | undefined>;
  revoke(token: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
  journal(
    userId: string,
    id: string,
    value?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined>;
  users(): Promise<string[]>;
}
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export class MemoryRepository implements Repository {
  states = new Map<string, UserState>();
  tokens = new Map<string, Session>();
  connections = new Map<string, string>();
  subjects = new Map<string, string>();
  operations = new Map<string, Record<string, unknown>>();
  async get(id: string) {
    return structuredClone(this.states.get(id));
  }
  async save(s: UserState) {
    this.states.set(s.userId, structuredClone(s));
  }
  async findGoogle(subject: string) {
    return this.subjects.get(subject);
  }
  async bindGoogle(id: string, subject: string) {
    this.subjects.set(subject, id);
  }
  async credentials(id: string, value?: string) {
    if (value !== undefined) this.connections.set(id, value);
    return this.connections.get(id);
  }
  async session(token: string, value?: Session) {
    const k = hash(token);
    if (value) this.tokens.set(k, value);
    const s = this.tokens.get(k);
    return s && s.expiresAt > new Date() ? s : undefined;
  }
  async disconnect(id: string) {
    this.connections.delete(id);
  }
  async revoke(token: string) {
    this.tokens.delete(hash(token));
  }
  async journal(userId: string, id: string, value?: Record<string, unknown>) {
    const key = `${userId}/${id}`;
    if (value) this.operations.set(key, structuredClone(value));
    return structuredClone(this.operations.get(key));
  }
  async users() {
    return [...this.states.keys()];
  }
}
const collections = {
  categories: "category",
  events: "calendarEventMetadata",
  preferences: "preferenceRule",
  habits: "habit",
  relationships: "habitRelationship",
  deadlines: "deadline",
  conversations: "conversation",
  proposals: "scheduleProposal",
  devices: "device",
} as const;
export class PostgresRepository implements Repository {
  constructor(public db = new PrismaClient()) {}
  async get(userId: string): Promise<UserState | undefined> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const state: any = {
      userId,
      name: user.name,
      revision: user.revision,
      settings: settingsSchema.parse(user.settings),
      sync: user.sync,
    };
    await Promise.all(
      Object.entries(collections).map(async ([key, model]) => {
        state[key] = (
          await (this.db[model] as any).findMany({ where: { userId } })
        ).map((r: any) => r.data);
      }),
    );
    return state;
  }
  async save(s: UserState) {
    await this.db.$transaction(
      async (tx) => {
        await tx.user.upsert({
          where: { id: s.userId },
          create: {
            id: s.userId,
            name: s.name,
            revision: s.revision,
            settings: s.settings as any,
            sync: s.sync as any,
          },
          update: {
            name: s.name,
            revision: s.revision,
            settings: s.settings as any,
            sync: s.sync as any,
          },
        });
        for (const [key, model] of Object.entries(collections)) {
          const rows = (s as any)[key] as { id: string }[],
            delegate = (tx as any)[model];
          await delegate.deleteMany({
            where: { userId: s.userId, id: { notIn: rows.map((r) => r.id) } },
          });
          for (const row of rows)
            await delegate.upsert({
              where: { userId_id: { userId: s.userId, id: row.id } },
              create: {
                id: row.id,
                userId: s.userId,
                data: row as Prisma.InputJsonValue,
              },
              update: { data: row as Prisma.InputJsonValue },
            });
        }
      },
      { timeout: 30000 },
    );
  }
  async findGoogle(subject: string) {
    return (
      await this.db.user.findUnique({ where: { googleSubject: subject } })
    )?.id;
  }
  async bindGoogle(userId: string, subject: string) {
    await this.db.user.update({
      where: { id: userId },
      data: { googleSubject: subject },
    });
  }
  async credentials(userId: string, value?: string) {
    if (value !== undefined)
      await this.db.googleConnection.upsert({
        where: { userId },
        create: { userId, credentials: value },
        update: { credentials: value },
      });
    return (await this.db.googleConnection.findUnique({ where: { userId } }))
      ?.credentials;
  }
  async session(token: string, value?: Session) {
    const tokenHash = hash(token);
    if (value)
      await this.db.session.upsert({
        where: { tokenHash },
        create: { tokenHash, ...value },
        update: value,
      });
    const s = await this.db.session.findUnique({ where: { tokenHash } });
    return s && s.expiresAt > new Date() ? s : undefined;
  }
  async disconnect(userId: string) {
    await this.db.googleConnection.deleteMany({ where: { userId } });
  }
  async revoke(token: string) {
    await this.db.session.deleteMany({ where: { tokenHash: hash(token) } });
  }
  async journal(userId: string, id: string, value?: Record<string, unknown>) {
    if (value)
      await this.db.operationJournal.upsert({
        where: { userId_id: { userId, id } },
        create: {
          id,
          userId,
          status: String(value.status),
          data: value as Prisma.InputJsonValue,
        },
        update: {
          status: String(value.status),
          data: value as Prisma.InputJsonValue,
        },
      });
    return (
      await this.db.operationJournal.findUnique({
        where: { userId_id: { userId, id } },
      })
    )?.data as Record<string, unknown> | undefined;
  }
  async users() {
    return (await this.db.user.findMany({ select: { id: true } })).map(
      (u) => u.id,
    );
  }
}
const locks = new Map<string, Promise<unknown>>();
export async function serialized<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const current = previous.catch(() => {}).then(() => gate);
  locks.set(userId, current);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(userId) === current) locks.delete(userId);
  }
}
export async function withUserLock<T>(
  repo: Repository,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return serialized(userId, async () =>
    repo instanceof PostgresRepository
      ? serialized("postgres-operation-pool", () =>
          repo.db.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
              return fn();
            },
            { timeout: 90000 },
          ),
        )
      : fn(),
  );
}
