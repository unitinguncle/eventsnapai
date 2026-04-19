# EventSnapAI / RaidCloud — Orchestration API Architecture

> [!NOTE]
> This service is the single entry point for all EventSnapAI operations. It orchestrates three external systems: PostgreSQL (state), CompreFace (face recognition), and RustFS (object storage).

---

## 1. System Architecture

```
Internet
   │
   ▼
[Cloudflare]              delivery.raidcloud.in / storage.raidcloud.in
   │                      (proxied, SSL terminated at Cloudflare edge)
   ▼
[Nginx Proxy Manager]     (reverse proxy — NPM on Docker host)
   │
[Tailscale network]       (secure tunnel — no open ports to internet)
   │
   ▼
[Docker Host]
   ├── orchestration-api :3001   ← This codebase
   │     Serves: REST API + static frontends (admin, manager, client, visitor, landing)
   │
   ├── compreface-api :8080      ← Face recognition engine
   ├── compreface-postgres-db :5432  ← Shared PostgreSQL (frs database)
   └── rustfs_local :9000        ← S3-compatible object store (public: storage.raidcloud.in)
         └── All services share [compreface2_default] Docker network
```

### Core Technologies

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (Alpine Docker image) |
| Web Framework | Express.js |
| Database | PostgreSQL via `pg` connection pool |
| Face Recognition | CompreFace via `axios` HTTP |
| Object Storage | RustFS (S3-compatible) via `@aws-sdk/client-s3` |
| Auth | JWT (`jsonwebtoken`) + bcrypt password hashing |
| Image Processing | `sharp` — thumbnail generation, face crop padding, JPEG compression throttling |
| EXIF | `exifr` — extracts photo date from uploaded images |
| HTTP Logging | `morgan` — combined format to Docker stdout |
| Email | `nodemailer` via Google SMTP |

---

## 2. User Roles & Workflows

### Role Hierarchy
```
admin > manager > user (client) > visitor (public)
```

### Admin
- Full system access — create events, manage all users, delete events (requires both `x-admin-key` AND `x-delete-key` headers).
- Unrestricted access: Can bypass system-wide Maintenance Mode.
- Can force-reset client/manager passwords.
- Can toggle system-level access flags (e.g. `feature_manual_compression`, `is_active`).
- Authentication: JWT (preferred) OR legacy `x-admin-key` header.

### Manager
- Manages their assigned events — uploads photos, manages client users, curates print albums, can delete their own events (password confirmation required).
- Subject to premium feature flags (grayed out manual compression for non-premium accounts).
- Authentication: JWT only.

### User (Client)
- Assigned to specific events by an admin.
- Can view photos in their event, manage favorites, and collaborate with the manager on curated event `Albums`.
- Authentication: JWT only.

### Visitor (Public)
- Scans QR code → receives short-lived JWT scoped to one event.
- Can perform selfie search within that event.
- Authentication: event-scoped JWT (6h expiry by default).

---

## 3. Key Workflows

### Photo Upload (Manager)
```
POST /upload/:eventId
  │
  ├── Validate manager has event access (event_access table)
  ├── Multer: receive up to 50 files in memory (40MB limit each)
  │
  ├── For each file:
  │     ├── Check SHA-256 hash for duplicates (skip if already indexed)
  │     ├── Extract EXIF date with exifr
  │     ├── User-defined Compression: Read JPEG quality settings (premium only)
  │     ├── Generate thumbnail with sharp (thumb_ prefix, max 400px)
  │     ├── Upload compressed original + thumbnail to RustFS bucket
  │     ├── Detect faces with CompreFace detection API
  │     └── For each detected face (max 100 faces):
  │           ├── Crop face with 30% padding (sharp)
  │           └── Index ONLY face-crop in CompreFace with subject = {eventId}__{photoId}
  │
  └── Response: 207 with per-file status array
```

### Visitor Selfie Search
```
GET /e/:eventId          → Redirect to /visitor#eventId (QR entry)
GET /events/:eventId/token → Issue visitor JWT (6h)

POST /search
  │
  ├── Validate visitor JWT (event scope check)
  ├── Detect face in selfie (CompreFace detection API, crops to largest subject)
  ├── Run vector recognition against entire database (prediction_count=3000)
  ├── Filter Node.js side against CompreFace subject prefix filter: {eventId}__
  ├── Apply FACE_SIMILARITY_THRESHOLD (0.991)
  ├── Deduplicate matched photo IDs
  ├── Query indexed_photos for metadata
  └── Generate presigned RustFS URLs (6h expiry)
      Response: { myPhotos, generalPhotos, favoritePhotos }
```

### Maintenance Mode
Admins can lock all non-system resources globally. A Boolean `maintenance_mode` value in PostgreSQL's `global_settings` table forces Express middleware to instantly intercept all manager/client/visitor requests with a `503 Service Unavailable`, projecting a blurred loading gate to the affected browsers.

---

## 4. Codebase Structure

```text
orchestration-api/
├── .dockerignore            # Build context exclusions (git, backups, secrets)
├── .env.example             # All required environment variables with documentation
├── CHANGELOG.md             # Full version history
├── PROJECT_ARCHITECTURE.md  # This file
├── STAGE_7_8_IMPLEMENTATION_PLAN.md  # Core planning docs
│
├── public/                  # Static frontends served by Express
│   ├── admin/               # Admin portal 
│   ├── manager/             # Manager portal 
│   ├── client/              # Client portal 
│   ├── visitor/             # Visitor API 
│   ├── landing/             # Public landing page
│   └── assets/              # Shared static assets: JS/CSS feedback widgets
│
└── src/
    ├── server.js            # Entry point: TCP bind, graceful shutdown, state load
    ├── app.js               # Cross-origin policies, Helmet, limits, 503 Middleware
    ├── state.js             # Singleton global state (isShuttingDown, isMaintenanceMode)
    │
    ├── db/
    │   ├── client.js        # PostgreSQL pool
    │   ├── schema.sql       # Idempotent DB state
    │   └── seed.js          # Default boot data
    │
    ├── middleware/
    │   └── auth.js          # Authentication gates & JWT logic
    │
    ├── routes/
    │   └── *.js             # Sub-layered REST boundaries (favorites, upload, etc)
    │
    └── services/
        ├── compreface.js    # Strict vector indexing logic
        ├── rustfs.js        # Zero-tier Object Storage bucket interactions
        └── mailer.js        # Gmail SMTP relay
```

---

## 5. Database Schema

See `src/db/schema.sql` for the full, self-documented schema. Highlights:

| Table | Purpose |
|-------|---------|
| `users` | Role-based entities with toggleable premium feature flags (`feature_manual_compression`, `is_active`) |
| `events` | Core metadata mapping to RustFS target buckets |
| `indexed_photos` | Origin files (sha256 tracked for zero-duplication) |
| `photo_album` | High-value curation space; managers/clients work on these albums post-event |
| `global_settings` | Infrastructure parameters (`maintenance_mode`) |
| `feedback` | Aggregated user reports spanning all portal surfaces |
| `notifications` | Live push notifications from Admin -> Client/Manager |

> [!TIP]
> All foreign keys cascade on DELETE — deleting an event automatically removes its `indexed_photos`, `event_access`, `photo_album` and `photo_favorites` records. No orphaned rows.

---

## 6. Security Model

| Mechanism | Detail |
|-----------|--------|
| JWT | RS256 signed, carries userId + role + eventId (visitors only) |
| Live `is_active` check | Every protected request queries DB — revoked accounts are blocked instantly |
| UUID Validation | All route params validated against UUID regex before hitting DB to prevent injection |
| Rate limiting | General: 120/req. Visitor entries: 30/min. Bypassed by Docker health pings |
| Password Isolation | Users/Clients don't see passwords post creation. Resets handled strictly by Admins/Managers via dedicated backend routes |
| File Thresholds | Multer backend cap at `40MB` matching local environment limits |

---

## 7. Deployment Procedure

Run locally via `docker build --no-cache -t my-orchestration-api:latest .` and pass arguments exclusively through the active `.env`. Portainer handles SIGTERM and gracefully flushes TCP requests.
