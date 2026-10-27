# Gather | School Event Attendance

A mobile-first Angular app for school event check-in, seat assignments, attendance reporting, and SMS-style notifications. It runs in a desktop browser and is sized for a 390 × 844 mobile emulator. The app uses standalone Angular components, Angular Router, signals, and a blank workspace on first launch.

## Install and run

Use Node.js 22 or newer, then from this project directory run:

```sh
npm install
npm start
```

Open `http://localhost:4200`. Choose Organizer, then add your students and events. The Student view becomes available after students are added. No `ng new` step is needed because this is an existing Angular 22 project.

Run the production build and tests with:

```sh
npm run build
npm test -- --watch=false
```

The production build emits an Angular service worker, `manifest.webmanifest`, and an app icon. To test PWA installation and offline shell caching, serve the production `www` output from `localhost` or HTTPS; the service worker is disabled by `ng serve` in development mode.

## Workspace data and structure

- `src/app/core/models/school-event.models.ts`: Student, SchoolEvent, Seat, AttendanceRecord, SmsMessage, SyncItem, and related types.
- `src/app/core/services/`: browser-local store, event, attendance, seating, SMS, and sync services.
- `src/app/home/`: route-driven organizer/student screens and mobile layout.
- `src/app/app.routes.ts`: lazy-loaded login and workspace routes.
- `src/manifest.webmanifest` and `ngsw-config.json`: PWA metadata and offline asset policy.
- `cloudflare-api/`: Cloudflare Worker API and D1 SQLite schema/migrations.
- `server/`: legacy Node API for existing local XAMPP installations.

## Hosted shared database and offline setup

The recommended shared setup uses **Cloudflare Workers + D1**. The Worker hosts the API and D1 stores the school data, so neither XAMPP nor a tunnel to a computer needs to stay running. The Worker URL is stable. The app keeps its SQLite/local cache for offline use and syncs when it reconnects.

### Hosted Cloudflare setup

The production Worker and D1 database are provisioned and migrated. The Worker URL is `https://gather-school-api.gather-school-api.workers.dev`, and production app builds use `https://gather-school-api.gather-school-api.workers.dev/api` by default. Check `https://gather-school-api.gather-school-api.workers.dev/api/health` for `{"status":"ok"}` before sign-in. The signing secret is stored as a Cloudflare Worker secret and must not be committed.

To deploy code updates later, sign in with Wrangler and run `npm --prefix cloudflare-api run deploy -- --config wrangler.toml`. Apply any new migration with `npx wrangler d1 migrations apply gather-school-data --remote --config cloudflare-api/wrangler.toml`. Do not run `db:create` for this deployment; that command creates a different empty database.

The first organizer account registered creates the school workspace. Registration is then closed to the public. Organizers add student roster entries, sync them, and use Settings → School accounts to create linked student accounts or additional organizer accounts, and to reset passwords. Each student account can read only its own student pass and attendance; only organizers can change shared workspace data. To create a student login, first save and sync that student's roster record so the account can be securely linked to it.

Workspace changes are cached locally first (SQLite on Android/iOS, local storage in browsers) and sync to D1 while online. Multiple organizer devices share the same school workspace. Students sign in with the username/password their organizer created. Password resets are handled by an organizer; there are no email addresses or email-based resets in this username/password setup.

The deployed D1 database starts empty. On the first organizer device, existing locally cached workspace data is automatically merged into the new empty shared workspace during sync. Data that exists only in the old MySQL server and is not present in a device cache is not automatically copied; old server accounts also need to be recreated.

To run the Worker locally after setup, create `cloudflare-api/.dev.vars` with a private `JWT_SECRET` of at least 32 characters, then use `npm run db:migrate:local` and `npm run start:api` from the repository root. The local API address is `http://localhost:8787/api`. Local D1 data is separate from the deployed Cloudflare database. Do not commit `.dev.vars`.

### Update the Android app

Changes made in the project do not update an already installed APK automatically. Rebuild and reinstall the Android app after changing the scanner or Settings UI:

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Use JDK 17 or newer for the Android build. The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. Production builds already use the deployed Cloudflare Workers API address; the API editor in the bottom **Settings** tab is available if the service URL changes. On Android, grant the app camera permission in the system prompt; the scanner requests live video through the Android WebView camera API.

Organizer accounts in the same school see the shared roster, events, and attendance. Student accounts are linked to one roster entry and cannot write organizer data. Passwords are hashed by the API; never put signing secrets or database credentials in the Angular app.

After a successful sign-in, changes are saved locally first (SQLite on Android/iOS) and uploaded when the connection is available. Organizer devices check for remote updates every 15 seconds while the app is visible; Settings → Sync now can also pull updates immediately. Offline mode requires a prior successful sign-in on that device. Browser preview uses local storage instead of the native SQLite plugin.

The app creates no sample students, sections, or events. Add students from Home → Students and create events from Home → Create event. Sections and event seats are generated from the entries you provide. Logged-in devices cache the full workspace in on-device SQLite and sync it through the Cloudflare Worker API to D1. Browser preview uses `localStorage` as its offline cache. SMS messages are stored locally with the workspace and included in sync. Existing SMS records are migrated on first launch. Settings → Clear all workspace data clears the local and shared workspace.

## Organizer workflow

1. **Roster and event setup:** choose Organizer, add students with their sections and mobile numbers, then create an event.
2. **QR attendance:** choose Scan. Use Open camera scanner where camera permission is available, or choose a student and tap Simulate scan. Repeat a valid scan for time-out.
3. **Seating enforcement:** open Seat map, tap seats for student details, inspect available/assigned/checked-in/violation states, and review the event violation log.
4. **Live monitoring:** open Monitor, search by name/section, and filter Present, Late, Incomplete, or Absent. Scan in and out to update the record and duration.
5. **Section reporting:** open Reports, tap a section to expand its student list, and use Export CSV to download a summary.
6. **SMS and offline sync:** open SMS outbox → Compose SMS, choose all students, a section, or one student, select a reminder/schedule/cancellation/attendance template, and send. Toggle the Online pill or Settings switch to simulate offline, scan or send again, then switch online and use Sync now. Student role includes the generated QR pass, seat assignment, events, and attendance history.

## Prototype limitations

- SMS delivery is simulated in the local outbox. “Open in SMS app” creates an `sms:` link; the browser/device decides whether it can open a messaging app.
- Camera scanning requires browser camera permission and a secure context (`localhost` or HTTPS). Simulate Scan is always available.
- Real cross-device storage requires the deployed Cloudflare Worker and D1 database to be available; no local server or tunnel needs to stay running. The online/offline simulation toggle is only for testing offline behavior.
- Offline data remains on the current device until it successfully synchronizes to the shared API/database. Keep devices online periodically so their changes can sync.
- PWA shell caching is configured for production. Camera use and saved browser data still depend on browser permissions and storage policies.