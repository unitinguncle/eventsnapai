# Project Changelog

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
