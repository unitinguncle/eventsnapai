/**
 * QR Scanner Screen
 *
 * Visitor entry: scans the event QR code, extracts eventId,
 * hits GET /events/:id/token, then routes to either:
 *   - selfie screen (standard event)
 *   - member-login screen (collaborative event)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Dimensions, ActivityIndicator, TextInput
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import api from '../../services/api';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

const { width: SCREEN_W } = Dimensions.get('window');
const SCAN_SIZE = SCREEN_W * 0.7;

export default function QRScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');

  // Animated scan line
  const scanLineY = useRef(new Animated.Value(0)).current;
  const cornerOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Animated scan line sweep
    const sweep = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: SCAN_SIZE - 2,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineY, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    // Corner pulse
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(cornerOpacity, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ])
    );
    sweep.start();
    pulse.start();
    return () => { sweep.stop(); pulse.stop(); };
  }, []);

  const handleBarCode = async ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    setError('');

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Extract eventId from URL: https://delivery.raidcloud.in/e/{uuid}
    // Also handle deep link format: eventsnapai://event/{uuid}
    const match =
      data.match(/\/e\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ||
      data.match(/event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);

    if (!match) {
      setError('This QR code is not an EventSnapAI event link.\nPlease scan a valid event QR code.');
      setLoading(false);
      setScanned(false);
      return;
    }

    const eventId = match[1];

    try {
      const { data: tokenData } = await api.get(`/events/${eventId}/token`);

      if (tokenData.isCollaborative) {
        // Collaborative event — show member login gate
        router.push({
          pathname: '/(auth)/member-login',
          params: {
            eventId,
            eventName: tokenData.event?.name || 'Event',
          },
        });
      } else {
        // Standard event — go to selfie screen with visitor token
        router.push({
          pathname: '/(visitor)/selfie',
          params: {
            eventId,
            visitorToken: tokenData.token,
            eventName: tokenData.event?.name || 'Event',
          },
        });
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Could not load event. Please try again.';
      if (err?.isMaintenanceMode) {
        setError('EventSnapAI is currently in maintenance mode.\nPlease try again later.');
      } else {
        setError(msg);
      }
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = () => {
    if (manualUrl.trim()) {
      handleBarCode({ data: manualUrl.trim() });
    }
  };

  // ── Permission screen ──────────────────────────────────────────────────────
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.permissionContainer]}>
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Access Needed</Text>
        <Text style={styles.permissionText}>
          EventSnapAI needs your camera to scan QR codes and take selfies for photo search.
        </Text>
        <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
          <Text style={styles.grantBtnText}>Allow Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full-screen camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned || loading ? undefined : handleBarCode}
      />

      {/* Dark overlay with cut-out */}
      <View style={StyleSheet.absoluteFill}>
        {/* Top dark area */}
        <View style={[styles.overlay, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Scan QR Code</Text>
            <View style={{ width: 36 }} />
          </View>
        </View>

        {/* Center row with darkening left/right and transparent center */}
        <View style={styles.middleRow}>
          <View style={styles.overlayBlock} />

          {/* Scan window */}
          <View style={styles.scanWindow}>
            {/* Animated corners */}
            <Animated.View style={[styles.corner, styles.cornerTL, { opacity: cornerOpacity }]} />
            <Animated.View style={[styles.corner, styles.cornerTR, { opacity: cornerOpacity }]} />
            <Animated.View style={[styles.corner, styles.cornerBL, { opacity: cornerOpacity }]} />
            <Animated.View style={[styles.corner, styles.cornerBR, { opacity: cornerOpacity }]} />

            {/* Scan line */}
            {!scanned && !loading && (
              <Animated.View
                style={[
                  styles.scanLine,
                  { transform: [{ translateY: scanLineY }] },
                ]}
              />
            )}

            {/* Loading overlay */}
            {loading && (
              <View style={styles.scanLoading}>
                <ActivityIndicator size="large" color={Colors.accent} />
              </View>
            )}
          </View>

          <View style={styles.overlayBlock} />
        </View>

        {/* Bottom area */}
        <View style={[styles.overlay, styles.overlayBottom, { paddingBottom: insets.bottom + 24 }]}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                onPress={() => { setError(''); setScanned(false); }}
                style={styles.retryBtn}
              >
                <Text style={styles.retryText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>
                Point your camera at the event QR code
              </Text>
              <Text style={styles.hintSub}>
                The code will be detected automatically
              </Text>

              <View style={styles.manualInputRow}>
                <TextInput
                  style={styles.manualInput}
                  placeholder="Or paste event link here..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={manualUrl}
                  onChangeText={setManualUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.manualBtn} onPress={handleManualSubmit}>
                  <Text style={styles.manualBtnText}>Go</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_W = 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Permission
  permissionContainer: {
    backgroundColor: Colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxxl,
    gap: Spacing.lg,
  },
  permissionIcon: { fontSize: 64 },
  permissionTitle: { ...Typography.h2, color: Colors.textPrimary, textAlign: 'center' },
  permissionText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  grantBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.full,
    marginTop: Spacing.md,
  },
  grantBtnText: { ...Typography.button, color: '#fff' },
  backBtn: { paddingVertical: Spacing.md },
  backBtnText: { ...Typography.body, color: Colors.textSecondary },

  // Overlay structure
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: '100%',
  },
  overlayBottom: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  middleRow: {
    flexDirection: 'row',
    height: SCAN_SIZE,
  },
  overlayBlock: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  scanWindow: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    overflow: 'hidden',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  headerTitle: { ...Typography.h3, color: '#fff' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: { color: '#fff', fontSize: 14 },

  // Corners
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: Colors.accent,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_W, borderLeftWidth: CORNER_W, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_W, borderRightWidth: CORNER_W, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_W, borderLeftWidth: CORNER_W, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_W, borderRightWidth: CORNER_W, borderBottomRightRadius: 4 },

  // Scan line
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.accent,
    opacity: 0.7,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  scanLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hint & error
  hintBox: { alignItems: 'center', gap: Spacing.xs, width: '100%' },
  hintText: { ...Typography.bodyMedium, color: '#fff', textAlign: 'center' },
  hintSub: { ...Typography.caption, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },

  manualInputRow: {
    flexDirection: 'row',
    marginTop: Spacing.xl,
    gap: Spacing.sm,
    width: '100%',
    maxWidth: 340,
  },
  manualInput: {
    flex: 1,
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    color: '#fff',
    ...Typography.body,
  },
  manualBtn: {
    height: 48,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    justifyContent: 'center',
  },
  manualBtnText: {
    ...Typography.buttonSmall,
    color: '#fff',
  },

  errorBox: {
    backgroundColor: Colors.errorDim,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.error + '50',
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
    width: '100%',
  },
  errorText: { ...Typography.body, color: Colors.error, textAlign: 'center' },
  retryBtn: {
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  retryText: { ...Typography.buttonSmall, color: '#fff' },
});
