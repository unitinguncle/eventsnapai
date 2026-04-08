# Project Changelog

## [Unreleased]
### Added
- **S3 CORS Automation**: Automatically configures buckets with permissive CORS (`PutBucketCorsCommand`) inside `src/services/rustfs.js` to allow direct-from-browser downloads via presigned URLs.
- **Upload-Time Micro-Thumbnails**: `src/routes/upload.js` now uses `sharp` to branch off a lightweight `thumb_<ID>.jpg` during upload. The admin panel natively tracks and lazy-loads this to safely view thousands of records in `index.html`.

### Changed
- **Match Results Prediction Limitation Removed**: Set the `prediction_count` parameter inside `searchByFace` (`src/services/compreface.js`) from `100` to `3000`. This ensures that high-visibility subjects (such as brides/grooms with hundreds of matches) don't get arbitrarily limited.
- **Improved Face Detection Limits (400 Error Fix)**: Lowered `det_prob_threshold` from `0.85` strictly down to `0.70` across `detectFaces` and `indexOneFace` (and `0.75` for `searchByFace`). This avoids rigorous rejection of obscure, side-angled poses occurring in Indian wedding rituals, correctly allowing those portraits to be indexed rather than dropping them into the `General` tab repository.

### Fixed
- Fixed 400 Status API Errors arising from initial CompreFace detection scan.
- Fixed the library tab crashing potential by restricting load buffers through thumbnail architecture.
