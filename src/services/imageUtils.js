// src/services/imageUtils.js
// Image quality calibration and compression estimation utilities.
// Used by upload.js (backend) — mirrors the same functions in manager/client portals (frontend).
// Keep the calibration math in sync if you update either side.

/**
 * Maps JPEG quality (0–100) to maximum output resolution (pixels on the longest side).
 *
 * Calibration anchor points:
 *   quality ≤ 82  → 1920 px  (current system default)
 *   quality = 92  → 2500 px
 *   quality = 100 → 4000 px
 *
 * Linear interpolation is applied between the two upper anchor pairs.
 * Below 82, resolution stays at 1920 px — a lower quality setting should reduce
 * file size but not resolution. The manager chooses quality, not resolution directly.
 *
 * @param {number|string} quality  JPEG quality 0–100
 * @returns {number}               Max dimension in pixels
 */
function qualityToMaxResolution(quality) {
  const q = Math.max(0, Math.min(100, parseInt(quality, 10)));
  if (q >= 92) return Math.round(2500 + ((q - 92) / 8) * 1500);  // 2500 → 4000
  if (q >= 82) return Math.round(1920 + ((q - 82) / 10) * 580);  // 1920 → 2500
  return 1920; // below 82: same max resolution, smaller file
}

/**
 * Estimates output file size in megabytes.
 * Formula: output = input × (quality/100)^0.7
 *
 * This is an approximation — actual JPEG compression ratio is content-dependent
 * (highly detailed images compress less than smooth gradients).
 *
 * @param {number} inputMB   Input file size in MB
 * @param {number} quality   JPEG quality 0–100
 * @returns {number}         Estimated output MB (2 decimal places)
 */
function estimateOutputSizeMB(inputMB, quality) {
  const q = Math.max(1, Math.min(100, parseInt(quality, 10)));
  return parseFloat((inputMB * Math.pow(q / 100, 0.7)).toFixed(2));
}

module.exports = { qualityToMaxResolution, estimateOutputSizeMB };
