import { setInterval, setTimeout } from "node:timers";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
import { createApp } from "./app.js";
import { withUserLock, PostgresRepository } from "./store.js";
import { environmentConfig } from "./config.js";
import { startupErrorMessage } from "./startup-errors.js";
async function main() {
  const config = environmentConfig();
  const demo = config.demo;
  const runtime = createApp(config);
  const { app, repo, service, syncQueue } = runtime;
  if (!demo)
    for (const id of await repo.users())
      await withUserLock(repo, id, async () => {
        const s = await service.state(id);
        for (const p of s.proposals)
          if (p.status === "applying") {
            p.status = "recovery";
            p.error =
              "The server restarted during this operation. Synchronize and inspect the calendar before making further changes.";
          }
        await repo.save(s);
      });
  const server = app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
    console.log(
      `Aligned server · ${demo ? "DEMO" : "GOOGLE"} · port ${process.env.PORT ?? 3000}`,
    ),
  );
  server.on("error", (e) => {
    console.error("Server could not start:", e.message);
    process.exitCode = 1;
  });
  const worker = setInterval(() => {
    if (!demo)
      void repo
        .users()
        .then((ids) =>
          Promise.allSettled(ids.map((id) => syncQueue.enqueue(id))),
        )
        .catch(() => console.error("Background refresh could not start."));
  }, 5 * 60000);
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      clearInterval(worker);
      const deadline = setTimeout(() => process.exit(1), 30000);
      const drained = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      void Promise.all([runtime.close(), drained]).then(async () => {
        if (repo instanceof PostgresRepository) await repo.db.$disconnect();
        clearTimeout(deadline);
        process.exit(0);
      });
    });
}
void main().catch((error: unknown) => {
  console.error(startupErrorMessage(error));
  process.exit(1);
});
