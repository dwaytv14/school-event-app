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

The Worker URL is `https://gather-school-api.gather-school-api.workers.dev`, and production app builds use `https://gather-school-api.gather-school-api.workers.dev/api` by default. Check `https://gather-school-api.gather-school-api.workers.dev/api/health` for `{"status":"ok"}` before sign-in. The signing secret is stored as a Cloudflare Worker secret and must not be committed.

To apply the role, section, and approval changes to the hosted service, install the Worker dependencies, sign in with Wrangler, apply migrations, then deploy:

```powershell
npm --prefix cloudflare-api install
npx wrangler d1 migrations apply gather-school-data --remote --config cloudflare-api/wrangler.toml
npm --prefix cloudflare-api run deploy -- --config wrangler.toml
```

Seed the super-admin account once after applying the migration. The username is `PPY-ADMIN`; the seed script reads the password from `SUPER_ADMIN_PASSWORD` rather than putting it in the app or repository:

```powershell
$env:SUPER_ADMIN_PASSWORD = '<the initial password>'
npm --prefix cloudflare-api run db:seed:super-admin
Remove-Item Env:SUPER_ADMIN_PASSWORD
```

Sign in as the super admin and add the course/year/section combinations under Settings before students register. Student signup is public and immediate: it creates a linked student profile and account on the server, and requires internet. New users select their course, year, and section and provide a Philippine mobile number. Super admins create organizer accounts and approve organizer-created events. Students receive only approved events, announcements, and their own QR pass. Organizer accounts are limited to scanning attendance at approved events and creating events, which remain pending until approved.

Workspace data is cached on each device (SQLite on Android/iOS; local storage in browser previews) and syncs to D1 when connectivity is available. After a successful first online sign-in, users can continue with the last saved workspace offline; changes sync after reconnecting. The installed APK connects directly to the hosted Worker and does not depend on `npm start` or a server running on the developer's computer.

Do not run `db:create` for this deployment; that command creates a different empty database. Data that exists only in the old MySQL server is not copied automatically; old accounts may need to be recreated.

`npm start` and development builds use the hosted Worker by default, so browser sessions share the same accounts and data as the deployed app. To run the Worker locally after setup, create `cloudflare-api/.dev.vars` with a private `JWT_SECRET` of at least 32 characters, then use `npm run db:migrate:local` and `npm run start:api` from the repository root. In the app, sign in to the hosted service and change the API address under Settings to `http://localhost:8787/api` to use the local Worker. Local D1 data is separate from the deployed Cloudflare database. Do not commit `.dev.vars`.

### Update the Android app

Changes made in the project do not update an already installed APK automatically. After the Worker migration and deployment, rebuild and reinstall the Android app:

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Use JDK 17 or newer for the Android build. The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. Production builds use the deployed Cloudflare Workers API address. On Android, grant the app camera permission in the system prompt; the scanner requests live video through the Android WebView camera API.

The API derives each user's role from their account; the sign-in page has no role selector. Passwords are hashed by the API; never put signing secrets or database credentials in the Angular app.

After a successful sign-in, changes are saved locally first (SQLite on Android/iOS) and uploaded when the connection is available. Signed-in devices check for remote updates every 15 seconds while the app is visible. Offline mode requires a prior successful online sign-in on that device. Browser preview uses local storage instead of the native SQLite plugin.

The app creates no sample sections, students, events, or announcements. Students register themselves. Organizers and super admins can create events with one or more required section groups; organizers' events stay pending until approval. Announcements are published by the super admin. Logged-in devices cache the workspace in on-device SQLite and sync it through the Cloudflare Worker API to D1. Browser preview uses `localStorage` as its offline cache. SMS messages are stored locally with the workspace and included in sync. Existing SMS records are migrated on first launch.

## Organizer workflow

1. **School setup:** sign in as `PPY-ADMIN`, configure sections in Settings, and create organizer accounts.
2. **Student registration:** students sign up online with their name, course, year, section, Philippine mobile number, username, and password. Their QR pass is generated from the linked profile.
3. **Event setup and approval:** organizers or the super admin create events and select required section groups. Organizer-created events remain pending until approved by the super admin.
4. **QR attendance:** organizers scan student passes for approved events. Attendance and changes sync when the device is online.
5. **Announcements and offline access:** the super admin publishes announcements for the school. Previously signed-in users can view their cached workspace offline; pending local changes sync after reconnecting.

## Prototype limitations

- SMS delivery is simulated in the local outbox. “Open in SMS app” creates an `sms:` link; the browser/device decides whether it can open a messaging app.
- Camera scanning requires browser camera permission and a secure context (`localhost` or HTTPS). Simulate Scan is always available.
- Real cross-device storage requires the deployed Cloudflare Worker and D1 database to be available; no local server or tunnel needs to stay running. The online/offline simulation toggle is only for testing offline behavior.
- Offline data remains on the current device until it successfully synchronizes to the shared API/database. Keep devices online periodically so their changes can sync.
- PWA shell caching is configured for production. Camera use and saved browser data still depend on browser permissions and storage policies.