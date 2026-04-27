'use strict';

/**
 * src/services/insightface.js
 * HTTP client for the InsightFace FastAPI sidecar.
 * Replaces compreface.js — same call patterns, different backend.
 *
 * Sidecar endpoints:
 *   POST /detect  — full photo → [{face_index, bbox, det_score, embedding[512]}]
 *   POST /embed   — selfie    → {embedding[512], det_score}
 *   GET  /health  — liveness check
 */

const axios     = require('axios');
const FormData  = require('form-data');
const db        = require('../db/client');

const SIDECAR_URL = process.env.INSIGHTFACE_URL || 'http://insightface-sidecar:8001';

const sidecar = axios.create({
  baseURL: SIDECAR_URL,
  timeout: 30_000,
});

// ── Core sidecar calls ────────────────────────────────────────────────────

/**
 * detectFaces(imageBuffer)
 * Sends a full photo buffer to /detect.
 * Returns array of face objects with embeddings.
 */
async function detectFaces(imageBuffer) {
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

  const { data } = await sidecar.post('/detect', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength:    Infinity,
  });

  return data.faces || [];
}

/**
 * embedSelfie(imageBuffer)
 * Sends a selfie buffer to /embed.
 * Returns {embedding, det_score} for the best detected face.
 * Throws HTTP 422 if no face detected — caller must handle.
 */
async function embedSelfie(imageBuffer) {
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

  const { data } = await sidecar.post('/embed', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength:    Infinity,
  });

  return { embedding: data.embedding, det_score: data.det_score };
}

// ── pgvector storage ──────────────────────────────────────────────────────

/**
 * indexFace(eventId, photoId, faceIndex, embedding, cropUrl)
 * Stores a 512-d ArcFace embedding in pgvector.
 * ON CONFLICT: updates embedding (idempotent re-index).
 */
async function indexFace(eventId, photoId, faceIndex, embedding, cropUrl = null) {
  const vector = `[${embedding.join(',')}]`;
  await db.query(
    `INSERT INTO face_embeddings (event_id, photo_id, face_index, embedding, crop_url)
     VALUES ($1, $2, $3, $4::vector, $5)
     ON CONFLICT (photo_id, face_index)
     DO UPDATE SET embedding = EXCLUDED.embedding, crop_url = EXCLUDED.crop_url`,
    [eventId, photoId, faceIndex, vector, cropUrl]
  );
}

/**
 * searchByEmbedding(eventId, embedding, limit)
 * ANN cosine search scoped to a single event.
 * Uses the read pool (replica if lag is acceptable).
 */
async function searchByEmbedding(eventId, embedding, limit = 100) {
  const vector    = `[${embedding.join(',')}]`;
  const threshold = parseFloat(process.env.FACE_DISTANCE_THRESHOLD || '0.40');
  const pool      = await db.getReadPool();

  const { rows } = await pool.query(
    `SELECT photo_id,
            face_index,
            (embedding <=> $2::vector) AS distance
     FROM   face_embeddings
     WHERE  event_id = $1
       AND  (embedding <=> $2::vector) <= $3
     ORDER  BY embedding <=> $2::vector
     LIMIT  $4`,
    [eventId, vector, threshold, limit]
  );

  return rows;
}

/**
 * deleteFacesByPhoto(photoId)
 * Called by photo delete route — removes all face rows for a photo.
 */
async function deleteFacesByPhoto(photoId) {
  await db.query('DELETE FROM face_embeddings WHERE photo_id = $1', [photoId]);
}

/**
 * deleteFacesByEvent(eventId)
 * Called when an event is deleted.
 */
async function deleteFacesByEvent(eventId) {
  await db.query('DELETE FROM face_embeddings WHERE event_id = $1', [eventId]);
}

/**
 * sidecarHealth()
 * Returns the sidecar's health object.
 * Used by diagnostics route.
 */
async function sidecarHealth() {
  const { data } = await sidecar.get('/health', { timeout: 5000 });
  return data;
}

module.exports = {
  detectFaces,
  embedSelfie,
  indexFace,
  searchByEmbedding,
  deleteFacesByPhoto,
  deleteFacesByEvent,
  sidecarHealth,
};
