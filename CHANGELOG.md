# Project Changelog

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
