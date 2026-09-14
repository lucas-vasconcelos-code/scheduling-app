import "dotenv/config";
import { PostgresRepository } from "./store.js";
import { demoState } from "./demo.js";
const repo = new PostgresRepository();
await repo.save(demoState("development-seed"));
await repo.db.$disconnect();
console.log(
  "Seeded development-seed. This record has no production login or Google connection.",
);
