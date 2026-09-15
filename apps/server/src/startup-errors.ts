// Only application-authored configuration messages are safe to print verbatim.
export class ConfigurationError extends Error {}

export function startupErrorMessage(error: unknown): string {
  const prefix = "Aligned startup failed.";
  if (error instanceof ConfigurationError) return `${prefix} ${error.message}`;

  const candidate = error as { code?: unknown; errorCode?: unknown } | null;
  const code = candidate?.errorCode ?? candidate?.code;
  if (typeof code === "string" && /^P\d{4}$/.test(code)) {
    const hints: Record<string, string> = {
      P1000: "Database authentication failed. Check DATABASE_URL credentials.",
      P1001:
        "Database is unreachable. Check DATABASE_URL and database availability.",
      P1002: "Database connection timed out. Check database availability.",
      P1003:
        "Database does not exist. Check the database name in DATABASE_URL.",
      P1010: "Database access denied. Check the database role permissions.",
      P1011: "Database TLS connection failed. Check DATABASE_URL SSL settings.",
      P1013: "DATABASE_URL has an invalid connection-string format.",
      P2021:
        "Database table is missing. Run npm run start:production from the repository root to apply migrations before starting.",
      P2022:
        "Database column is missing. Run npm run start:production from the repository root to apply migrations before starting.",
    };
    return `${prefix} Prisma ${code}. ${hints[code] ?? "Check database configuration and migrations."}`;
  }
  return `${prefix} Unexpected initialization or recovery error. Check server configuration, encryption key and database availability.`;
}
