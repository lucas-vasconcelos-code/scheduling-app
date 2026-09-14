import { resolve } from "node:path";
import type { Config } from "./app.js";
export function environmentConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const production = env.NODE_ENV === "production";
  if (env.APP_MODE && !["demo", "google"].includes(env.APP_MODE))
    throw new Error("APP_MODE must be demo or google.");
  if (production && !env.APP_MODE)
    throw new Error("Set APP_MODE explicitly in production.");
  const demo = env.APP_MODE !== "google";
  const publicUrl = env.PUBLIC_URL ?? "http://localhost:3000";
  const clientUrl =
    env.CLIENT_URL ?? (production ? publicUrl : "http://localhost:8081");
  const redirectUri = env.REDIRECT_URI ?? publicUrl + "/auth/callback";
  for (const [name, value] of Object.entries({
    PUBLIC_URL: publicUrl,
    CLIENT_URL: clientUrl,
    REDIRECT_URI: redirectUri,
  })) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL.`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (production && url.protocol !== "https:")
    )
      throw new Error(
        `${name} must use ${production ? "HTTPS" : "HTTP or HTTPS"}.`,
      );
    if (url.username || url.password)
      throw new Error(`${name} must not contain credentials.`);
  }
  if (
    production &&
    (new URL(clientUrl).origin !== new URL(publicUrl).origin ||
      new URL(redirectUri).origin !== new URL(publicUrl).origin)
  )
    throw new Error(
      "Production web, API and Google callback must share PUBLIC_URL origin.",
    );
  if (!demo && !env.DATABASE_URL)
    throw new Error("Google mode requires DATABASE_URL.");
  if (
    env.GOOGLE_WEBHOOK_URL &&
    (new URL(env.GOOGLE_WEBHOOK_URL).protocol !== "https:" ||
      new URL(env.GOOGLE_WEBHOOK_URL).pathname !== "/api/v1/google/webhook")
  )
    throw new Error(
      "GOOGLE_WEBHOOK_URL must be HTTPS and end in /api/v1/google/webhook.",
    );
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  return {
    demo,
    publicUrl: new URL(publicUrl).origin,
    clientUrl: new URL(clientUrl).origin,
    redirectUri,
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET,
    key: env.TOKEN_ENCRYPTION_KEY,
    geminiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    webhook: env.GOOGLE_WEBHOOK_URL,
    legacyClientUrl: env.LEGACY_CLIENT_URL,
    webRoot: env.WEB_ROOT
      ? resolve(env.WEB_ROOT)
      : production
        ? resolve("apps/client/dist")
        : undefined,
    diagnostics: env.ENABLE_DIAGNOSTICS === "true",
    pushEnabled: !demo && env.EXPO_PUSH_ENABLED === "true",
  };
}
