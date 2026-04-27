'use strict';

/**
 * src/services/seaweedfs.js
 * Drop-in replacement for rustfs.js — same exported function signatures.
 * Uses @aws-sdk/client-s3 pointed at SeaweedFS S3 API (port 8333).
 *
 * Folder structure enforced here:
 *   originals:  {bucket}/{eventId}/photo_{photoId}.jpg
 *   thumbnails: {bucket}/{eventId}/thumbs/thumb_{photoId}.jpg
 *   face crops: {bucket}/{eventId}/faces/face_{photoId}_{faceIndex}.jpg
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload }       = require('@aws-sdk/lib-storage');

const s3 = new S3Client({
  endpoint:        process.env.SEAWEEDFS_S3_ENDPOINT || 'http://192.168.11.200:8333',
  region:          process.env.SEAWEEDFS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.SEAWEEDFS_ACCESS_KEY,
    secretAccessKey: process.env.SEAWEEDFS_SECRET_KEY,
  },
  forcePathStyle: true, // required for SeaweedFS
});

const DEFAULT_BUCKET = process.env.SEAWEEDFS_DEFAULT_BUCKET || 'eventsnapai';

// ── Key builders ──────────────────────────────────────────────────────────

function photoKey(eventId, photoId) {
  return `${eventId}/photo_${photoId}.jpg`;
}

function thumbKey(eventId, photoId) {
  return `${eventId}/thumbs/thumb_${photoId}.jpg`;
}

function faceKey(eventId, photoId, faceIndex) {
  return `${eventId}/faces/face_${photoId}_${faceIndex}.jpg`;
}

// ── Bucket management ─────────────────────────────────────────────────────

async function ensureBucket(bucket = DEFAULT_BUCKET) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[seaweedfs] Created bucket: ${bucket}`);
    } else {
      throw err;
    }
  }
}

// ── Upload helpers ────────────────────────────────────────────────────────

/**
 * uploadStream(bucket, key, stream, contentType)
 * Multipart streaming upload — does not buffer entire file in RAM.
 * Returns the ETag from SeaweedFS (MD5 of content — used for dedup).
 */
async function uploadStream(bucket, key, stream, contentType = 'image/jpeg') {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket:      bucket,
      Key:         key,
      Body:        stream,
      ContentType: contentType,
    },
    partSize:        5 * 1024 * 1024, // 5 MB per part
    queueSize:       2,
  });

  const result = await upload.done();
  return { key, etag: result.ETag?.replace(/"/g, '') };
}

/**
 * uploadBuffer(bucket, key, buffer, contentType)
 * Single-part upload for small buffers (thumbnails, face crops).
 */
async function uploadBuffer(bucket, key, buffer, contentType = 'image/jpeg') {
  const cmd = new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  });
  const result = await s3.send(cmd);
  return { key, etag: result.ETag?.replace(/"/g, '') };
}

/**
 * getPresignedUrl(bucket, key, expiresIn)
 * Returns a time-limited presigned URL for visitor photo access.
 */
async function getPresignedUrl(bucket, key, expiresIn = 21600) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/**
 * deleteObject(bucket, key)
 * Used when SeaweedFS ETag dedup detects a duplicate after upload.
 */
async function deleteObject(bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * getObjectStream(bucket, key)
 * Returns the raw ReadableStream from SeaweedFS.
 * Used by indexing worker to fetch compressed photo for InsightFace.
 */
async function getObjectStream(bucket, key) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Body;
}

/**
 * getObjectBuffer(bucket, key)
 * Fetches object and returns as a Buffer.
 * Used by indexing worker for face detection.
 */
async function getObjectBuffer(bucket, key) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks   = [];
  for await (const chunk of Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = {
  s3,
  ensureBucket,
  uploadStream,
  uploadBuffer,
  getPresignedUrl,
  deleteObject,
  getObjectStream,
  getObjectBuffer,
  photoKey,
  thumbKey,
  faceKey,
  DEFAULT_BUCKET,
};
