const { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteObjectCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

// Internal client — used for all mutating operations (upload, bucket ops, bucket checks).
const s3 = new S3Client({
  endpoint: process.env.RUSTFS_ENDPOINT,
  region: process.env.RUSTFS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY,
    secretAccessKey: process.env.RUSTFS_SECRET_KEY,
  },
  forcePathStyle: true, // required for S3-compatible stores
});

// Signing client — used exclusively to generate presigned URLs.
// Built with the PUBLIC endpoint so the SDK bakes the correct public hostname
// (e.g. https://storage.raidcloud.in) into the signed URL directly.
// Initialized ONCE at module load — not per-call — to avoid constructing
// hundreds of S3Clients on large photo gallery requests.
const signingClient = new S3Client({
  endpoint: process.env.RUSTFS_PUBLIC_ENDPOINT || process.env.RUSTFS_ENDPOINT,
  region: process.env.RUSTFS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY,
    secretAccessKey: process.env.RUSTFS_SECRET_KEY,
  },
  forcePathStyle: true,
});
/**
 * Ensure a bucket exists, create it if not.
 */
async function ensureBucket(bucketName) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`Created bucket: ${bucketName}`);

      await s3.send(new PutBucketCorsCommand({
        Bucket: bucketName,
        CORSConfiguration: {
          CORSRules: [{
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "HEAD"],
            AllowedOrigins: ["*"],
            ExposeHeaders: ["Content-Length", "Content-Type", "Content-Disposition"]
          }]
        }
      }));
      console.log(`Added CORS rules to bucket: ${bucketName}`);
    } else {
      throw err;
    }
  }
}

/**
 * Upload an image buffer to RustFS.
 * @returns {string} objectId — the key stored in RustFS
 */
async function uploadImage(bucketName, objectId, imageBuffer, mimeType) {
  await ensureBucket(bucketName);

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectId,
    Body: imageBuffer,
    ContentType: mimeType,
  }));

  return objectId;
}

/**
 * Generate a presigned URL for a given objectId.
 * URL expires after PRESIGNED_URL_EXPIRY seconds.
 *
 * The AWS SDK always embeds its configured endpoint in the signed URL.
 * To guarantee the browser-facing URL always points to the public RustFS
 * address, we sign using a dedicated client built with the public endpoint,
 * then log both the raw signed URL and the env values for debugging.
 */
async function getPresignedUrl(bucketName, objectId) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectId,
    ResponseContentDisposition: 'attachment',
  });

  const url = await getSignedUrl(signingClient, command, {
    expiresIn: parseInt(process.env.PRESIGNED_URL_EXPIRY || '21600', 10),
  });

  return url;
}

/**
 * Generate presigned URLs for multiple objectIds in one event bucket.
 */
async function getPresignedUrls(bucketName, objectIds) {
  const urls = await Promise.all(
    objectIds.map(async (objectId) => ({
      objectId,
      url: await getPresignedUrl(bucketName, objectId),
    }))
  );
  console.log(`[presign] Generated ${urls.length} presigned URLs for bucket: ${bucketName}`);
  return urls;
}

/**
 * Check if a bucket exists in RustFS.
 */
async function checkBucketExists(bucketName) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true; // Bucket is healthy and exists
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false; // Bucket was deleted!
    }
    throw err; // Some other network error
  }
}

/**
 * Delete all objects in a bucket then delete the bucket itself.
 * S3-compatible stores require the bucket to be empty before deletion.
 */
async function deleteBucket(bucketName) {
  // List and delete all objects first
  let continuationToken;
  do {
    const listRes = await s3.send(new ListObjectsV2Command({
      Bucket:            bucketName,
      ContinuationToken: continuationToken,
    }));

    const objects = (listRes.Contents || []).map(o => ({ Key: o.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects, Quiet: true },
      }));
    }

    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : null;
  } while (continuationToken);

  // Now delete the empty bucket
  await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));
  console.log(`Deleted bucket: ${bucketName}`);
}

/**
 * Delete a single object from a bucket.
 */
async function deleteObject(bucketName, objectId) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectId }));
}

module.exports = { uploadImage, getPresignedUrl, getPresignedUrls, ensureBucket, checkBucketExists, deleteBucket, deleteObject };
