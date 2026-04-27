// Design tokens — must match delivery.raidcloud.in CSS variables exactly
// Update here = update everywhere in the app

export const Colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  bgPrimary:     '#0A0F1E',   // Main app background (matches web --bg)
  bgSurface:     '#141B2D',   // Card/sheet background (matches web --surface)
  bgSurface2:    '#1E2A42',   // Elevated cards, modals (matches web --surface2)
  bgSurface3:    '#243050',   // Hover state, selected

  // ── Brand ─────────────────────────────────────────────────────────────────
  accent:        '#4CAFE3',   // RaidCloud blue — primary CTA
  accentDim:     'rgba(76, 175, 227, 0.15)',  // Accent glow backgrounds
  accentBorder:  'rgba(76, 175, 227, 0.30)',  // Subtle accent borders
  accentPress:   '#3B9FD4',   // Pressed/darker accent

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary:   '#FFFFFF',
  textSecondary: '#8FA3CC',
  textMuted:     '#4A5A7E',
  textInverse:   '#0A0F1E',   // On accent buttons

  // ── Borders ───────────────────────────────────────────────────────────────
  border:        'rgba(255, 255, 255, 0.08)',
  borderAccent:  'rgba(76, 175, 227, 0.30)',

  // ── Status ────────────────────────────────────────────────────────────────
  success:       '#4CAF50',
  successDim:    'rgba(76, 175, 80, 0.15)',
  warning:       '#FF9800',
  warningDim:    'rgba(255, 152, 0, 0.15)',
  error:         '#F44336',
  errorDim:      'rgba(244, 67, 54, 0.15)',

  // ── Special ───────────────────────────────────────────────────────────────
  gold:          '#FFD700',   // Group favourites / premium badge
  goldDim:       'rgba(255, 215, 0, 0.15)',
  heart:         '#E91E63',   // Favourite heart

  // ── Overlays ──────────────────────────────────────────────────────────────
  overlay:       'rgba(0, 0, 0, 0.6)',
  overlayLight:  'rgba(0, 0, 0, 0.3)',

  // ── Skeleton ──────────────────────────────────────────────────────────────
  skeletonBase:  '#1E2A42',
  skeletonShine: '#243050',
} as const;

export const Gradients = {
  // Card gradient (bottom-to-top, surface to slightly lighter)
  card:     [Colors.bgSurface, Colors.bgSurface2] as [string, string],
  // Accent button gradient
  accent:   ['#4CAFE3', '#2980B9'] as [string, string],
  // Photo overlay gradient (bottom of photo in viewer)
  photo:    ['transparent', 'rgba(0,0,0,0.8)'] as [string, string],
  // Splash/hero gradient
  hero:     ['#0A0F1E', '#0D1525', '#0A0F1E'] as [string, string, string],
} as const;
