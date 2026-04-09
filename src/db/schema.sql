-- Run against your frs database:
-- docker exec -i compreface-postgres-db psql -U postgres -d frs < schema.sql

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
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

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
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add CompreFace per-event isolation columns if upgrading from previous schema
ALTER TABLE events ADD COLUMN IF NOT EXISTS compreface_app_id   TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recognition_api_key TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS detection_api_key   TEXT;

-- Add ownership (links event to the user who created it)
ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Indexed photos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS indexed_photos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rustfs_object_id TEXT        NOT NULL,
  has_faces        BOOLEAN     NOT NULL DEFAULT true,
  face_count       INTEGER     NOT NULL DEFAULT 0,
  indexed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, rustfs_object_id)
);

-- Add columns if upgrading from previous schema
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS has_faces   BOOLEAN     NOT NULL DEFAULT true;
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS face_count  INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS photo_date  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_indexed_photos_event_id  ON indexed_photos(event_id);
CREATE INDEX IF NOT EXISTS idx_indexed_photos_has_faces ON indexed_photos(event_id, has_faces);

-- ═══════════════════════════════════════════════════════════════════════════
-- Event access (many-to-many: users ↔ events)
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
-- Photo favorites
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
