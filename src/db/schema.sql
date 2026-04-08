-- Run against your frs database:
-- docker exec -i compreface-postgres-db psql -U postgres -d frs < schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS has_faces  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE indexed_photos ADD COLUMN IF NOT EXISTS face_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_indexed_photos_event_id ON indexed_photos(event_id);
CREATE INDEX IF NOT EXISTS idx_indexed_photos_has_faces ON indexed_photos(event_id, has_faces);
