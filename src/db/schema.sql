-- ═══════════════════════════════════════════════════════════════════════════
-- EventSnapAI / RaidCloud — Database Schema
-- Schema Version: 8.0 (2026-04-16)
--
-- Run against your frs database (fresh install):
--   docker exec -i compreface-postgres-db psql -U postgres -d frs < schema.sql
--
-- This script is idempotent — safe to re-run on an existing database.
-- All CREATE TABLE statements use IF NOT EXISTS.
-- Upgrade guards (ALTER TABLE ADD COLUMN IF NOT EXISTS) handle existing
-- installations that are missing newer columns.
--
-- Column history (removed — do NOT re-add):
--   users.password_plain — removed Stage 6.1 (2026-04-13): stored plaintext passwords
--   users.phone          — removed Stage 6.1 (2026-04-13): redundant, unused alternate number
--   past_customers.phone — removed Stage 6.1 (2026-04-13): same as above
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- Users (admin, manager, user roles)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  display_name  TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  is_active                  BOOLEAN     NOT NULL DEFAULT true,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 UUID        REFERENCES users(id),
  mobile                     TEXT,
  email                      TEXT,
  feature_manual_compression BOOLEAN     NOT NULL DEFAULT false,
  feature_album              BOOLEAN     NOT NULL DEFAULT false
);

-- Upgrade guards: add contact fields if upgrading from an older installation
-- (already included in CREATE TABLE above for fresh installs — no-ops there)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile                     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email                      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_manual_compression BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_album              BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

-- ═══════════════════════════════════════════════════════════════════════════
-- Past Customers (Archived deleted users — immutable audit log)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS past_customers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_user_id UUID,
  username         TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  role             TEXT        NOT NULL,
  mobile           TEXT,
  email            TEXT,
  deleted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Contact Requests (Landing Page / Contact Form)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contact_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  contact_info TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  is_read      BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Events
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,
  bucket_name          TEXT        NOT NULL UNIQUE,
  compreface_app_id    TEXT,
  recognition_api_key  TEXT,
  detection_api_key    TEXT,
  owner_id             UUID        REFERENCES users(id),
  jpeg_quality         INTEGER     DEFAULT NULL, -- NULL = use UPLOAD_JPEG_QUALITY env var (default 82)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade guards: add newer columns if upgrading from an older installation
-- (already included in CREATE TABLE above for fresh installs — no-ops there)
ALTER TABLE events ADD COLUMN IF NOT EXISTS compreface_app_id   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recognition_api_key TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS detection_api_key   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id            UUID REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS jpeg_quality        INTEGER DEFAULT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Indexed Photos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS indexed_photos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rustfs_object_id TEXT        NOT NULL,
  has_faces        BOOLEAN     NOT NULL DEFAULT true,
  face_count       INTEGER     NOT NULL DEFAULT 0,
  photo_date       TIMESTAMPTZ,
  indexed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, rustfs_object_id)
);

-- Upgrade guard: photo_date was added after initial release
-- (already in CREATE TABLE above — no-op for fresh installs)
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS photo_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_indexed_photos_event_id  ON indexed_photos(event_id);
CREATE INDEX IF NOT EXISTS idx_indexed_photos_has_faces ON indexed_photos(event_id, has_faces);

-- ═══════════════════════════════════════════════════════════════════════════
-- Event Access (many-to-many: users ↔ events with role-based permissions)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_access (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  can_upload  BOOLEAN     NOT NULL DEFAULT true,
  can_delete  BOOLEAN     NOT NULL DEFAULT true,
  can_manage  BOOLEAN     NOT NULL DEFAULT false,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_access_user  ON event_access(user_id);
CREATE INDEX IF NOT EXISTS idx_event_access_event ON event_access(event_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Photo Favorites (universal curation — managers mark highlights)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS photo_favorites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    UUID        NOT NULL REFERENCES indexed_photos(id) ON DELETE CASCADE,
  marked_by   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_favorites_event ON photo_favorites(event_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Feedback (from manager, client, and visitor portals via floating widget)
-- ═══════════════════════════════════════════════════════════════════════════
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
CREATE INDEX IF NOT EXISTS idx_feedback_role    ON feedback(role);
CREATE INDEX IF NOT EXISTS idx_feedback_is_read ON feedback(is_read);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications (admin to manager/user one-way push)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID        REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT       CHECK (recipient_role IN ('manager','user')),
  sender_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  is_pinned     BOOLEAN     NOT NULL DEFAULT false,
  is_discarded  BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- recipient_id NULL + recipient_role set = broadcast to all of that role
-- recipient_id set = targeted to specific user
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread    ON notifications(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_role      ON notifications(recipient_role, is_read);

-- ═══════════════════════════════════════════════════════════════════════════
-- Photo Album (premium shared print album — manager+client collaborative curation)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS photo_album (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    UUID        NOT NULL REFERENCES indexed_photos(id) ON DELETE CASCADE,
  added_by    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_photo_album_event ON photo_album(event_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Global Settings (Maintenance mode, etc.)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS global_settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);
