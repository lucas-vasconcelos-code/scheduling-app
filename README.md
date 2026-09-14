# Aligned

A calendar assistant built around your energy, routines, and priorities. Gemini interprets language; an independent TypeScript scheduling engine decides which schedules are valid. Calendar changes that move existing commitments always need an explicit review.

## Start the demo

```sh
nvm use
npm ci
npm run db:generate
npm run demo
```

Open [localhost:8081](http://localhost:8081) and choose **Explore the demo**. The API runs on port 3000. Demo mode needs **no database, Google account, or Gemini key**. Each demo session receives its own calendar and settings. Navigation and refresh preserve the session; restarting the server or **Settings → Account → Reset demo calendar** resets demo data.

Try:

- `Schedule an hour to work out tomorrow`
- `Make it two hours` after that request
- `I have an exam Friday`, followed by `Four hours`
- `Clear two hours tomorrow afternoon to study`
- `I hate doing homework after 9 PM`
- `Don't schedule workouts before class`
- `Gym Monday, Wednesday, and Friday for an hour`

The demo interpreter supports a bounded grammar, not a simulated claim of unrestricted AI. Unsupported commands ask for clarification. The same scheduling engine, proposal workflow, and UI run in both modes. Sample classes, meals, workouts, study blocks, deadlines, and historical routines are generated relative to the current date.

## Architecture

| Workspace | Responsibility |
| --- | --- |
| `apps/client` | Expo Router, React Native/Web, TanStack Query, forms, responsive views, voice and reminder adapters |
| `apps/server` | Express API, OAuth/session security, intent providers, Google synchronization, proposals and persistence |
| `packages/shared` | Zod contracts and common domain types |
| `packages/scheduler` | Pure deterministic availability, ranking, reorganization, study planning, habits, alignment, and alert decisions |
| `packages/alarms` | Local Expo module for iOS AlarmKit and Android AlarmManager |
| `frontend`, `backend` | Previous Vite prototype and migration compatibility code |

The server owns conversation state, resolves references and missing information, validates model output, and submits structured requests to the scheduler. It does not give Gemini tools that directly mutate Google Calendar. Calendar adapters and repositories are injectable for tests.

Production persistence uses PostgreSQL with Prisma. Each domain collection has a user-scoped composite primary key and a user foreign key. Zod-validated JSON payloads preserve the shared domain shape without duplicating entire Google resources; sessions and encrypted Google credentials are stored separately. Calendar cache entries retain IDs, etags, timing, recurrence identity, and scheduling metadata. Proposals and an operation journal record before/after changes for recovery.

Only the primary Google Calendar is read or written. Names like “Meetings” can change: category behavior follows an internal role rather than matching a display label. Newly imported events remain fixed and non-interruptible until their suggested category defaults are accepted.

## Real Google mode

Install PostgreSQL 16 or newer and create a database and restricted application role. For example, with a local PostgreSQL installation:

```sh
createuser --pwprompt aligned
createdb --owner=aligned aligned
cp .env.example .env
```

Set `DATABASE_URL`, OAuth variables, `TOKEN_ENCRYPTION_KEY`, and `GEMINI_API_KEY` in the root `.env`. Generate the encryption key with:

```sh
openssl rand -base64 32
```

Keep the generated value private. Encryption uses AES-256-GCM. Losing this key requires reconnecting Google accounts. A key rotation must decrypt and re-encrypt stored connections; simply replacing the variable cannot read existing credentials.

```sh
npm run db:generate
npm run db:migrate
npm run db:seed   # optional development data; creates no Google login
APP_MODE=google npm run dev
```

Use `prisma migrate dev --schema apps/server/prisma/schema.prisma --name descriptive_change` when intentionally developing another migration; use `npm run db:migrate` to apply committed migrations.

### Google Cloud setup

1. Enable Google Calendar API and configure an OAuth consent screen. Add test users while the consent screen is in testing.
2. Create a Web OAuth client with callback `http://localhost:3000/auth/callback`. Set `CLIENT_ID`, `CLIENT_SECRET`, and `REDIRECT_URI` accordingly.
3. Set `CLIENT_URL=http://localhost:8081` and `PUBLIC_URL=http://localhost:3000` for local development. Deployed URLs must use HTTPS. Keep the client and API same-site for cookie authentication, with the exact client origin allowlisted.
4. Use the welcome screen to connect Google. Authorization requests identity, owned-event access, free/busy, and calendar metadata for labels. It does not request Gmail or ACL-management scopes.
5. To receive Google change notifications, provide an externally reachable HTTPS `GOOGLE_WEBHOOK_URL` ending in `/api/v1/google/webhook`. Without one, the server polls and refreshes on user/app activity.

Web sessions use HTTP-only cookies, SameSite protection, a per-session CSRF token, and origin checks. Native authentication uses a short-lived verifier-bound exchange and stores only the application session credential in SecureStore. Refresh tokens never enter the frontend. Session tokens are hashed in PostgreSQL. OAuth state and short-lived native handoffs expire; a server restart during sign-in requires starting sign-in again.

### Labels and synchronization

Google labels use `labelProperties.eventLabels`, `eventLabelId`, and `eventLabelVersion=1`. Existing labels are read before merging app-owned changes. The adapter retains unrelated labels, respects the 200-label limit, and reconciles edits against the last synchronized label. Conflicts are surfaced. Unsupported label accounts keep internal categories; label mode does not write legacy `colorId`.

Calendar sync is paginated and incremental, handles deleted entries and invalid sync tokens, and materializes recurring instances for a bounded scheduling horizon. Per-event reminders retain existing overrides and add a 15-minute popup for Meetings, without changing calendar-wide defaults.

The app creates personal calendar blocks. It does not find other people’s availability or send attendee invitations.

## Scheduling rules and limits

- Default waking hours are 07:00–23:00, transitions 15 minutes, preferred focus 60 minutes, maximum focus 90 minutes, and breaks 15 minutes. All are editable.
- Normal searches cover seven days unless a request supplies a window or deadline. Candidate starts use five-minute increments plus exact requested times and availability boundaries.
- Reorganization considers at most three flexible, reviewed events. Fixed and protected commitments are excluded; more important events are not displaced for lower-priority requests. Search is bounded and does not guarantee a global optimum.
- Study sessions finish before the deadline. Insufficient capacity appears as a visible shortfall; applying a partial plan only adds the displayed sessions.
- Calendar-derived habits need at least three distinct past occurrences. Patterns are inferred from calendar history, not proof of attendance. Explicit habits do not need observation history.
- Recurring proposals show a 90-day finite plan. Matching wall-clock times can use a Google recurrence rule; adaptive times become linked individual events. The preview states which representation is being used.
- Alignment is deterministic, with component explanations. Empty days have no score.
- Proposal application is an idempotent, journaled operation with stale-state checks and compensation. Google does not provide a transaction spanning multiple events. A failed compensation remains visible as a recovery operation; do not assume a failed request left the remote calendar untouched.
- Google can change between availability checks and writes. Event etags protect updates; synchronization reconciles independent external changes.

## Mobile development

Node 22.13+ is required. The project pins Expo SDK 57 and matching React Native dependencies. Run `npx expo install` from `apps/client` when adding Expo-native packages.

For a physical device, set `EXPO_PUBLIC_API_URL` to a reachable API URL or your development computer’s LAN address; `localhost` on a phone refers to the phone. Use HTTPS for a deployed backend. Configure the Google callback to reach the server, and preserve the `aligned` application scheme.

```sh
npm run ios -w @aligned/client
npm run android -w @aligned/client
```

Use **development builds**, not Expo Go, for the custom alarm module and native speech recognition. iOS builds require Xcode 26.4+ and the corresponding SDK; this development machine initially had Xcode 16.4/iOS 18.5. Android requires an installed SDK/JDK compatible with Expo 57. Generated native projects are ignored; Expo config plugins recreate the required configuration.

### Reminders and alarms

Enable reminders in **Settings → Account**. The scheduler inspects the expected context at T−15 ahead of time. Classes, meetings, non-interruptible events, and explicit quiet rules suppress prominent alarms. Interruptible activities and free time allow them.

- iOS: AlarmKit on supported versions, with explicit authorization and `NSAlarmKitUsageDescription`; notification fallback elsewhere. No countdown presentation is used, so no countdown Live Activity widget is required.
- Android: AlarmManager with exact-alarm access, notification permission, an alarm notification/activity, sound service, cancellation, and reboot rescheduling. Full-screen presentation remains subject to OS permissions and settings.
- Web: browser notifications while Aligned is open. Browser timers and notifications do not provide native Clock-app guarantees. Google Calendar’s own reminders operate independently.

Reconciliation cancels/reschedules device alerts after received schedule changes. A suspended or offline device cannot immediately receive changes made elsewhere. Notification denial never prevents scheduling. Test permission denial, background delivery, reboot, time-zone changes, cancellation, and a real meeting on physical devices before relying on prominent alarms.

### Voice

Web uses browser speech recognition where available. Optional audio-upload fallback preserves the previous Whisper/FFmpeg flow. Configure `WHISPER_CLI` and `WHISPER_MODEL` and install `ffmpeg` to enable it. Uploads require authentication, have a 15 MB limit and process timeouts, and are removed after processing.

Native uses `expo-speech-recognition`. Microphone/recognition denial leaves text input available. Voice produces editable text and uses the same backend as typed messages.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run test:integration
npm exec -- playwright install chromium
npm run test:e2e
npm run verify:visual
npm run build
npm run doctor
```

For actual PostgreSQL repository checks against a disposable, migrated database:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/aligned_test npm test
```

The PostgreSQL test creates and removes only its own random test users. API tests mock Google and Gemini. Browser tests run against demo mode. Neither passing mocks nor a web export establishes that Google OAuth, Calendar account capabilities, native audio, or native alarms work on a particular device. Record those checks separately.

## Future capture/email ingestion

The shared `captureSchema` defines source, candidate type, status, title, and an external reference. A future ingestion worker can create review candidates; acceptance should convert a reviewed candidate into the same validated deadline/event intent and proposal workflow. Gmail parsing, Gmail scopes, and message sending are intentionally absent.

## Environment variables

The root `.env.example` documents every supported value. Only public Expo build configuration (API origin and Expo project ID) is exposed to the client. `APP_MODE=demo` selects isolated simulation; `APP_MODE=google` enables PostgreSQL/Google. `GEMINI_MODEL` is configurable. `CLIENT_URL` controls CORS, `PUBLIC_URL` controls secure cookie behavior, and `PORT` defaults to 3000. Never place backend credentials in `EXPO_PUBLIC_*` variables.

### Migration interface

The original Vite interface remains available with `npm --prefix frontend run dev` after installing its dependencies. It uses the authenticated API, editable voice transcripts, and explicit **Apply Changes** for previews. Demo mode permits its default `http://localhost:5173` origin. In Google mode, set `LEGACY_CLIENT_URL=http://localhost:5173` only while using that interface. Google sign-in returns to the configured `CLIENT_URL`; the session also works in the migration interface.

`node backend/server.js` now starts the new authenticated server. The original implementation is preserved as an inactive reference in `backend/legacy/server.js.reference`. Install the root workspace dependencies first; use only one API server on port 3000.

Series-wide time moves require the complete bounded series to fit within the synchronized horizon. An unbounded or longer imported series can be edited by occurrence, or shortened in Google before requesting a series move. Proposal cards let you expand and review every occurrence before applying.

The current PostgreSQL implementation serializes calendar mutation jobs within each server process and uses a PostgreSQL advisory lock for each user across processes. This favors safe journaled recovery over high mutation throughput; a dedicated worker queue can increase throughput later without changing the API contracts.

Compatibility sources: [Expo SDK requirements](https://docs.expo.dev/versions/latest/), [Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview), [Google labels](https://developers.google.com/workspace/calendar/api/guides/labels), [Google synchronization](https://developers.google.com/workspace/calendar/api/guides/sync), [AlarmKit](https://developer.apple.com/documentation/AlarmKit/scheduling-an-alarm-with-alarmkit), and [Android alarms](https://developer.android.com/develop/background-work/services/alarms).

The current [verification record](docs/VERIFICATION.md) lists passing checks, the remaining dependency advisory, and exact live-account/native-device steps that could not be completed locally.

## Personal laptop + phone deployment

Follow [PERSONAL_DEPLOYMENT.md](docs/PERSONAL_DEPLOYMENT.md), phases A–L, for one public HTTPS backend, PostgreSQL, Google OAuth, EAS preview installation, and the exact cross-device acceptance checklist. `Dockerfile` and `npm run start:production` serve the built Expo web app and authenticated API from the same origin. `npm run build` builds both server and web; `npm run verify:production` smoke-tests those artifacts locally after a build.

Authenticated `/api/v1/changes` streams invalidate the signed-in user's data after persisted app changes and queued Google watch synchronization. Streams reconnect with backoff, active clients poll every minute, and Google polling runs every five minutes. Native foreground/browser visibility and network reconnect trigger fresh retrieval and alert reconciliation. Local cache is scoped by user and visibly stale offline; remote mutations are never queued or optimistically reported as successful.

Settings → Account shows identity, sync time, connection and device status. **Sign out this device** removes only that session/device registration. **Disconnect Google** revokes the shared Google connection while retaining Aligned metadata. Enable reminders to register native push delivery. Data-only push hints can trigger background reconciliation, subject to OS delivery limits; no visible calendar-change spam or guaranteed suspended-device alarm updates are claimed. The optional server-scheduled visible meeting-push safety net remains explicitly deferred.

For native builds, `EXPO_PUBLIC_API_URL` is the public backend origin and `EXPO_PUBLIC_EAS_PROJECT_ID` is the public Expo project UUID. Optional EAS file variable `GOOGLE_SERVICES_JSON` supplies Android Firebase configuration. These build values are separate from server credentials. Web production exports default to their own origin when `EXPO_PUBLIC_API_URL` is empty. Use one backend instance until the process-local broker/OAuth handoff store are replaced with shared implementations.
