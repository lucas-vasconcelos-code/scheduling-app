# Aligned personal deployment

This deploys the existing Aligned app as **one always-on HTTPS service plus persistent PostgreSQL**. The laptop browser and installed phone app use that service and the same Google account. The laptop can be shut down after installing a preview build. No Gmail integration is involved.

The examples use `https://YOUR-SERVICE.onrender.com`. Replace that whole origin everywhere with your actual service URL, with no trailing slash. Render is a documented example, not a requirement: any persistent Docker host supporting HTTPS, long-lived responses, outbound Google/Expo requests and PostgreSQL works. Use one server instance. Do not use a sleeping/free trial service for dependable watch renewal.

## PHASE A — Create the hosted service

In the Render dashboard choose **New → Web Service**, connect the repository containing this work, select **Docker**, repository root as the root directory, `./Dockerfile`, and one always-on instance. Choose the region where the database will live. Leave Docker Command empty: the image runs `npm run start:production`. Set Health Check Path to `/health`. Record the assigned HTTPS service origin; deployment can wait until Phase F. No static-site service is needed. The exported Expo web app is served by Express.

A local Docker check, on a machine with Docker installed:

```sh
docker build -t aligned .
docker run --rm -p 3000:3000 --env-file .env.production aligned
```

Use a private untracked runtime env file. The Docker build excludes `.env` files and never accepts backend credentials as build arguments. It includes the generated Prisma client, migrations, bundled JavaScript server and exported web app. The image retains build dependencies for Prisma CLI simplicity; it is not optimized for minimum size. No Docker engine was available in the implementation environment, so building the actual Linux image remains an external verification step.

See [Render web services](https://render.com/docs/web-services) and [Docker deployment](https://render.com/docs/docker).

## PHASE B — Create PostgreSQL

Choose **New → Postgres**, name the database `aligned`, select the same region as the service, and choose persistent storage and backups. In the database **Info / Connections** area copy the **Internal Database URL** privately into the web service's `DATABASE_URL` environment variable. Keep the database internal where supported. For another host, use its TLS-enabled connection string and restricted application role.

The startup command applies committed migrations with `prisma migrate deploy`, then starts the server. Do not run `migrate dev` or reset a production database. The optional `npm run db:seed` is for development and is unnecessary for real Google users. Back up the database AND the encryption key separately. Restoring one without the other cannot restore Google authorization.

See [Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting).

## PHASE C — Configure Google identity

In **Google Cloud Console → project selector → New Project**, create or select your Aligned project. Open **Google Auth Platform → Branding** and enter the app name, support email and developer contact. Under **Audience**, choose External for a personal Google account; while testing, add the exact Google email you will use on both devices as a test user.

Under **Clients → Create client → Web application**, create a server OAuth client. Add the HTTPS origin as an authorized JavaScript origin and this exact **Authorized redirect URI**:

```
https://YOUR-SERVICE.onrender.com/auth/callback
```

Copy Client ID to server `CLIENT_ID`, Client secret to server `CLIENT_SECRET`, and that exact callback to `REDIRECT_URI`. Do not create a separate phone Google account or send the client secret to the phone. The same server web OAuth client handles native login; the app receives only a one-time verifier-bound Aligned session handoff at `aligned://auth`.

Local optional callback: `http://localhost:3000/auth/callback`. Keep it in the same client's allowed redirect list only if developing locally.

Google testing-mode refresh tokens with Calendar scopes typically expire after seven days. For sustained personal use, review the app's publishing state and applicable Google verification/Workspace policy in **Audience**. Publishing status does not bypass Google's verification rules. See [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2).

## PHASE D — Enable Calendar and language access

Under **APIs & Services → Library**, enable **Google Calendar API**. Under **Google Auth Platform → Data Access**, configure the scopes used by this app: `openid`, `email`, `profile`, `calendar.events.owned`, `calendar.freebusy`, and `calendar.calendars` (Calendar scopes use the prefix `https://www.googleapis.com/auth/`). No Gmail or ACL scopes are needed. The app restricts Calendar resource operations to `primary`.

Create a Gemini API key in Google AI Studio for your selected project, then store it as server `GEMINI_API_KEY`. Use `GEMINI_MODEL=gemini-2.5-flash` or a model available to that key supporting the existing structured Interactions integration. Missing Gemini configuration leaves manual event editing available but cannot satisfy natural-language tests. Do not put the key in an `EXPO_PUBLIC_*` variable.

## PHASE E — Enter runtime environment values

Open the web service **Environment** page. Enter these values privately:

| Variable | Value / source |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_MODE` | `google` |
| `PUBLIC_URL` | Actual HTTPS service origin |
| `CLIENT_URL` | Same HTTPS origin |
| `REDIRECT_URI` | Same origin + `/auth/callback` |
| `DATABASE_URL` | Phase B private connection string |
| `CLIENT_ID`, `CLIENT_SECRET` | Phase C web OAuth client |
| `TOKEN_ENCRYPTION_KEY` | Output of local `openssl rand -base64 32` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Phase D |
| `GOOGLE_WEBHOOK_URL` | Same origin + `/api/v1/google/webhook` |
| `EXPO_PUSH_ENABLED` | `true` after Phase H; `false` before configuring phone push |
| `EXPO_ACCESS_TOKEN` | Optional server-only access token if enhanced Expo push security is enabled |
| `ENABLE_DIAGNOSTICS` | `true` during setup; return to `false` afterward |
| `PORT` | Host-provided port; otherwise `3000` |

Leave `WEB_ROOT` unset (defaults to `apps/client/dist` in production). Leave `LEGACY_CLIENT_URL` unset. Leave `EXPO_PUBLIC_API_URL` unset/empty for the Docker **web build** so it uses the current browser origin. The native EAS environment gets a separate explicit public API URL in Phase H. Never copy your legacy `backend/.env` wholesale into public build settings.

Whisper variables are optional. The standard image does not install FFmpeg or a Whisper executable/model; add those deliberately only if enabling the existing upload transcription service.

## PHASE F — Deploy and inspect startup

Select **Manual Deploy → Deploy latest commit**. Build runs `npm ci`, Prisma generation, server bundling and Expo web export. Startup applies migrations before listening on the host's port. Check logs for successful startup, without printing environment values or tokens.

Open `https://YOUR-SERVICE.onrender.com/health`: expect `{"ok":true,"mode":"google"}`. Open `/`: expect Aligned's welcome screen. Open `/calendar` in a fresh tab: expect the exported app. `/api/v1/state` without login must return JSON 401, never the HTML app. `/auth/missing` and `/api/missing` must not be swallowed by SPA fallback. If using another proxy, disable response buffering for `/api/v1/changes`, allow a long read timeout and forward HTTPS correctly. The app assumes one trusted reverse proxy hop.

## PHASE G — Verify the laptop browser

Choose **Connect Google Calendar**, sign in with the Phase C test user and grant the listed access. The loading message should transition to imported events and category review. Review suggested categories before accepting them. Imported commitments stay fixed and non-interruptible until review.

Open **Settings → Account**. Check your account email, last sync time, and **Live updates connected**. Try **Sync now**. In the authenticated browser's developer console, this read-only diagnostic command returns redacted setup information:

```js
fetch('/api/v1/diagnostics', {credentials: 'include'}).then(r => r.json()).then(console.log)
```

Expect a user ID, `connected: true`, `hasSyncToken: true`, last sync time, channel expiration, active stream count and device statuses. No Google tokens, session credentials, webhook token, or database URL are returned. This endpoint is authenticated/user-scoped and exists only when `ENABLE_DIAGNOSTICS=true`.

## PHASE H — Build and install a physical phone app

Use a development or **preview** build, never Expo Go. Preview includes the JavaScript bundle and can run when the laptop is off. A development build normally connects to Metro while developing.

From `apps/client`:

```sh
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_URL --value https://YOUR-SERVICE.onrender.com --visibility plaintext
```

In **expo.dev → your project → Project settings**, copy the Project ID UUID. `eas init` may already write `extra.eas.projectId`; otherwise set public `EXPO_PUBLIC_EAS_PROJECT_ID` to that UUID in the EAS preview environment. It is an identifier, not a credential. Keep scheme `aligned`, iOS bundle identifier `com.aligned.scheduler` and Android package `com.aligned.scheduler` consistent with signing and push credentials. If those identifiers are unavailable in your account, change them consistently before generating credentials and rebuild.

For iPhone, an Apple Developer membership and device provisioning are required:

```sh
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

Open the device-registration link on the phone before building. Let EAS configure signing and APNs credentials under your Apple account. Install using the completed build's installation link/QR code on the registered device. Enable Developer Mode if the OS requests it.

For Android:

```sh
npx eas-cli@latest build --platform android --profile preview
```

Install the APK from the completed build link; allow that installer when Android requests permission. For remote pushes, configure FCM v1 for `com.aligned.scheduler`: Firebase Console **Project settings → Your apps → Add Android app**, download `google-services.json` and provide it through an EAS file environment variable named `GOOGLE_SERVICES_JSON`. The existing Expo config reads that file path into `android.googleServicesFile`. Under **Project settings → Service accounts**, generate the required FCM service-account key and upload it through `eas credentials --platform android`; do not commit that private key. EAS/Expo's push setup guide provides the current credential flow.

For development profiles, repeat the public URL/Project ID environment entries in `development`, build with `--profile development`, and run `npx expo start --dev-client`. Local API alternative: root `EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:3000`, matching accessible server/callback configuration, or an HTTPS development tunnel. That is temporary development, not the final architecture.

Local iOS compilation requires Xcode 26.4+; this machine has 16.4. Local Android compilation requires a compatible JDK and SDK. EAS cloud builds avoid those local compiler requirements but still require signing/account setup. See [internal distribution](https://docs.expo.dev/build/internal-distribution/) and [push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## PHASE I — Sign in on the phone

Launch installed Aligned, choose Connect Google Calendar and use **the same Google account** as the laptop. Complete consent and return to Aligned. Cancellation should show a recoverable message; an expired handoff requires restarting sign-in. In Settings → Account, confirm the same email and calendar. Preferences, habits, deadlines and conversations should already match because they belong to the server user, not the installation. Browser and phone receive separate session credentials.

Enable meeting reminders on the phone. Grant notifications and, where offered, AlarmKit or Android exact-alarm access. The status must report fallback when permission/support is absent. Check that the phone appears in Account with platform, last-seen time and capability. An Expo push token should be registered only after permissions and project credentials are configured. Turn on server `EXPO_PUSH_ENABLED=true` and redeploy if not already enabled.

## PHASE J — Cross-device acceptance checklist

Run with the browser and phone signed in simultaneously. Watch each action in **Google Calendar primary**, Aligned web, and Aligned phone. Record actual results and times; passing mocked tests does not establish these results.

1. In Google Calendar create **Cross-device test** tomorrow **4–5 PM**. Foreground the phone and verify both Aligned views receive it.
2. In Aligned web send **“Schedule gym tomorrow at 6 PM for one hour.”** Verify the event in Google and on the phone; apply a preview if the existing scheduler requests approval.
3. On the phone send **“Study algorithms tomorrow for 90 minutes.”** Verify Google and web receive the approved/created result.
4. Move one event directly in Google Calendar. Verify both Aligned views update; also test Sync now.
5. On the phone save **“I work best in the morning.”** Verify the original statement appears on web and subsequent suitable scheduling requests use it.
6. Choose **Sign out this device** on the phone. Verify the web session remains usable. Sign back in with the same Google account and confirm the same settings/deadlines/conversations return.
7. Create a future Meetings event, verify Google's T−15 reminder, enable the phone alarm/notification, then move the meeting on the computer. Foreground the phone and verify the prior alert is cancelled and the new time is registered. Test delivery with the phone locked separately.

Also enable airplane mode: cached data remains visibly stale, mutations do not claim success or queue writes, and reconnect/activation retrieves current data. Test notification denial and unsupported AlarmKit/Android permissions. Disconnect Google only when intentionally ending access on **all** devices; it preserves Aligned metadata and sessions, stops the watch where possible, revokes the Google grant and clears local scheduling on the next received refresh.

## PHASE K — Verify watch delivery and renewal

Leave both clients open. Edit Google Calendar externally. Server `/api/v1/google/webhook` authenticates channel ID/token/resource ID and immediately acknowledges a matching notification; it queues a coalesced incremental refresh. Successful persistence triggers only that user's stream/push hints. Initial `sync` notifications are accepted even when they arrive before the watch response. Renewal persists new channel authentication before registration and stops the old channel after replacement. Polling every five minutes also renews watches approaching expiry and repairs missed messages; a Google 410 resets incremental synchronization.

Inspect redacted diagnostics for a future `channelExpires`, `channelActive: true`, and advancing `lastSync` after an external edit. Check hosting request logs for webhook 204s, but do not enable logging of request headers. If no watch is active, check the HTTPS URL, Google project configuration and server connectivity. Reconnect after revocation. Multiple server instances require a shared broker, shared short-lived OAuth handoff storage and a dedicated scalable channel index; do not increase instance count with this initial personal deployment.

See [Google watch lifecycle](https://developers.google.com/workspace/calendar/api/guides/push) and [incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).

## PHASE L — Understand alarm delivery and finish verification

The local native alarm service remains responsible for prominent alarms. A received data-only Expo push tries to fetch the latest stored schedule and reconcile local alerts without a visible “calendar changed” notification. Foreground activation always fetches current data and reconciles again, including when alert payloads have not otherwise changed. SSE reconnects with backoff; active polling remains a fallback. Web reminders operate only while the browser supports and runs them.

Neither APNs/FCM nor iOS/Android background execution guarantees that a suspended or offline phone will run immediately. A stale local alarm can fire until the phone receives a change. A force-stopped Android app or OS-restricted iPhone can delay background processing. The app does not claim to override those limitations. Test real background delivery, denied permissions, reboot, clock/timezone changes, and cancellation on your hardware.

**Explicit deferral:** a separate durable server-scheduled ordinary meeting-push safety net is not enabled. The existing Google T−15 reminder and native scheduled notifications remain available. Adding an extra visible push without durable deduplication against native delivery would cause duplicate/stale reminders; this pass prioritizes cross-device state and uses only best-effort, non-visible change hints. Push receipt retry/cleanup is likewise not a delivery guarantee. Do not interpret “registered” as proven delivery.

After acceptance, turn off diagnostics. Keep the service always on, preserve backups/encryption key, and record results in `docs/VERIFICATION.md`. No live account, hosted service, or physical device was available to certify these steps during implementation.
