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
| Image Processing | `sharp` — thumbnail generation, face crop padding |
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
- Can access all API routes.
- Authentication: JWT (preferred) OR legacy `x-admin-key` header.

### Manager
- Manages their assigned events — uploads photos, manages client users, can delete their own events (password confirmation required).
- Authentication: JWT only.

### User (Client)
- Assigned to specific events by an admin.
- Can view photos in their event, manage favorites.
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
  ├── Multer: receive up to 50 files in memory (20MB limit each)
  │
  ├── For each file:
  │     ├── Check SHA-256 hash for duplicates (skip if already indexed)
  │     ├── Extract EXIF date with exifr
  │     ├── Generate thumbnail with sharp (thumb_ prefix, max 400px)
  │     ├── Upload original + thumbnail to RustFS bucket
  │     ├── Detect faces with CompreFace detection API
  │     └── For each detected face:
  │           ├── Crop face with 30% padding (sharp)
  │           └── Index face in CompreFace with subject = {eventId}__{photoId}
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
  ├── Detect face in selfie (CompreFace detection API)
  ├── Crop face with 30% padding
  ├── Run recognition against all subjects in this event
  │     (CompreFace subject prefix filter: {eventId}__)
  ├── Filter results by FACE_SIMILARITY_THRESHOLD (0.991)
  ├── Deduplicate matched photo IDs
  ├── Query indexed_photos for metadata
  └── Generate presigned RustFS URLs (6h expiry)
      Response: { myPhotos, generalPhotos, favoritePhotos }
```

### Event Isolation (CompreFace)
Each photo's faces are indexed with subject name `{eventId}__{photoId}`. CompreFace is queried with a subject prefix filter — this achieves per-event isolation without needing separate CompreFace services per event.

---

## 4. Codebase Structure

```text
orchestration-api/
├── .dockerignore            # Build context exclusions (git, backups, secrets)
├── .env.example             # All required environment variables with documentation
├── CHANGELOG.md             # Full version history
├── Dockerfile               # node:20-alpine, npm install --omit=dev
├── docker-compose.yml       # Stack definition + env vars + health check
├── package.json             # Dependencies (no devDeps in production image)
├── PROJECT_ARCHITECTURE.md  # This file
│
├── backup_snapshot/         # Local rollback files — excluded from Docker builds
│
├── public/                  # Static frontends served by Express
│   ├── admin/               # Admin portal (full system management)
│   ├── manager/             # Manager portal (event + client management)
│   ├── client/              # Client portal (photo browsing + favorites)
│   ├── visitor/             # Visitor portal (selfie search)
│   └── landing/             # Public landing page (contact form)
│
└── src/
    ├── server.js            # Entry point: binds Express to port, graceful shutdown
    ├── app.js               # Express setup: CORS, helmet, morgan, rate limiting, routing
    ├── state.js             # Singleton shutdown state (isShuttingDown flag)
    │
    ├── db/
    │   ├── client.js        # PostgreSQL connection pool
    │   ├── schema.sql       # Full schema (idempotent — safe to re-run)
    │   └── seed.js          # Admin user seeding on first boot
    │
    ├── middleware/
    │   ├── auth.js          # requireAdmin / requireManager / requireUser / requireVisitor
    │   └── validateUuid.js  # UUID format validation for route params
    │
    ├── routes/
    │   ├── auth.js          # POST /auth/login, GET /auth/me
    │   ├── events.js        # CRUD for events, token issuance, client list
    │   ├── upload.js        # Photo upload with face indexing
    │   ├── photos.js        # Photo listing and deletion
    │   ├── search.js        # Selfie search (core visitor flow)
    │   ├── favorites.js     # Photo favorites management
    │   ├── users.js         # User management (CRUD + event access grants)
    │   ├── contact.js       # Contact form submission + email
    │   └── diagnostics.js   # Health checks for CompreFace + RustFS
    │
    └── services/
        ├── compreface.js    # detectFaces, indexOneFace, searchByFace, deleteSubjectFaces
        └── rustfs.js        # ensureBucket, uploadImage, deleteObject, getPresignedUrl
```

---

## 5. Database Schema

See `src/db/schema.sql` for the full, self-documented schema. Summary:

| Table | Purpose |
|-------|---------|
| `users` | Admin, manager, and user (client) accounts |
| `events` | Event records with RustFS bucket name and CompreFace keys |
| `indexed_photos` | Photos indexed per event, with face metadata |
| `event_access` | Many-to-many: which users can access which events + permissions |
| `photo_favorites` | Manager-curated highlighted photos per event |
| `past_customers` | Immutable archive of deleted user records |
| `contact_requests` | Contact form submissions from landing page |

> [!TIP]
> All foreign keys cascade on DELETE — deleting an event automatically removes its `indexed_photos`, `event_access`, and `photo_favorites` records. No orphaned rows.

---

## 6. API Route Reference

### Auth
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/auth/login` | None | Login with username + password → JWT |
| GET | `/auth/me` | Any JWT | Returns current user info |

### Events
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/events` | Admin | List all events |
| GET | `/events/my` | Manager/User | List events accessible to current user |
| POST | `/events` | Manager | Create new event + RustFS bucket |
| DELETE | `/events/:eventId` | Admin | Hard delete event (requires `x-delete-key`) |
| DELETE | `/events/:eventId/manager-delete` | Manager | Manager deletes own event (password confirm) |
| GET | `/events/:eventId/clients` | Manager | List clients linked to this event |
| GET | `/events/:eventId/token` | None (public) | Issue visitor JWT for this event |

### Upload
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/upload/:eventId` | Manager | Upload 1–50 photos; generates thumbs + indexes faces |

### Photos
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/events/:eventId/photos` | Manager/User | List all photos for an event with presigned URLs |
| DELETE | `/events/:eventId/photos/:photoId` | Manager | Delete one photo from RustFS + CompreFace + DB |

### Search
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/search` | Visitor JWT | Submit selfie → returns matched + general + favorite photos |

### Favorites
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/favorites/:eventId` | Manager/User | List favorited photo IDs for event |
| GET | `/favorites/:eventId/photos` | Manager/User | Full favorite photo details with presigned URLs |
| POST | `/favorites/:eventId/:photoId` | Manager/User | Add photo to favorites |
| DELETE | `/favorites/:eventId/:photoId` | Manager/User | Remove photo from favorites |

### Users
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/users` | Admin | List all users (optional `?role=` filter) |
| GET | `/users/past-customers` | Admin | List archived deleted users |
| POST | `/users` | Manager | Create new user |
| PATCH | `/users/:id` | Admin | Update user details |
| PATCH | `/users/:id/password` | Manager | Reset user password |
| DELETE | `/users/:id` | Admin | Delete user (archives to past_customers) |
| GET | `/users/:id/events` | Admin | List events accessible to user |
| POST | `/users/:id/events` | Admin | Grant user access to an event |
| DELETE | `/users/:id/events/:eventId` | Admin | Revoke user's event access |

### Contact
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/contact` | None (public, rate-limited 5/min) | Submit contact form + send email notification |
| GET | `/contact` | Admin | List all contact requests |
| PATCH | `/contact/:id/read` | Admin | Mark contact request as read |

### System
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/health` | None | DB ping — `{"status":"ok","db":"connected"}` or 503 degraded |
| GET | `/diagnostics` | Admin | Check CompreFace + RustFS connectivity |
| GET | `/e/:eventId` | None | QR code entry — redirect to `/visitor#eventId` |

---

## 7. Security Model

| Mechanism | Detail |
|-----------|--------|
| JWT | RS256 signed, carries userId + role + eventId (visitors only) |
| Live `is_active` check | Every protected request queries DB — revoked accounts are blocked instantly |
| UUID validation | All route params validated against UUID regex before reaching DB |
| Rate limiting | General: 120/min. Search: 10/min. Contact: 5/min. Visitor entry: 30/min |
| Trust proxy | Set to 2 (Cloudflare → NPM → App) — real client IP reaches rate limiter |
| `x-admin-key` | Legacy header path maintained for backward compat — does NOT check `is_active` |
| Presigned URLs | 6-hour expiry, `attachment` disposition — forces download, not inline display |
| Event isolation | CompreFace subject prefix `{eventId}__` — no cross-event face contamination |

---

## 8. Deployment Procedure

### Environment Variables (Portainer Stack)
All variables must be set in the Portainer stack environment. See `.env.example` for the complete list with documentation.

**Critical variables:**

| Variable | Notes |
|----------|-------|
| `ADMIN_API_KEY` | Must be a long random string. Also seeds the initial admin password. |
| `DELETE_API_KEY` | Second key required for admin event deletion — double confirmation. |
| `JWT_SECRET` | Long random string. Rotate only if compromised (all sessions invalidated). |
| `RUSTFS_PUBLIC_ENDPOINT` | Must be the public URL (e.g. `https://storage.raidcloud.in`) — used in presigned URLs. |
| `FACE_SIMILARITY_THRESHOLD` | `0.991` — production-tuned. Do not lower without real-event testing. |
| `SMTP_HOST` / `SMTP_PASS` | Gmail App Password required (not account password). |

### Build & Deploy (Current Workflow)
```bash
# 1. Make code changes
# 2. Build image (always --no-cache to prevent stale layers)
docker build --no-cache -t my-orchestration-api:latest .

# 3. Redeploy via Portainer stack UI
# Portainer sends SIGTERM → graceful shutdown (60s drain) → new container starts
```

### Fresh Database Setup
```bash
docker exec -i compreface-postgres-db psql -U postgres -d frs < src/db/schema.sql
```

### Network Dependency
The `orchestration-api` container must be on the `compreface2_default` Docker network (defined as `external: true` in `docker-compose.yml`). This is the shared network that also connects CompreFace and PostgreSQL. If CompreFace is not running, face detection/search will fail with 503 errors — the API itself will still start and serve non-search routes normally.

---

## 9. How to Run Locally (Development)

```bash
# 1. Copy env file and fill in values
cp .env.example .env

# 2. Point RUSTFS_ENDPOINT + COMPREFACE_URL at your local or remote instances
# 3. Start with nodemon (auto-restart on save)
npm run dev

# App runs on http://localhost:3001
# Frontends: /admin, /manager, /client, /visitor, /landing
```
