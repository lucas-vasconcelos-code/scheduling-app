# Implementation verification — updated September 14, 2026

The Expo client, TypeScript API, shared contracts, scheduler, PostgreSQL persistence, and native alarm module sources are implemented. Demo mode runs without external credentials. This record separates local verification from account/device-dependent checks.

## Passed locally

| Check | Result |
| --- | --- |
| Root workspace clean installation and Prisma generation | Passed |
| TypeScript — server/shared/scheduler/tests and Expo client | Passed |
| ESLint | Passed |
| Vitest | 62 tests passed across six files |
| PostgreSQL 18 | Initial migration, seed command, persistent repositories, user isolation, sessions, journals, and advisory locking verified against an isolated database |
| Playwright | 10 passed: five flows on desktop and mobile Chromium |
| Visual review | Desktop/mobile Today and Calendar inspected; no browser errors or horizontal document overflow |
| Production export | Web, iOS Hermes, and Android Hermes bundles exported |
| Expo Doctor | 21 of 21 checks passed |
| Preserved Vite frontend | Production build passed; authenticated compatibility CRUD tested |
| Swift source | Parser check passed; this is not a native build |

The final checks used Node 22.15.0, which satisfies the SDK requirement. Reinstalling workspace dependencies resolved stalled reads in the original installed dependency tree.

The browser flows cover demo entry, single-event creation and Undo, multi-turn study planning, saved-deadline planning, approved reorganization, import-category acceptance, and notification/speech fallback. The reorganization smoke flow took about 25 seconds when two browser projects ran concurrently; the bounded synchronous scheduler can benefit from worker isolation before handling heavy simultaneous traffic.

The tests also cover buffers, fixed/protected commitments, priority, habits/chains, insufficient capacity, daylight saving, all-day busy intervals, recurrence exceptions and preview isolation, deterministic results, tenant/auth/CSRF boundaries, invalid provider output, paginated/incremental Google synchronization, 410 reset, label preservation/conflicts/fallback, reminder merging, stale/duplicate application, compensation, and Undo conflicts. Voice cleanup is tested with the optional transcription service disabled.

Screenshots and export artifacts are generated under `.cache/` and `apps/client/dist/`; they are intentionally ignored by Git. Run the commands in the README to reproduce them.

## Account and device checks still required

### Google and Gemini

Live OAuth, refresh/revocation, Calendar labels on supported/unsupported accounts, actual watch delivery, real recurrence writes, and live Gemini responses have **not** been verified against a connected account. Their adapters were exercised with controlled test responses. No live Calendar writes were made during implementation.

1. Configure the root `.env` and a Google test user as described in the README.
2. Set `APP_MODE=google`, migrate PostgreSQL, and sign in through the UI.
3. Verify initial sync/import review, Calendar CRUD, labels, T−15 reminder merging, a recurring occurrence and a series preview, Apply Changes, an external edit, and conflicting Undo.
4. Configure `GEMINI_API_KEY` and verify the documented requests and follow-ups. The provider uses stateless structured Interactions calls.
5. Configure a public HTTPS callback only when testing watch notifications. Deployment packaging and the setup guide are implemented; live hosting/account verification remains manual.

### Native alarms and voice

This machine has Xcode **16.4** with the older iOS SDK, and no Android SDK at the standard installation path. Native Swift/Kotlin compilation, device speech recognition, AlarmKit, Android reboot recovery, lock-screen delivery, and background notification behavior remain unverified. Successful JavaScript exports do not establish those capabilities.

1. Upgrade to Xcode **26.4+**, select it with `xcode-select`, install the corresponding platform support, and run `npm run ios -w @aligned/client`.
2. Install Android Studio, SDK 36 and a compatible JDK, configure `ANDROID_HOME`, and run `npm run android -w @aligned/client`.
3. Use development builds containing the local alarm module. On physical devices test permission grant/denial, exact-alarm/full-screen access, T−15 delivery, quiet overlapping contexts, cancellation/rescheduling, app activation, offline changes, and Android reboot recovery.
4. Configure FFmpeg/Whisper and test a real audio upload separately. Native speech and browser recognition also need microphone/device checks; all transcripts remain editable before sending.

See the linked official compatibility references in the README.

## Dependency audit

The final production-dependency audit reports **0 high, 0 critical, and 3 moderate** findings. The remaining chain is `expo-router → query-string → decode-uri-component` and concerns malformed percent-encoded input. The published decoder fix is an ESM release; forcing it into the existing CommonJS consumer would break that consumer. The incompatible override was removed, and the installed tree is valid. A compatible upstream router/query-string update or a separately reviewed patch is still needed to eliminate this finding. The compatible UUID and deepmerge fixes are applied through root overrides.


## Cross-device follow-up — September 14, 2026

The actual repository audit and implementation sequence are recorded in `docs/CROSS_DEVICE_PLAN.md`. The current code adds same-origin Express web hosting and a bundled server, Docker/EAS packaging, native sign-in handling, independent device logout/Google disconnect, scoped SSE invalidation, coalesced watch jobs, pre-registration watch authentication, silent push hints, foreground/reconnect refresh, local stale cache, and device status. No scheduler, intent-provider, or visual redesign was performed.

Final checks for this pass:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed server/shared/tests and client |
| `npm run lint` | Passed |
| `npm test` with real disposable PostgreSQL | 73 passed across 8 files |
| `npm run test:integration` with PostgreSQL | 45 passed |
| `npm run test:e2e` | 12 passed, desktop/mobile, including offline reconnect and logout |
| `npm run build` | Bundled server + production web export passed |
| `npm run verify:production` | Compiled server served exported SPA deep link, same-origin authenticated API, live stream and Account screen |
| `npm run verify:visual` | Desktop/mobile screenshots inspected; zero browser errors and no horizontal overflow |
| Native JS export | iOS and Android Hermes bundles passed with background notification/task modules |
| `npm run doctor` | 21/21 passed |
| Production dependency audit | 0 high/critical, same 3 moderate decoder/router findings |

A previous disposable database directory developed missing relation files. A fresh isolated PostgreSQL 18 cluster under `/private/tmp/aligned-pg-cross-device-20260914`, port 55433, successfully applied the committed migration and development seed, then passed the full and integration suites. No normal local or cloud database was changed.

New tests exercise real OAuth-route sequencing with mocked Google identity/token responses for two independent sessions, shared data, journaled calendar creates in both directions, verifier replay rejection, logout isolation, device token redaction, separate disconnect, authenticated SSE, user-scoped notifications, webhook acknowledgement before remote fetch completion, persisted incremental changes, pre-registration watch credentials and replacement, SPA route boundaries, production config validation, fresh alert reconciliation and offline failure behavior.

Browser testing caught and fixed an IP-wide rate-limit collision, an unreliable external network probe, and retained authenticated query data after logout. Passing screenshots cover the existing Today/Calendar layouts and updated Account controls; they are not physical native UI tests.

Still unverified: actual Linux Docker image build (no Docker engine installed), public hosting/TLS/proxy behavior, live Google/Gemini credentials, true web-to-physical-phone synchronization, APNs/FCM delivery, native Swift/Kotlin compilation and permissions/alarm delivery. Native JavaScript exports and mocked API tests do not prove those behaviors. The complete provisioning and device checklist is in `docs/PERSONAL_DEPLOYMENT.md`.

Explicit limitations: single backend instance, short-lived process-local OAuth handoffs, bounded synchronous reorganization, OS-dependent background pushes, and no durable server-scheduled visible meeting-push safety net or guaranteed push receipt retry. The existing Google T−15 reminder and local native notifications/alarms remain the reminder paths. No live Calendar writes or public deployment were performed in this pass.
