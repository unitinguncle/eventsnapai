const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, async (req, res) => {
  const results = {};
  const CF_URL = process.env.COMPREFACE_URL;

  // 1. CompreFace API health
  try {
    const r = await axios.get(`${CF_URL}/actuator/health`, { timeout: 5000 });
    results.compreface_api = { ok: true, status: r.status };
  } catch (e) {
    results.compreface_api = { ok: false, status: e.response?.status, error: e.message };
  }

  // 2. CompreFace recognition key — list subjects
  try {
    const r = await axios.get(
      `${CF_URL}/api/v1/recognition/subjects`,
      { headers: { 'x-api-key': process.env.COMPREFACE_API_KEY }, timeout: 5000 }
    );
    const subjects = r.data.subjects || [];
    results.compreface_recognition = {
      ok:            true,
      subject_count: subjects.length,
      sample:        subjects.slice(0, 3),
    };
  } catch (e) {
    results.compreface_recognition = {
      ok: false, status: e.response?.status, error: e.response?.data || e.message,
    };
  }

  // 3. CompreFace detection key — health check via subjects endpoint of detection
  // Detection service doesn't have a subjects endpoint, so we check the API key
  // is set and recognition is working as a proxy for overall health
  results.compreface_detection_key_set = {
    ok: !!process.env.COMPREFACE_DETECTION_API_KEY,
    note: process.env.COMPREFACE_DETECTION_API_KEY ? 'Key is set' : 'COMPREFACE_DETECTION_API_KEY is missing',
  };

  // 4. RustFS
  try {
    const r = await axios.get(`${process.env.RUSTFS_ENDPOINT}/minio/health/live`, { timeout: 5000 });
    results.rustfs = { ok: true, status: r.status };
  } catch (e) {
    results.rustfs = { ok: false, status: e.response?.status, error: e.message };
  }

  const allOk = Object.values(results).every(r => r.ok);
  res.status(allOk ? 200 : 207).json({ allOk, results });
});

module.exports = router;
