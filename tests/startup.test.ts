import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { createApp } from "../apps/server/src/app.js";
import { environmentConfig } from "../apps/server/src/config.js";
import { MemoryRepository } from "../apps/server/src/store.js";
import { startupErrorMessage } from "../apps/server/src/startup-errors.js";

function failureMessage(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return startupErrorMessage(error);
  }
  throw new Error("Expected startup to fail");
}

describe("startup diagnostics", () => {
  it("identifies malformed URL settings without printing their values", () => {
    for (const name of ["PUBLIC_URL", "GOOGLE_WEBHOOK_URL"]) {
      const message = failureMessage(() =>
        environmentConfig({
          APP_MODE: "demo",
          [name]: "private-invalid-value",
        }),
      );
      expect(message).toContain(`${name} must be a valid URL`);
      expect(message).not.toContain("private-invalid-value");
    }
  });

  it.each(["CLIENT_ID", "CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"])(
    "names missing %s",
    (name) => {
      const env = {
        APP_MODE: "google",
        DATABASE_URL: "postgresql://unused",
        CLIENT_ID: "test-client",
        CLIENT_SECRET: "test-secret",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
        [name]: undefined,
      };
      expect(
        failureMessage(() =>
          createApp(environmentConfig(env), new MemoryRepository()),
        ),
      ).toContain(`Google mode requires ${name}.`);
    },
  );

  it("reports a key with the wrong decoded length without exposing it", () => {
    const message = failureMessage(() =>
      createApp(
        {
          demo: false,
          publicUrl: "https://aligned.example",
          clientUrl: "https://aligned.example",
          clientId: "test-client",
          clientSecret: "test-secret",
          key: "private-invalid-key",
        },
        new MemoryRepository(),
      ),
    );
    expect(message).toContain("exactly 32 bytes");
    expect(message).not.toContain("private-invalid-key");
  });

  it("reports missing migrations without leaking Prisma query details", () => {
    const error = new Prisma.PrismaClientKnownRequestError("private-query", {
      code: "P2021",
      clientVersion: "6.19.0",
      meta: { table: "private-table" },
    });
    const message = startupErrorMessage(error);
    expect(message).toContain("Prisma P2021");
    expect(message).toContain("npm run start:production");
    expect(message).not.toContain("private-");
  });

  it("reports database initialization codes without connection details", () => {
    const error = new Prisma.PrismaClientInitializationError(
      "postgresql://private-user:private-password@private-host/db",
      "6.19.0",
      "P1001",
    );
    expect(startupErrorMessage(error)).toContain("Prisma P1001");
    expect(startupErrorMessage(error)).not.toContain("private-");
  });

  it("does not print arbitrary errors, stacks, or unrecognized codes", () => {
    for (const error of [
      new Error("private-token"),
      { code: "private-token", message: "private-token" },
      "private-token",
      null,
    ]) {
      expect(startupErrorMessage(error)).toContain("Aligned startup failed.");
      expect(startupErrorMessage(error)).not.toContain("private-token");
    }
  });
});
