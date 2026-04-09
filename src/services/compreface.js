const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');

// All CompreFace calls go through the nginx gateway.
// Event isolation is achieved via subject name prefixing: "{eventId}__{objectId}"
//
// SUBJECT LENGTH BUDGET (CompreFace hard limit = 50 chars):
//   eventId (UUID4) = 36 chars
//   separator "__"  =  2 chars
//   objectId        = 12 chars  (8-char hex + ".jpg")
//   TOTAL           = 50 chars  ✓
const CF_URL      = () => process.env.COMPREFACE_URL;
const REC_API_KEY = () => process.env.COMPREFACE_API_KEY;
const DET_API_KEY = () => process.env.COMPREFACE_DETECTION_API_KEY;

// Similarity threshold — minimum score for a face match to count as "this person".
// CompreFace similarity scores are NOT linear probabilities. Scores above 0.92
// reliably indicate the same person; scores in 0.80–0.91 are frequently false
// positives (different people at similar angles/lighting in group photos).
// Raise this value if strangers are appearing in results.
// Lower it only if the same person is being missed across multiple photos.
const THRESHOLD   = () => parseFloat(process.env.FACE_SIMILARITY_THRESHOLD || '0.92');

const SUBJECT_SEP = '__';
function makeSubject(eventId, objectId) { return `${eventId}${SUBJECT_SEP}${objectId}`; }
function parseSubject(subject) {
  const idx = subject.indexOf(SUBJECT_SEP);
  if (idx === -1) return { eventId: null, objectId: subject };
  return {
    eventId:  subject.slice(0, idx),
    objectId: subject.slice(idx + SUBJECT_SEP.length),
  };
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect all faces in an image. Returns bounding boxes.
 * @returns {Array<{ x_min, y_min, x_max, y_max }>}
 */
async function detectFaces(imageBuffer, mimeType) {
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'image.jpg', contentType: mimeType });

  const res = await axios.post(
    `${CF_URL()}/api/v1/detection/detect`,
    form,
    {
      headers: { ...form.getHeaders(), 'x-api-key': DET_API_KEY() },
      params:  { det_prob_threshold: 0.70, limit: 20 },
    }
  );

  return (res.data.result || []).map(r => r.box);
}

// ── Indexing ──────────────────────────────────────────────────────────────────

/**
 * Index one padded face crop into CompreFace under subject "{eventId}__{objectId}".
 * The crop must already include 30% padding (done by upload.js).
 */
async function indexOneFace(imageBuffer, mimeType, eventId, objectId) {
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'image.jpg', contentType: mimeType });

  const subject = makeSubject(eventId, objectId);

  const res = await axios.post(
    `${CF_URL()}/api/v1/recognition/faces`,
    form,
    {
      headers: { ...form.getHeaders(), 'x-api-key': REC_API_KEY() },
      params:  { subject, det_prob_threshold: 0.70 },
    }
  );

  return res.data && res.data.subject ? res.data : null;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search for photos in this event containing the face in imageBuffer.
 *
 * Selfie pre-processing:
 *   1. Detect faces in the selfie using the detection service.
 *   2. Pick the LARGEST face (the person closest to the camera — the selfie taker).
 *   3. Crop with 30% padding so the recognition model sees enough context.
 *      Consistent with the padding used during indexing.
 *   4. Fall back to full selfie if detection fails.
 *
 * Threshold: default 0.92. Scores below this frequently represent different
 * people caught at similar angles in group photos — not the same person.
 *
 * @returns {string[]} objectIds of matched photos
 */
async function searchByFace(imageBuffer, mimeType, eventId) {
  // ── Step 1: detect + crop the selfie face ────────────────────────────────
  let searchBuffer = imageBuffer;
  let usingCrop = false;

  try {
    const selfieBoxes = await detectFaces(imageBuffer, mimeType);

    if (selfieBoxes.length > 0) {
      // Pick the largest face — most likely the selfie taker
      const primaryBox = selfieBoxes.reduce((best, box) => {
        const area     = (box.x_max - box.x_min) * (box.y_max - box.y_min);
        const bestArea = (best.x_max - best.x_min) * (best.y_max - best.y_min);
        return area > bestArea ? box : best;
      });

      const meta = await sharp(imageBuffer).metadata();
      const imgW = meta.width;
      const imgH = meta.height;

      const { x_min, y_min, x_max, y_max } = primaryBox;
      const w       = x_max - x_min;
      const h       = y_max - y_min;
      const marginX = w * 0.30;
      const marginY = h * 0.30;
      const left    = Math.max(0, Math.round(x_min - marginX));
      const top     = Math.max(0, Math.round(y_min - marginY));
      const cropW   = Math.min(imgW - left, Math.round(w + marginX * 2));
      const cropH   = Math.min(imgH - top,  Math.round(h + marginY * 2));

      searchBuffer = await sharp(imageBuffer)
        .rotate()
        .extract({ left, top, width: cropW, height: cropH })
        .jpeg({ quality: 90 })
        .toBuffer();

      usingCrop = true;
      console.log(`[search] selfie: cropped largest face with 30% padding (${cropW}×${cropH}) — event ${eventId}`);
    } else {
      console.log(`[search] selfie: no face detected by detector — sending full image — event ${eventId}`);
    }
  } catch (detectErr) {
    console.warn(`[search] selfie detection error, falling back to full image:`, detectErr.message);
  }

  // ── Step 2: recognise against indexed faces ──────────────────────────────
  const form = new FormData();
  form.append('file', searchBuffer, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

  const res = await axios.post(
    `${CF_URL()}/api/v1/recognition/recognize`,
    form,
    {
      headers: { ...form.getHeaders(), 'x-api-key': REC_API_KEY() },
      params:  {
        limit:              100,
        prediction_count:   3000,
        det_prob_threshold: 0.75,
        face_plugins:       '',
      },
    }
  );

  const faces = res.data.result || [];
  if (faces.length === 0) {
    console.log(`[search] CompreFace found no face in selfie — event ${eventId}${usingCrop ? ' (used crop)' : ' (used full image)'}`);
    return [];
  }

  const primaryFace = faces[0];
  const matches     = primaryFace.subjects || [];

  // Filter to this event only
  const eventMatches = matches.filter(m => {
    const { eventId: mEventId } = parseSubject(m.subject);
    return mEventId === eventId;
  });

  if (eventMatches.length === 0 && matches.length > 0) {
    console.log(`[search] WARNING: CompreFace returned ${matches.length} subjects but NONE belong to event ${eventId} — check subject format`);
  }

  // Log all scores — critical for threshold tuning
  console.log(`[search] event=${eventId} cf_total=${matches.length} this_event=${eventMatches.length} threshold=${THRESHOLD()}`);
  eventMatches.forEach(m => {
    const { objectId } = parseSubject(m.subject);
    console.log(`[search]   ${m.similarity >= THRESHOLD() ? 'PASS' : 'FAIL'} ${m.similarity.toFixed(4)} ${objectId}`);
  });

  // Apply threshold — only return photos where similarity is high enough
  // to confidently identify the same person
  const objectIds = [...new Set(
    eventMatches
      .filter(m => m.similarity >= THRESHOLD())
      .map(m => parseSubject(m.subject).objectId)
  )];

  console.log(`[search] returning ${objectIds.length} matched photos (threshold=${THRESHOLD()})`);
  return objectIds;
}

// ── Deletion ──────────────────────────────────────────────────────────────────

/**
 * Delete all face subjects indexed from a specific photo.
 * Since each face is indexed as "{eventId}__{objectId}", we delete that subject.
 * CompreFace may have multiple examples under the same subject — deleting
 * the subject removes all of them.
 */
async function deleteSubjectFaces(eventId, objectId) {
  const subject = makeSubject(eventId, objectId);
  try {
    await axios.delete(
      `${CF_URL()}/api/v1/recognition/faces`,
      {
        headers: { 'x-api-key': REC_API_KEY() },
        params:  { subject },
      }
    );
    console.log(`[compreface] Deleted subject: ${subject}`);
    return true;
  } catch (err) {
    // 404 = subject didn't exist (photo had no faces) — not an error
    if (err.response?.status === 404) {
      console.log(`[compreface] Subject not found (no faces): ${subject}`);
      return false;
    }
    console.warn(`[compreface] Failed to delete subject ${subject}:`, err.message);
    return false;
  }
}

module.exports = { detectFaces, indexOneFace, searchByFace, deleteSubjectFaces };
