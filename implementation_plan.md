# EventSnapAI Mobile App — Implementation Plan (Revised)
**Status**: ✅ Approved by user — Ready for execution
**Platform**: Android-first (iOS via Xcode MacBook later)
**Framework**: React Native (Expo managed workflow)
**Repo layout**: `mobile/` subfolder inside existing repo (`eventsnapAIv1Mobile/mobile/`)
**Backend**: Existing API at `delivery.raidcloud.in` — targeted additions only

---

## User Review Decisions (Locked In)

| Topic | Decision |
|-------|----------|
| Platform | Android first. iOS later using Xcode on MacBook. |
| Project location | `mobile/` subfolder inside existing backend repo |
| Admin section | **Web-only** — NOT in mobile app |
| App roles | Single app — Manager + Client + Visitor (role-based screens) |
| App structure | Splash → Home (Scan QR / Client Login / Manager Login) |
| QR deep-link | Android App Links — camera scan opens native app if installed |
| Rate limiting | JWT-based per-user (not IP-based general increase) |
| JWT expiry | 24h (extended from 6h) |
| Push notifications | Yes — both in-app toasts AND OS push notifications |
| QR compatibility | Single QR URL works for web AND app simultaneously |
| UI standard | Immich / Google Photos — NOT web-in-mobile format |
| UI colour scheme | Match RaidCloud website (dark bg, `#4CAFE3` RaidCloud blue accent) |
| Real-time sync | App and web stay in sync — changes reflect on both |

---

## Why `mobile/` Subfolder (Not Separate Repo)

Keeping mobile code inside the same repo:
- One `git push` keeps server + mobile in sync
- Shared `.env.example` can reference both
- CI/CD pipeline can trigger mobile builds when server changes
- Avoids duplicate README/doc overhead
- EAS Build (Expo) reads only the `mobile/` directory

Structure:
```
eventsnapAIv1Mobile/        ← existing repo root
├── src/                    ← backend (unchanged)
├── public/                 ← web frontends (unchanged)
├── mobile/                 ← NEW: React Native app
│   ├── app/
│   ├── components/
│   ├── services/
│   ├── assets/
│   ├── app.json
│   ├── eas.json
│   └── package.json
├── package.json            ← backend package.json (unchanged)
└── ...
```

---

## Phase 0: Server-Side Fixes (Before Any Mobile Code)

> [!IMPORTANT]
> These must be deployed FIRST. None of the mobile phases will function without them.

### 0.1 — CORS Fix (🔴 Critical)

**File:** `src/app.js`

Replace lines 36-39:
```js
// BEFORE
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
}));

// AFTER
app.use(cors({
  origin: (origin, callback) => {
    // React Native sends no Origin header — always allow null-origin (mobile native requests)
    if (!origin) return callback(null, true);
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    if (allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-admin-key', 'x-delete-key'],
  credentials: true,
}));
```

### 0.2 — JWT-Based Rate Limiting (🔴 Required)

**File:** `src/app.js`

Replace the general limiter:
```js
// Add at top of file
const jwt = require('jsonwebtoken');

// Replace generalLimiter
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by userId from JWT if available, else fall back to IP
  keyGenerator: (req) => {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        if (payload?.userId) return `user:${payload.userId}`;
      } catch {}
    }
    return `ip:${req.ip}`;
  },
});
```

### 0.3 — JWT + Presigned URL Expiry Extension

**Portainer stack env (no code change):**
```env
JWT_EXPIRES_IN=24h
PRESIGNED_URL_EXPIRY=86400
```

### 0.4 — Push Token Column + Endpoint

**DB migration (run once on live server):**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
```

**New route in `src/routes/users.js`:**
```js
/**
 * PATCH /users/me/push-token
 * Mobile app registers its Expo push token after login.
 * Called every time the app launches (token can rotate).
 */
router.patch('/me/push-token', requireUser, async (req, res) => {
  const { pushToken } = req.body;
  if (!pushToken || typeof pushToken !== 'string') {
    return res.status(400).json({ error: 'pushToken is required' });
  }
  try {
    await db.query('UPDATE users SET expo_push_token = $1 WHERE id = $2',
      [pushToken, req.user.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Push token update error:', err.message);
    res.status(500).json({ error: 'Failed to update push token' });
  }
});
```

**Modify `src/routes/notifications.js` — POST /notifications:**
```js
// Add at top of file
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

// Add AFTER the DB insert inside router.post('/'):
// --- Push notification dispatch (non-blocking) ---
try {
  let pushTokens = [];
  if (recipientId) {
    const r = await db.query('SELECT expo_push_token FROM users WHERE id = $1 AND expo_push_token IS NOT NULL', [recipientId]);
    if (r.rows[0]?.expo_push_token) pushTokens.push(r.rows[0].expo_push_token);
  } else if (recipientRole) {
    const r = await db.query(
      'SELECT expo_push_token FROM users WHERE role = $1 AND expo_push_token IS NOT NULL AND is_active = true',
      [recipientRole]
    );
    pushTokens = r.rows.map(row => row.expo_push_token);
  }

  const validTokens = pushTokens.filter(t => Expo.isExpoPushToken(t));
  if (validTokens.length > 0) {
    const messages = validTokens.map(to => ({
      to, sound: 'default',
      title: title.trim(),
      body: body.trim(),
      data: { notificationType: 'admin_notification', notificationId: result.rows[0].id },
      priority: 'high',
    }));
    expo.sendPushNotificationsAsync(messages).catch(err =>
      console.warn('[push] Send failed:', err.message)
    );
  }
} catch (pushErr) {
  // Non-fatal — DB notification is already saved
  console.warn('[push] Push dispatch error:', pushErr.message);
}
```

**Add to `package.json` (backend):**
```json
"expo-server-sdk": "^3.7.0"
```

### 0.5 — Android App Links (QR Deep-Link)

When a user scans the QR with their native Android camera, if the app is installed it should open instead of the browser.

**New endpoints in `src/app.js` (before rate limiter — must be fast):**
```js
// Android App Links verification
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.raidcloud.eventsnapai',
      // Replace with your actual SHA-256 from: keytool -list -v -keystore release.keystore
      sha256_cert_fingerprints: [process.env.ANDROID_CERT_FINGERPRINT || '']
    }
  }]);
});

// iOS Universal Links (for future)
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    applinks: {
      details: [{
        appIDs: [`${process.env.APPLE_TEAM_ID || 'TEAMID'}.com.raidcloud.eventsnapai`],
        components: [{ '/': '/e/*', comment: 'Event QR entry' }]
      }]
    }
  });
});
```

**New env vars:**
```env
ANDROID_CERT_FINGERPRINT=your_sha256_fingerprint_here
APPLE_TEAM_ID=your_apple_team_id (future)
```

---

## Phase 1: Visitor Flow (Android, 2–3 weeks)

**Goal:** Guests scan QR → take selfie → see their photos. This is the highest-traffic feature.

### Screens
1. **Splash Screen** — RaidCloud logo animation (lottie, 2.5s) → fade to Home
2. **Home Screen** — Three beautiful cards: `Scan QR` | `Client Login` | `Manager Login`
3. **QR Scanner** — Full-screen camera, auto-detect, animated scan guide box
4. **Selfie Camera** — Front camera, oval face guide, "Take Selfie" button
5. **Searching Screen** — Animated face-scan spinner with progress text
6. **Results Screen** — Bottom tab bar: My Photos | General | Highlights
7. **Photo Viewer** — Full-screen with pan/zoom, download, share

### UI Design Direction (Immich/Google Photos Standard)

```
Color Palette (matching RaidCloud website):
  Background:     #0A0F1E  (deep navy, matches web)
  Surface:        #141B2D  (card background)
  Surface2:       #1E2A42  (elevated cards, modals)
  Accent:         #4CAFE3  (RaidCloud blue — primary interactive)
  Accent-glow:    rgba(76,175,227,0.15)  (glow/highlight)
  Text-primary:   #FFFFFF
  Text-secondary: #8FA3CC
  Success:        #4CAF50
  Warning:        #FF9800
  Error:          #F44336

Typography:
  Font: Inter (Google Fonts via expo-google-fonts)
  Headings: Inter 700
  Body: Inter 400
  Caption: Inter 300

Photo Grid (like Google Photos):
  - Masonry layout (not square grid) for natural feel
  - Thumbnails load lazily via FlashList (much faster than FlatList)
  - Long-press → select mode (multi-select with checkmarks)
  - Pinch-to-zoom on grid (scale density)
  - Day/date headers between photo groups
  - Shimmer skeletons while loading

Photo Viewer (like Immich):
  - Full-screen swipe gallery (left/right navigation)
  - Swipe down to close (spring animation)
  - Metadata panel (date, size, event name)
  - Bottom action bar: Download | Share | Favourite
  - Double-tap to zoom
  - Blur background behind transparent modals
```

### Real-Time Sync (Web ↔ App)

When a manager favourites a photo on the web portal, the visitor app must reflect this when they switch tabs. We achieve this with:
- **Polling on tab focus**: When user switches to Highlights tab, re-fetch favourite IDs
- **AppState listener**: On app foreground, re-fetch gallery (catches presigned URL expiry too)
- This matches exactly how the web already works (10s polling) — no new backend needed

---

## Phase 2: Manager Flow (3–4 weeks)

### Screens
1. **Login Screen** — Username/password with RaidCloud branding
2. **Events Dashboard** — Card grid with event name, photo count, date, collaborative badge
3. **Event Detail** - Tab bar: **Upload** | **Library** | **Album** | **QR** | **Clients**
4. **Upload Tab** — Photo picker (multi-select from gallery/camera), per-file progress, batch summary
5. **Library Tab** — Masonry grid, delete mode, quality dial (premium)
6. **Album Tab** — Curated photos, drag-to-order (Phase 5)
7. **QR Tab** — Shareable QR with event name, native share sheet
8. **Clients Tab** — List with add/remove/reset password
9. **Notifications Panel** — Bell icon in header, slide-in panel, read/pin/discard

### Upload UX (Mobile-Specific)

```
Manager selects photos → app pre-compresses to 2048px JPEG 85% →
Upload in batches of 10 → per-file progress card →
On complete: "X photos uploaded, Y faces indexed" summary card
```

Client-side compression is critical to prevent cellular timeouts.

---

## Phase 3: Client (User) Flow (1–2 weeks)

### Screens
1. **Login** (shared with manager, role-branched after /auth/me)
2. **Event View** — Photos | Favourites | Share tabs
3. **Notifications** — Same panel as manager

---

## Phase 4: Collaborative Events (2–3 weeks)

### Collab Member Flow
- QR scan → detect collaborative event → show Member Login gate
- `POST /auth/member-login` → scoped event JWT
- 4 tabs: **Upload** | **My Photos** | **All Photos** | **Favourites**
- All Photos: uploader filter chips (like person filter in Google Photos)
- Group Favourites: gold star badge on manager-curated photos

---

## Phase 5: Push Notifications Integration (1 week)

- `expo-notifications` registers device token on login
- `PATCH /users/me/push-token` stores token on server
- `POST /notifications` (admin on web) triggers both DB notification AND Expo push
- App handles foreground: in-app toast (like web portal)
- App handles background: OS notification with deep-link to notification panel

---

## Complete Mobile App Architecture

```
mobile/
├── app/                        # Expo Router v3 (file-based routing)
│   ├── _layout.tsx             # Root: splash → auth guard → role router
│   ├── index.tsx               # Home screen (Scan QR / Login cards)
│   ├── (auth)/
│   │   ├── login.tsx           # Shared login (manager/client — role branched)
│   │   └── member-login.tsx    # Collab member login
│   ├── (visitor)/
│   │   ├── scan.tsx            # QR scanner
│   │   ├── selfie.tsx          # Front camera + face guide
│   │   ├── searching.tsx       # Animated processing screen
│   │   └── results.tsx         # My Photos / General / Highlights tabs
│   ├── (manager)/
│   │   ├── index.tsx           # Events dashboard
│   │   ├── create-event.tsx    # New event form
│   │   └── event/
│   │       ├── [id].tsx        # Event detail tab navigator
│   │       └── [id]/
│   │           ├── upload.tsx
│   │           ├── library.tsx
│   │           ├── album.tsx
│   │           ├── qr.tsx
│   │           └── clients.tsx
│   ├── (client)/
│   │   ├── index.tsx           # Client event view
│   │   └── event/[id].tsx      # Photos / Favourites / Share
│   └── (collab)/
│       └── [id].tsx            # Collab event portal (4 tabs)
│
├── components/
│   ├── PhotoGrid/
│   │   ├── PhotoGrid.tsx       # FlashList masonry grid
│   │   ├── PhotoCell.tsx       # Single photo tile with favourite overlay
│   │   └── PhotoSkeleton.tsx   # Shimmer loading state
│   ├── PhotoViewer/
│   │   ├── PhotoViewer.tsx     # Full-screen swipe gallery
│   │   └── PhotoActions.tsx    # Download/Share/Favourite bar
│   ├── Camera/
│   │   ├── SelfieCamera.tsx    # Front camera with oval guide
│   │   └── QRScanner.tsx       # Barcode scanner with guide box
│   ├── Upload/
│   │   ├── UploadQueue.tsx     # Queue list with per-file progress
│   │   └── UploadSummary.tsx   # Post-upload results card
│   ├── Notifications/
│   │   ├── NotificationBell.tsx # Header bell + badge
│   │   └── NotificationPanel.tsx # Slide-in panel
│   ├── ui/
│   │   ├── Button.tsx          # Primary / Secondary / Ghost
│   │   ├── Card.tsx            # Surface card component
│   │   ├── Badge.tsx           # Role/status badge
│   │   ├── Skeleton.tsx        # Shimmer loading
│   │   └── Toast.tsx           # In-app notification toast
│   └── SplashAnimation.tsx     # Lottie splash screen
│
├── services/
│   ├── api.ts                  # Axios instance + interceptors
│   ├── auth.ts                 # Login/logout/session restore
│   ├── photos.ts               # Gallery, search, download
│   ├── upload.ts               # Batch upload with compression
│   └── notifications.ts        # Push token + Expo notifications
│
├── hooks/
│   ├── useAuth.ts
│   ├── useEvents.ts
│   ├── usePhotoSearch.ts
│   ├── usePhotoGallery.ts
│   ├── useFavourites.ts
│   ├── useNotifications.ts
│   └── useAppState.ts          # Refresh on foreground
│
├── constants/
│   ├── colors.ts               # Design tokens (matches web)
│   ├── typography.ts           # Inter font scale
│   └── api.ts                  # BASE_URL, endpoints
│
├── utils/
│   ├── imageCompressor.ts      # Client-side pre-compression
│   ├── deepLink.ts             # Parse /e/:eventId from URLs
│   └── formatters.ts           # Date, file size, etc.
│
├── app.json                    # Expo config, Android App Links
├── eas.json                    # EAS Build profiles
└── package.json
```

---

## Colour System (Design Tokens — Matches Web)

```typescript
// constants/colors.ts
export const Colors = {
  // Backgrounds (from web CSS variables)
  bgPrimary:    '#0A0F1E',
  bgSurface:    '#141B2D',
  bgSurface2:   '#1E2A42',
  bgSurface3:   '#243050',

  // Brand
  accent:       '#4CAFE3',  // RaidCloud blue
  accentDim:    'rgba(76,175,227,0.15)',
  accentBorder: 'rgba(76,175,227,0.30)',

  // Text
  textPrimary:  '#FFFFFF',
  textSecondary:'#8FA3CC',
  textMuted:    '#4A5A7E',

  // Status
  success:      '#4CAF50',
  warning:      '#FF9800',
  error:        '#F44336',
  gold:         '#FFD700',  // Group favourites

  // Gradients
  gradientCard: ['#1E2A42', '#141B2D'],
  gradientAccent: ['#4CAFE3', '#2980B9'],
} as const;
```

---

## Android App Links — QR Compatibility Strategy

**Goal**: Single QR URL (`https://delivery.raidcloud.in/e/{eventId}`) that:
1. Opens in browser → existing web visitor portal ✅ (works today)
2. Opens native Android app if installed ✅ (via App Links)

**How Android App Links work:**
1. Server hosts `/.well-known/assetlinks.json` with app package + signing certificate SHA-256
2. App declares `android:autoVerify="true"` intent filter for `delivery.raidcloud.in/e/*`
3. Android OS verifies the link at install time → all links matching pattern open app directly
4. If verification fails or app not installed → falls back to browser ✅

**No QR code change needed** — same URL, browser and app both work.

**app.json relevant section:**
```json
{
  "android": {
    "package": "com.raidcloud.eventsnapai",
    "intentFilters": [
      {
        "action": "VIEW",
        "autoVerify": true,
        "data": [
          {
            "scheme": "https",
            "host": "delivery.raidcloud.in",
            "pathPrefix": "/e/"
          }
        ],
        "category": ["BROWSABLE", "DEFAULT"]
      }
    ]
  }
}
```

**SHA-256 fingerprint** (obtained AFTER first EAS build):
```bash
# From your release keystore:
eas credentials  # generates/shows keystore
# OR from AAB/APK:
keytool -printcert -jarfile app.apk
```

---

## Real-Time Sync Strategy (Web ↔ App)

| Event | Web behaviour | App behaviour |
|-------|--------------|---------------|
| Manager adds favourite | Updates DB; other web clients poll every 10s | App polls on tab focus + app foreground |
| Manager uploads photos | Available immediately in DB | App triggers refetch on pull-to-refresh |
| Admin sends notification | Web shows toast; DB insert | Server calls Expo Push API; app shows OS notification |
| Manager deletes photo | Removed from DB | App refetches on next gallery load |
| Maintenance mode toggled | Non-admin gets 503 overlay | App shows maintenance splash screen |

**No WebSocket server needed for v1** — polling on focus + AppState is sufficient and matches what the web already does.

---

## Performance — Photo Grid Architecture

Use **ShopifyFlashList** (not FlatList) for drastically better scroll performance on large galleries:

```
Photo loading pipeline:
1. FlashList renders PhotoCell with thumb URL
2. expo-image (or react-native-fast-image) loads thumbnail → 150×150
3. On tap → PhotoViewer opens with full-res URL lazy loaded
4. Presigned URLs cached in memory (Map by objectId) for session
5. On AppState 'active' → purge URL cache (may be expired) → refetch
6. Progressive loading: show blur hash / shimmer skeleton while thumb loads
```

Key libraries:
- `@shopify/flash-list` — virtual list, 10× better than FlatList for photos
- `expo-image` — progressive loading, blurhash support, disk+memory cache
- `react-native-reanimated` — 60fps animations (card presses, viewer transitions)
- `react-native-gesture-handler` — smooth swipe/pinch gestures

---

## Server Changes Summary Table

| # | File | Change | Priority | Effort |
|---|------|--------|----------|--------|
| 1 | `src/app.js` | CORS: allow null-origin (mobile) | 🔴 Critical | 1h |
| 2 | `src/app.js` | Rate limit: JWT-based key generator | 🔴 Critical | 1h |
| 3 | `src/app.js` | App Links: `/.well-known/assetlinks.json` | 🟡 Phase 1 | 30m |
| 4 | `src/routes/users.js` | `PATCH /users/me/push-token` | 🟡 Phase 5 | 1h |
| 5 | `src/routes/notifications.js` | Expo push sender | 🟡 Phase 5 | 2h |
| 6 | `package.json` (backend) | Add `expo-server-sdk` | 🟡 Phase 5 | 5m |
| 7 | Portainer env | `JWT_EXPIRES_IN=24h`, `PRESIGNED_URL_EXPIRY=86400` | 🔴 Critical | 5m |
| 8 | DB (live) | `ALTER TABLE users ADD COLUMN expo_push_token TEXT` | 🟡 Phase 5 | 5m |
| 9 | Portainer env | `ANDROID_CERT_FINGERPRINT=<sha256>` | 🟡 Phase 1 | 5m |

---

## Phased Delivery Checklist

### Phase 0 — Server Prep (Do First, ~1 day)
- [ ] CORS fix deployed to Portainer
- [ ] JWT-based rate limiter deployed
- [ ] JWT expiry changed to 24h in Portainer env
- [ ] Rebuild + redeploy Docker container

### Phase 1 — Visitor Flow (~2 weeks)
- [ ] `mobile/` folder created, Expo project bootstrapped
- [ ] Splash screen (Lottie animation, RaidCloud logo)
- [ ] Home screen (Scan QR / Client Login / Manager Login cards)
- [ ] QR Scanner screen (full-screen camera, auto-detect)
- [ ] `GET /events/:id/token` integration
- [ ] Selfie camera screen (oval face guide, front camera)
- [ ] `POST /search` integration
- [ ] Searching animation screen
- [ ] Results screen — My Photos / General / Highlights tabs
- [ ] FlashList photo grid with shimmer loading
- [ ] PhotoViewer — full-screen swipe, zoom, download, share
- [ ] Maintenance mode detection (503 → elegant splash)
- [ ] App Links intent filter in app.json
- [ ] ✅ `assetlinks.json` endpoint deployed to server
- [ ] EAS build → Android APK → install on physical device → end-to-end test

### Phase 2 — Manager Flow (~3 weeks)
- [ ] Login screen + JWT stored in SecureStore
- [ ] `/auth/me` → feature flags loaded
- [ ] Events dashboard (card grid, pull-to-refresh)
- [ ] Create event form (standard + collab toggle)
- [ ] Client-side image compression before upload
- [ ] Batch upload with per-file progress cards
- [ ] Event library (masonry grid, long-press delete)
- [ ] QR display tab + native share sheet
- [ ] Clients management tab
- [ ] JPEG quality slider (premium-gated)
- [ ] Manager event delete (password confirmation modal)
- [ ] Notification bell + in-app panel

### Phase 3 — Client Flow (~1 week)
- [ ] Login → role branch → client dashboard
- [ ] Assigned event view
- [ ] Favourites management (heart toggle, sync polling)
- [ ] QR share tab
- [ ] Notifications panel (same as manager)

### Phase 4 — Collaborative Events (~2 weeks)
- [ ] Collab member login (POST /auth/member-login)
- [ ] Collab event portal (4 tabs)
- [ ] Member upload (with can_upload permission check)
- [ ] All Photos tab with uploader filter chips
- [ ] My Photos tab
- [ ] Personal Favourites
- [ ] Group Favourites (manager only — gold star badge)
- [ ] Selfie search within collab event

### Phase 5 — Push Notifications (~1 week)
- [ ] DB migration: expo_push_token column
- [ ] Backend: push token endpoint + expo-server-sdk
- [ ] Mobile: registerForPushNotifications on login
- [ ] `PATCH /users/me/push-token` called after login
- [ ] Foreground notification handling (in-app toast)
- [ ] Background notification handling (OS push → deep link)
- [ ] Test: admin sends notification on web → appears on phone

### Phase 6 — Polish + App Store Prep (~1 week)
- [ ] App icon (1024×1024) + adaptive icon
- [ ] Splash screen finalized
- [ ] App name + store description
- [ ] Privacy policy URL
- [ ] EAS production build → signed AAB
- [ ] Google Play Console internal test track
- [ ] Promote to open testing after validation

---

## Open Item: SHA-256 Fingerprint for App Links

> [!WARNING]
> The `assetlinks.json` must contain the **exact** SHA-256 of your release signing keystore.
> This is only obtainable AFTER running `eas credentials` for the first time (EAS generates and manages the keystore).
> Steps:
> 1. Run Phase 0 and Phase 1 work
> 2. Run `eas build --platform android --profile preview` (first build generates keystore)
> 3. Run `eas credentials --platform android` → copy SHA-256 fingerprint
> 4. Set `ANDROID_CERT_FINGERPRINT` in Portainer
> 5. Rebuild + redeploy server → App Links verification completes

This means App Links will be fully active by end of Phase 1.
