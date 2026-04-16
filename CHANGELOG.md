# Project Changelog

## [Stage 7.1 — Post-Deploy Bug Fixes] — 2026-04-16

### Fixed
- **Manager & Client notification polling broken** (`public/manager/script.js`, `public/client/script.js`) — The notification polling functions (`pollMgrNotifications`, `pollCliNotifications`) and all related action calls (`markMgrNotifRead`, `pinMgrNotif`, `discardMgrNotif`, etc.) were calling an undefined `api()` function instead of the correct `apiFetch()` wrapper. This caused a silent `ReferenceError` on every poll cycle, meaning managers and clients never received push notifications — neither the toast popup nor the notification panel populated. Fixed by replacing all `api(...)` calls inside notification routines with `apiFetch(...)`.
- **Admin "Sent Notifications" table misaligned** (`public/admin/index.html`) — The `<table class="table">` did not map to any CSS definition; updated to `class="user-table"` to correctly inherit padding, cell borders, and column sizing.
- **Admin "Feedback & Requests" table misaligned** (`public/admin/index.html`) — Same root cause as above; updated `<table class="table">` to `class="user-table"` so column headings and data cells are properly aligned.

---

## [Stage 7B — Notification System] — 2026-04-15

### Added
- **`src/routes/notifications.js`** — New route file handling the full notification lifecycle:
  - `POST /notifications` (Admin) — Send a notification to a specific user (`recipientId`) or broadcast to all of a role (`recipientRole: 'manager' | 'user'`).
  - `GET /notifications/my` (Manager/User) — Returns all non-discarded notifications for the current user (direct + role-broadcast), sorted pinned-first then newest-first.
  - `GET /notifications/my/unread-count` (Manager/User) — Returns unread count for badge display.
  - `PATCH /notifications/:id/read` — Mark as read.
  - `PATCH /notifications/:id/pin` — Toggle pin.
  - `PATCH /notifications/:id/discard` — Soft-delete from user's view.
  - `GET /notifications/sent` (Admin) — List all sent notifications with recipient info.
- **`notifications` DB table** (`src/db/schema.sql`) — Stores notifications with: `recipient_id` (targeted) or `recipient_role` (broadcast), `sender_id`, `title`, `body`, `is_read`, `is_pinned`, `is_discarded`, `created_at`. Indexed on `recipient_id`, `recipient_role`, `is_read`.
- **Admin "Send Notification" section** (`public/admin/index.html`, `public/admin/script.js`):
  - Nav button to reach the notification composer.
  - Target selector: All Managers, All Clients, or Specific User (dropdown).
  - `loadSentNotifications()` — Loads and renders the sent notifications history table on section enter.
- **Manager notification UI** (`public/manager/index.html`, `public/manager/script.js`):
  - Bell icon in header with unread badge (dot indicator).
  - `startMgrNotifPolling()` — Polls every 30 seconds starting from page load.
  - `pollMgrNotifications()` — Fetches unread count + all notifications; shows toast for new arrivals since last check.
  - Toast popup (`mgr-notif-toast`) with title and body, auto-dismisses after 4 seconds.
  - Notification panel (slide-in) with filter tabs: All / Unread / Pinned.
  - Per-notification actions: Mark Read, Pin/Unpin, Discard.
- **Client notification UI** (`public/client/script.js`) — Mirror of manager notification system for client (`user`) role. Same polling, toast, and panel behavior.
- **Rate limiter** for `POST /notifications` registered in `src/app.js`.

### DB Migration Required
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id   UUID        REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT        CHECK (recipient_role IN ('manager','user')),
  sender_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  title          TEXT        NOT NULL,
  body           TEXT        NOT NULL,
  is_read        BOOLEAN     NOT NULL DEFAULT false,
  is_pinned      BOOLEAN     NOT NULL DEFAULT false,
  is_discarded   BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recipient_check CHECK (
    (recipient_id IS NOT NULL AND recipient_role IS NULL) OR
    (recipient_id IS NULL     AND recipient_role IS NOT NULL)
  )
);
```

---

## [Stage 7A — Feedback System] — 2026-04-15

### Added
- **`src/services/mailer.js`** — Shared nodemailer transporter singleton. All SMTP config from env vars. Used by both `contact.js` and `feedback.js` (no duplicated transporter setup).
- **`src/routes/feedback.js`** — New route file:
  - `POST /feedback` — Accepts submissions from any portal. Auth is **optional**: if a valid JWT is present, user identity (role, display name, event context) is auto-populated. Sends an email notification to `info@raidcloud.in` with `[Feedback]` subject prefix (non-blocking).
  - `GET /feedback` (Admin) — List all non-discarded feedback with `?role=`, `?unread=true`, `?pinned=true` filters. Joins with `events` for event name context.
  - `GET /feedback/unread-count` (Admin) — Unread count for nav badge.
  - `PATCH /feedback/:id/read`, `/pin`, `/discard` — Admin moderation actions.
- **`feedback` DB table** (`src/db/schema.sql`) — Stores feedback with role, display name, contact info, optional event context, and moderation state (`is_read`, `is_pinned`, `is_discarded`).
- **`public/assets/feedback-widget.js`** — Self-contained floating feedback button injected on all portals. Auto-prefills name from `sessionStorage.authUser`. Sends to `POST /feedback` with auth token if available.
- **`public/assets/feedback-widget.css`** — Styles for the floating 💬 button and modal. Uses app CSS variables (`--surface`, `--accent`, etc.) for theme consistency.
- **Admin Feedback section** (`public/admin/index.html`, `public/admin/script.js`):
  - New "Feedback" nav button with unread badge in parentheses.
  - `loadFeedback()` — Role and status filter controls, table view with per-item Read/Pin/Discard actions.
  - Unread count auto-updates nav tab label on section enter.
- **Feedback widget included on all portals**: `<script src="/assets/feedback-widget.js">` added to `admin`, `manager`, `client`, `visitor` portals.
- **`extractJwt`** exported from `src/middleware/auth.js` — Required by `feedback.js` for optional JWT identity extraction.

### Changed
- **`src/routes/contact.js`** — Replaced inline `nodemailer.createTransport(...)` with `const { sendMail } = require('../services/mailer')`. No behaviour change; eliminates duplicated SMTP config.
- **`src/app.js`** — Registered `/feedback` route with dedicated `feedbackLimiter` (10 req/min). Registered `/notifications` route.

### DB Migration Required
```sql
CREATE TABLE IF NOT EXISTS feedback (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  role         TEXT        NOT NULL CHECK (role IN ('manager','user','visitor','admin')),
  display_name TEXT,
  contact_info TEXT,
  event_id     UUID        REFERENCES events(id) ON DELETE SET NULL,
  message      TEXT        NOT NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  is_pinned    BOOLEAN     NOT NULL DEFAULT false,
  is_discarded BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## [Stage 7-BugFix — Critical Pre-Stage Bug Fixes] — 2026-04-15

### Fixed
- **Contact list crash on reload** (`public/admin/script.js`) — `loadContacts()` lacked an `r.ok` check before calling `.json()`. If the response was an error object, `data.filter()` threw a TypeError and the catch block rendered "Failed to load contacts". Added `r.ok` guard and array check before processing. Also updates the "Contact us forms" nav tab with unread count badge on every load.
- **Manager/Client: plain 401 showed "Failed to load events" instead of session expiry UI** (`public/manager/script.js`, `public/client/script.js`) — The `apiFetch()` function only handled `ACCESS_REVOKED` (403) with a branded overlay; plain 401 (JWT expired) was silently re-wrapped and fell through to generic error banners. Updated to call `showSessionExpired()` on 401 and throw `SESSION_EXPIRED`. All catch blocks updated to also suppress `SESSION_EXPIRED` errors.
- **Admin no inactivity logout** (`public/admin/index.html`, `public/admin/script.js`) — Added `startAdminIdleTimer()` on successful authentication. Resets on any mouse/keyboard/touch event. After 4 hours of inactivity, shows a full-screen "Admin Session Expired" modal and clears `adminKey` + `authToken` from sessionStorage.

### Added
- **Session Expired overlays** — Manager and client portals now show a branded 4-hour session expiry modal (matching the access-revoked overlay style) on 401 responses, with a "Go to Login" button.
- **Admin Session Expired modal** — Same pattern for the admin portal on idle timeout.

---

## [Stage 7.0 — Frontend Modularization] — 2026-04-15

### Changed
- **Frontend file structure refactored** — All five portals (`admin`, `manager`, `client`, `visitor`, `landing`) had their monolithic `index.html` files split into three clean files per portal:
  - `index.html` — Markup and DOM structure only
  - `styles.css` — All portal-specific CSS
  - `script.js` — All portal-specific JavaScript
- **No functionality changed** — Extraction was done programmatically via a script to guarantee 100% structural fidelity. All external asset references (`feedback-widget.js`, Google Fonts, QR API) preserved as-is.
- **Backend unchanged** — Express `express.static()` routing automatically serves the new `.css` and `.js` files; no routing changes required.
- **Backup preserved** — Original monolithic files remain in `backup_snapshot/` for rollback reference.

---

## [Stage 6.4 — Observability & Documentation] — 2026-04-13

### Added
- **HTTP access logging** (`src/app.js`) — `morgan` middleware added in `combined` format, logging every request to Docker stdout (method, path, status, response time, bytes, user-agent). `/health` requests are skipped to prevent health-probe noise every 30s from drowning out real traffic.
- **`morgan` dependency** added to `package.json` — installed during `docker build` via `npm install --omit=dev`.

### Changed
- **`/health` endpoint enriched** — replaced static `{"status":"ok"}` response with a live Postgres `SELECT 1` ping. Now returns:
  - `200 {"status":"ok","db":"connected"}` when healthy
  - `503 {"status":"degraded","db":"disconnected"}` when Postgres is unreachable
  - Health probes from Docker/Portainer now reflect actual system state, not just "container is alive".

### Documentation
- **`PROJECT_ARCHITECTURE.md` fully rewritten**:
  - Fixed all "Photographer" references → "Manager" (role was renamed earlier in the project)
  - Added accurate deployment chain diagram (Browser → Cloudflare → NPM → Tailscale → Docker)
  - Added complete **API Route Reference** table (all endpoints, auth requirements, descriptions)
  - Added **Security Model** table (JWT, is_active check, UUID validation, rate limits, trust proxy)
  - Added **Deployment Procedure** section (env vars, build command, fresh DB setup, network dependency)
  - Updated codebase directory structure to include new files (state.js, validateUuid.js, morgan, enriched health check)

## [Stage 6.3 — Schema Consolidation] — 2026-04-13

### Changed (`src/db/schema.sql`)
- **Schema version header added** — documents version, run instructions, fresh vs upgrade path, and a column removal history (password_plain, phone, past_customers.phone).
- **All columns now appear in their `CREATE TABLE` definitions** — previously, many columns (mobile, email on users; compreface_app_id, recognition_api_key, detection_api_key, owner_id on events; photo_date on indexed_photos) existed ONLY in ALTER TABLE guards. A fresh deployment would get the correct schema but the file gave no indication of the full table shape. All columns now visible in `CREATE TABLE` for human readability.
- **Removed redundant `ALTER TABLE` guards** — `has_faces` and `face_count` were listed in both `CREATE TABLE indexed_photos` AND in `ALTER TABLE` upgrade guards. The duplicate guards are removed (column is in `CREATE TABLE`).
- **Retained all remaining upgrade guards** — ALTER TABLE guards for mobile, email, compreface_app_id, recognition_api_key, detection_api_key, owner_id, and photo_date are kept for existing installations upgrading from older versions. They are no-ops on fresh installs.
- **Schema is fully idempotent** — confirmed by running against the live production database: every statement returned `NOTICE: already exists, skipping` with zero errors.

### No DB Migration Required
This is a schema file cleanup only. No changes to the live database structure. The file is documentation + safety net for fresh deployments.

## [Stage 6.2 — Resilience & Correctness] — 2026-04-13

### Added
- **`src/state.js`** — singleton shared state module. Holds `isShuttingDown` flag accessible to all route handlers without circular dependencies.

### Server Lifecycle
- **Graceful shutdown** (`src/server.js`) — SIGTERM/SIGINT handlers now:
  1. Set `isShuttingDown = true` immediately (maintenance mode)
  2. Stop accepting new connections (`server.close()`)
  3. Drain in-flight requests (up to 60s hard timeout)
  4. Close the Postgres connection pool (`db.end()`)
  5. Exit with code 0 (clean) or 1 (timeout forced)
- **Maintenance mode** (`src/routes/upload.js`) — new upload requests during shutdown immediately receive `503 { error: "Server is entering maintenance mode..." }` instead of being accepted then hard-killed mid-batch.

### Correctness
- **Admin event delete** (`src/routes/events.js`) — swapped order: Postgres DELETE now runs first (fully atomic with cascades), followed by RustFS bucket delete (best-effort). If RustFS fails after DB delete, the DB is already consistent; orphaned bucket can be cleaned manually.
- **Manager event delete** — all DB operations (exclusive client user deletion + event deletion cascade) now wrapped in a single `BEGIN`/`COMMIT`/`ROLLBACK` transaction. A failure at any step rolls back cleanly instead of leaving partial state.

### Rate Limiting & Trust Proxy
- **`trust proxy` set to 2** (`src/app.js`) — correct for Cloudflare → NPM (Nginx Proxy Manager) → App chain; ensures `req.ip` reflects the real client IP for rate limiting.
- **`/health` exempted from rate limiting** — health check moved before `app.use(generalLimiter)` so Docker/Portainer health probes never receive 429.
- **`/contact` dedicated rate limiter** — 5 requests/minute/IP (was covered only by the 120/min general limiter).
- **`/e/:eventId` visitor entry rate limiter** — 30 requests/minute/IP to throttle UUID enumeration.

### Code Quality
- **SQL dedup in `src/routes/users.js`** — extracted `buildUserListQuery(whereClause)` helper function. The GET /users handler no longer has 65 lines of copy-pasted SQL; both the filtered and unfiltered paths share the same query builder.
- **Error handler** (`src/app.js`) — logs full stack trace in non-production environments for easier debugging.

## [Stage 6.1 — Security Fixes & Performance] — 2026-04-13

### Removed (Security)
- **`password_plain` column entirely purged** — removed from `schema.sql` CREATE TABLE, all INSERT statements in `users.js`, and the password reset UPDATE. No plaintext password is stored anywhere in the system. DB migration: `ALTER TABLE users DROP COLUMN IF EXISTS password_plain`.
- **`phone` (alternate phone) column dropped** — redundant and unused. Kept `mobile` only with mandatory Indian number validation. DB migration: `ALTER TABLE users DROP COLUMN IF EXISTS phone` and `ALTER TABLE past_customers DROP COLUMN IF EXISTS phone`.

### Performance
- **S3 signing client pooled** (`src/services/rustfs.js`) — `signingClient` is now a module-level singleton initialized once at startup using `RUSTFS_PUBLIC_ENDPOINT`. Previously created a new `S3Client` on every `getPresignedUrl()` call, meaning a 100-photo gallery load triggered 200 S3Client constructions. Now: 0 per request after startup.

### Security
- **UUID input validation middleware** created (`src/middleware/validateUuid.js`) — validates all `:eventId`, `:photoId`, `:userId` route params against UUID regex before reaching DB queries. Returns HTTP 400 on malformed input.
- Applied to all parameterized routes: `events.js`, `photos.js`, `favorites.js`, `upload.js`, `users.js`.

### Frontend
- **`public/admin/index.html`** — removed `u.phone` fallback from all 3 mobile display cells. Mobile number is now the sole contact field. Simplifies display to `${u.mobile ? esc(u.mobile) : '—'}`.

### DB Migration Required (run BEFORE deploying this image)
```sql
ALTER TABLE users DROP COLUMN IF EXISTS password_plain;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
ALTER TABLE past_customers DROP COLUMN IF EXISTS phone;
```

## [Stage 6.0 — Stage 1 Cleanup & Hardening] — 2026-04-13

### Removed
- **`query_db.js`** deleted from repo root — was dead code with no callers anywhere in the codebase.
- **`src/{routes,services,middleware,db}/`** ghost empty directory deleted — accidentally committed shell glob expansion artifact.

### Added
- **`.dockerignore`** created — excludes `.git/`, `backup_snapshot/`, `*.md`, `.env*`, `query_db.js`, `*.bak*`, `node_modules/` from Docker build context. Reduces image build time and prevents backup/secret files from leaking into the image.

### Changed
- **SMTP single source of truth**: removed hardcoded `smtp.gmail.com` fallback from `src/routes/contact.js`. All SMTP config (host, port, secure, user, pass) now comes exclusively from environment variables. `docker-compose.yml` SMTP section updated to reference `${SMTP_HOST}`, `${SMTP_PORT}`, `${SMTP_SECURE}` — no hardcoded values remain.
- **`.env.example`** fully rewritten — added all missing variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `ALLOWED_ORIGINS`), documented `FACE_SIMILARITY_THRESHOLD=0.991` with production rationale, documented internal vs public RustFS endpoints, documented Gmail App Password requirement.
- **`src/middleware/auth.js`** — expanded `requireAdmin` comment to document the legacy `x-admin-key` path, its known limitation (no `is_active` DB check), and flags it with a `TODO` for future deprecation.

### Architecture Notes
- `backup_snapshot/` remains in the git repo for rollback purposes but is now excluded from Docker image builds via `.dockerignore`.
- `FACE_SIMILARITY_THRESHOLD=0.991` is production-tuned — set in Portainer stack env. `.env.example` documents the rationale.


## [Stage 5.0] — 2026-04-12 — Real-User Stress Test Improvements

### Security & Access Control
- **Live is_active check** on every `requireManager` / `requireUser` call — 403 `ACCESS_REVOKED` returned instantly on revocation.
- **Access Revoked Overlay** on Manager and Client portals — any API 403 shows full-screen "Access Blocked" overlay.
- **Removed Admin Login** from landing page — admin accesses `/admin` directly.
- **Admin user rows**: removed toggle and delete buttons to prevent self-lockout.

### Event Management
- **Manager Delete Event** (`DELETE /events/:eventId/manager-delete`): password-protected, deletes bucket + photos + exclusive client users + DB records.
- **Admin 2-Step Event Delete**: Step 1 confirm + Step 2 type bucket name — prevents accidental deletion.
- **Block manager delete**: returns `409` with event count if manager has assigned events.
- **Access-revoked message**: portals show branded overlay on deactivation.

### QR Code Enhancements
- **Branded Canvas QR**: black bg, RaidCloud blue modules, logo centered, album name + "EventSnapAI by RaidCloud" (golden) footer text.
- **QR Share via Web Share API**: native app drawer share with QR image file + message.

### UI / UX
- **Upload Complete Dialog**: modal with photo count summary and OK button after batch upload.
- **Skeleton Loaders**: shimmer skeletons on events grid, library, users table.
- **Admin Events List View**: sortable table with filter by manager/date/name, Grid/List toggle.
- **Auto-populate bucket name**: manager create-event modal auto-fills bucket ID from event name.
- **GET /events enriched**: returns `owner_name` and `photo_count` for admin list view.

### Backups
- bak11 snapshots: auth.js, events.js, users.js, landing/index.html, admin/index.html, manager/index.html, client/index.html

## [Stage 4.9] — GitHub Push & Architecture Snapshot (2026-04-12)
### Meta
- **Repository sync**: Pushed all Stage 4.5–4.8 changes to `feature/upcoming-changes` branch on GitHub (`unitinguncle/eventsnapai`).
- **Deployment architecture documented**: Stack is deployed via Portainer using a no-cache Docker image build. Image is rebuilt manually, then redeployed through the Portainer stack UI. No auto-deploy — all builds and redeploys are triggered by the user.
- **Backup files created** (`.bak10` series):
  - `backup_snapshot/client_index.html.bak10`
  - `backup_snapshot/manager_index.html.bak10`
  - `backup_snapshot/visitor_index.html.bak10`
  - `backup_snapshot/favorites.js.bak10`
  - `backup_snapshot/photos.js.bak10`
  - `backup_snapshot/search.js.bak10`
  - `backup_snapshot/rustfs.js.bak10`

---

## [Stage 4.8] — Graceful UI Auto-Remove (2026-04-10)
### Added
- **4-Second Optimistic Timeout**: Added an intelligent 4-second `setTimeout` to both the Manager and Client login panels. When you sit strictly on the "Favorites" tab and rapidly click the heart button to remove a photo from curation, it will animate the un-favorite action instantly, but deliberately wait 4 full seconds before mathematically re-rendering the layout and destroying the cell. This safeguards against accidental mis-clicks (since you can click it again to re-add it seamlessly), while simultaneously completely resolving the immutable grid-caching ghost bug.

## [Stage 4.7] — Manager & Client Favorites Polling + UX (2026-04-10)
### Added
- **Dynamic Favorites Polling**: Both Manager (`public/manager/index.html`) and Client (`public/client/index.html`) interfaces now utilize a 10-second background polling script (`syncFavorites()`). When an event is open, it silently checks the universal `photo_favorites` state and automatically paints/removes red hearts from grids in real-time without wiping user scrolling or multi-selections. Screen re-renders dynamically if they are actively on the Favorites tab.
- **Micro-Animations**: Added a CSS `@keyframes heartPop` animation to `.fav-btn` in Manager and Client interfaces. Invoking `.pop-anim` physically bounces the heart icon instantly upon click, enabling highly responsive optimistic UI feedback while the backend API resolves.

## [Stage 4.6] — Universal Favorites & Lightbox Bug Fix (2026-04-10)
### Fixed
- **Universal Favorites Sync**: Modified `src/routes/favorites.js` `GET` and `DELETE` paths to remove the `marked_by` strict ownership constraint. The Favorites system is now event-wide (universal). Both the Manager and Client can now see exactly the same curated "Highlights", avoiding curation duplication.
- **Client Lightbox Missing `fullUrl`**: Updated `src/routes/photos.js` to ensure `fullUrl` is generated alongside `thumbUrl` during the generic gallery fetch. The Client/Manager UI lightboxes will now successfully render the high-res file instead of a broken `<img>` element.

### Backup Files
- `backup_snapshot/favorites.js.bak9`
- `backup_snapshot/photos.js.bak9`

## [Stage 4.5] — Visitor Dynamic Background Updates (2026-04-10)
### Added
- **Silent UI Polling**: The visitor application (`public/visitor/index.html`) now caches the visitor's initial selfie drop (`currentBlob`). When switching between tabs (My Photos/General/Highlights), the app triggers a `silentRefresh` that hits the `/search` logic in the background to grab any newly uploaded or curated photos and dynamically inject them into the DOM without page loads.
- **Throttling Mechanism**: To protect the backend CompreFace inference server from being overloaded, the silent refresh is securely debounced to fire a maximum of once every 10 seconds.
- **Dynamic DOM Protection**: Arrays are only repainted, and multi-selection modes are only cleared if the server explicitly returns a new array length, preserving scroll and selection states otherwise.

### Backup Files
- `backup_snapshot/visitor_index.html.bak8`

## [Stage 4.4] — Visitor Highlights Refactor (2026-04-10)
### Changed
- **Visitor "Favorites" tab repurposed as "Highlights"**: Reverted the localStorage-based interactive favorite system. The visitor "Favorites" tab is now entirely read-only and displays photos curated/favorited by the Event Manager or Client.
- **Search API Update (`src/routes/search.js`)**: The POST `/search` endpoint now directly queries the `photo_favorites` table and serves the `favoritePhotos` payload alongside `myPhotos` and `generalPhotos`.

### Backup Files
- `backup_snapshot/search.js.bak7`
- `backup_snapshot/visitor_index.html.bak7`

## [Stage 4.3] — QA Testing Fixes (2026-04-10)
### Added
- **Visitor Favorites**: Added a full "Favorites" feature to the Visitor interface (via QR link). Visitors can now use a heart toggle over thumbnails to save images to local storage and view/download them via a new "Favorites" tab. 

### Fixed
- **Manager Upload Concurrency**: Restored the batch loop processing inside `manager/index.html` `startUpload()`. Rather than processing files one-by-one in sequence, the manager panel once again batches uploads 5 at a time concurrently, dramatically improving huge batch ingestion speed.
- **Responsive Camera Guide**: Updated `.face-guide` CSS in `visitor/index.html` and `client/index.html` from a hardcoded 200px width to `60vw/70vw` scaling width, fixing constraints on smaller mobile viewports.

### Backup Files
- `backup_snapshot/client_index.html.bak6`
- `backup_snapshot/manager_index.html.bak6`
- `backup_snapshot/visitor_index.html.bak6`

## [Stage 4.2] — QR Share Tab for Clients + Download Fix (2026-04-10)
### Added
- **QR Share tab** (`public/client/index.html`): Clients now have a "Share" tab in their event detail view displaying the visitor QR code and a copyable visitor link (`/e/{eventId}`). They can share this with guests directly from their panel. Tab is auto-populated when an event is opened.

### Fixed
- **Download broken across all pages**: Presigned URLs from RustFS were being served with implicit `Content-Disposition: inline`, causing browsers to open images in a new tab instead of downloading. Fixed by adding `ResponseContentDisposition: 'attachment'` to the `GetObjectCommand` in `src/services/rustfs.js`. This fix applies to all download points: Visitor (single, select, download all), Client (lightbox, download all favorites), Manager (download all favorites).
- **Manager favorites "Download All" silent failure** (`public/manager/index.html`): `downloadMgrFavs()` was referencing `favPhotos[i].fullUrl` which does not exist in the API response (only `thumbUrl` is returned). Fixed to use `thumbUrl` exclusively.

### Backup Files
- `backup_snapshot/client_index.html.bak5`
- `backup_snapshot/manager_index.html.bak5`
- `backup_snapshot/rustfs.js.bak5`

## [Stage 4.1] — Photographer Self-Serve Bucket & Client Creation (2026-04-09)
### Added
- **Self-Serve Buckets**: Photographers can now create new events (buckets) directly from their portal overview screen. Creating a bucket automatically grants them full management access (`event_access`).
- **Client Login Manager**: Added a 'Clients' tab within the photographer's Event Detail view to instantly spin up restricted user credentials specifically bound to that bucket. 

### Changed
- **API Access**: `POST /events` and `POST /users` upgraded to accept photographer JWTs. Security guarantees enforce photographers can only create `role=user` accounts, and strictly binds them to events the photographer is authorized to manage.


## [Stage 4] — Photographer Panel & Upload UX (2026-04-09)
### Added
- **Photographer panel** (`public/photographer/index.html`): Full JWT-authenticated dashboard. Lists only assigned events, upload with sticky progress bar, library with thumbnails sorted ascending, photo delete with ✕ button, QR code display.
- **Photo deletion API** (`DELETE /events/:eventId/photos/:photoId`): Removes photo from RustFS (original + thumbnail), deletes face subjects from CompreFace, and removes from Postgres. Available to admin and photographer.
- **EXIF date extraction**: Upload now extracts `DateTimeOriginal`/`CreateDate` from photo EXIF data using `exifr`, stored in `indexed_photos.photo_date` for chronological sorting.
- **Photographer events API** (`GET /events/my`): Returns only events assigned to the photographer via `event_access` table. Admin gets all events.
- **Sticky progress bar**: Both admin and photographer upload flows show a sticky progress bar with percentage during upload.
- **`deleteObject()`** in rustfs.js for single file deletion.
- **`deleteSubjectFaces()`** in compreface.js for removing indexed faces.

### Changed
- **Upload auth**: Now accepts photographer JWT (via `requirePhotographer`) in addition to admin key.
- **Photo listing**: Sorted by `COALESCE(photo_date, indexed_at) ASC` (oldest first).
- **Landing page**: Manager login now redirects to `/photographer` panel.


## [Stage 3] — Admin Panel: User Management & Event Ownership (2026-04-09)
### Added
- **Users API** (`src/routes/users.js`): Full CRUD — create, list, update, delete users. Password reset. Event access grant/revoke. All admin-only.
- **Admin User Management UI**: New "Users" top-level tab in admin panel with table view of all users, role-filtered sub-tabs (All/Photographers/Clients/Admins), active/inactive toggle switches, password reset modal, user creation modal, and delete with confirmation.
- **Event ownership**: Events now record `owner_id` from the authenticated user's JWT on creation.

### Changed
- **Admin panel layout**: Added top navigation bar switching between "Events" and "Users" sections.
- **app.js**: Mounted `/users` routes.

## [Stage 2] — Landing Page & Branded UI (2026-04-09)
### Added
- **Landing page** (`public/landing/index.html`): Premium dark-themed login portal at `delivery.raidcloud.in` with Manager Login, User Login, and Admin Login (modal). All authenticate via JWT.
- **Visitor splash screen**: RaidCloud logo animation with gentle pulse displayed for 2.5 seconds when a visitor scans the QR code, then smoothly fades to the welcome screen.
- **Inter font**: Google Fonts Inter loaded across all pages for consistent, modern typography.
- **Static assets route**: Logos and images served from `/assets` path.

### Changed
- **Color scheme** (all pages): Replaced purple `#534AB7` accent with RaidCloud blue `#4CAFE3` across light and dark modes.
- **Admin header**: RaidCloud logo with "EventSnapAI Admin" branding replaces old "EventSnap Admin" text.
- **Visitor welcome screen**: RaidCloud logo replaces camera emoji icon.
- **Root URL** (`/`): Now redirects to `/landing` instead of `/admin`.
- **Page titles**: All pages renamed from "EventSnap" to "RaidCloud EventSnapAI".


## [Stage 1] — Database & Auth Foundation (2026-04-09)
### Added
- **Users table** (`users`): Supports `admin`, `photographer`, and `user` roles with bcrypt-hashed passwords, active/inactive status, and creation tracking.
- **Event access table** (`event_access`): Many-to-many relationship linking users to events with granular permissions (`can_upload`, `can_delete`, `can_manage`).
- **Photo favorites table** (`photo_favorites`): Tracks photographer/user-marked favorites per event.
- **Login API** (`POST /auth/login`): Authenticates all roles via username + password, returns JWT token.
- **Session verification API** (`GET /auth/me`): Validates JWT and returns current user info.
- **Admin seeder** (`src/db/seed.js`): Auto-creates the first admin user from `ADMIN_API_KEY` on server boot. Idempotent — skips if admin already exists.
- **Role-based middleware**: `requirePhotographer` and `requireUser` middleware functions for future photographer/user panels.
- **Static assets route** (`/assets`): Serves logos and images from `src/assets/`.

### Changed
- **Auth middleware** (`requireAdmin`): Now accepts **both** legacy `x-admin-key` header **and** JWT Bearer tokens. Fully backward compatible — existing admin panel continues to work unchanged.
- **Presigned URL logging**: Replaced per-URL log spam with a single aggregate log (`Generated X presigned URLs for bucket: Y`). Drastically reduces Docker log noise for large albums.
- **Package renamed**: `orchestration-api` → `raidcloud-eventsnapai`.
- **CORS methods**: Added `PATCH` to allowed methods for future user management endpoints.

### Removed
- **`uuid` dependency**: Removed from `package.json`. Was never imported — all UUID generation uses Postgres `gen_random_uuid()`.

### Database Schema Changes
- `users` — NEW table
- `event_access` — NEW table
- `photo_favorites` — NEW table
- `events.owner_id` — NEW column (nullable, references users)
- `indexed_photos.photo_date` — NEW column (for EXIF date extraction in Stage 4)

---

## [Pre-Stage] — Initial Optimizations (2026-04-07/08)
### Added
- **S3 CORS Automation**: Automatically configures buckets with permissive CORS (`PutBucketCorsCommand`) inside `src/services/rustfs.js` to allow direct-from-browser downloads via presigned URLs.
- **Upload-Time Micro-Thumbnails**: `src/routes/upload.js` now uses `sharp` to branch off a lightweight `thumb_<ID>.jpg` during upload. The admin panel natively tracks and lazy-loads this to safely view thousands of records in `index.html`.

### Changed
- **Match Results Prediction Limitation Removed**: Set the `prediction_count` parameter inside `searchByFace` (`src/services/compreface.js`) from `100` to `3000`. This ensures that high-visibility subjects (such as brides/grooms with hundreds of matches) don't get arbitrarily limited.
- **Improved Face Detection Limits (400 Error Fix)**: Lowered `det_prob_threshold` from `0.85` strictly down to `0.70` across `detectFaces` and `indexOneFace` (and `0.75` for `searchByFace`). This avoids rigorous rejection of obscure, side-angled poses occurring in Indian wedding rituals, correctly allowing those portraits to be indexed rather than dropping them into the `General` tab repository.

### Fixed
- Fixed 400 Status API Errors arising from initial CompreFace detection scan.
- Fixed the library tab crashing potential by restricting load buffers through thumbnail architecture.
