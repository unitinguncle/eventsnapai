/**
 * Client Share Tab — QR code + selfie face search within event
 * Mirrors loadClientQR() + searchFace() from public/client/script.js
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Alert, ActivityIndicator, FlatList, Dimensions,
} from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { useClientEvent } from '../../../../hooks/useClientEvent';
import { API_BASE_URL } from '../../../../services/api';
import * as SecureStore from 'expo-secure-store';

const CELL_SIZE = (Dimensions.get('window').width - 6) / 3;

export default function ClientShareTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id as string;
  const { event } = useClientEvent(eventId);

  const shareUrl = `https://delivery.raidcloud.in/e/${eventId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(shareUrl)}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`;

  // Face search state
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const copyLink = async () => {
    await Clipboard.setStringAsync(shareUrl);
    Alert.alert('Copied', 'Link copied to clipboard!');
  };

  const shareNative = async () => {
    try {
      await Share.share({
        title: `${event?.name || 'Event'} — EventSnapAI`,
        message: `🎉 Visit the album and find key photos and your own photos!\n${event?.name || 'Event'} — RaidCloud EventSnapAI\n\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (e: any) {
      if (e.name !== 'AbortError') copyLink();
    }
  };

  // ── Selfie face search (mirrors searchFace() in client/script.js) ──────────
  const startFaceSearch = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required for face search.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.9,
      allowsEditing: false,
    });
    if (result.canceled) return;

    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);

    try {
      // Step 1: Get visitor token for this event
      const tokenRes = await fetch(`${API_BASE_URL}/events/${eventId}/token`);
      if (!tokenRes.ok) throw new Error('Failed to get event token');
      const { token } = await tokenRes.json();

      // Step 2: POST selfie to /search
      const formData = new FormData();
      const uri = result.assets[0].uri;
      const filename = uri.split('/').pop() || 'selfie.jpg';
      formData.append('selfie', { uri, name: filename, type: 'image/jpeg' } as any);

      const searchRes = await fetch(`${API_BASE_URL}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!searchRes.ok) throw new Error('Search failed');
      const data = await searchRes.json();
      setSearchResults(data.myPhotos || []);
    } catch (e: any) {
      Alert.alert('Search Failed', e.message || 'Could not complete face search. Try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* QR Card */}
      <View style={styles.qrCard}>
        <Text style={styles.qrTitle}>{event?.name || 'Loading...'}</Text>
        <Text style={styles.qrSub}>Scan to join the event</Text>
        <View style={styles.qrBg}>
          <Image source={{ uri: qrUrl }} style={styles.qrImg} />
        </View>
        <Text style={styles.qrLink} numberOfLines={1}>{shareUrl}</Text>
        <View style={styles.qrActions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={copyLink}>
            <Ionicons name="copy-outline" size={18} color={Colors.textPrimary} />
            <Text style={styles.btnSecText}>Copy Link</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={shareNative}>
            <Ionicons name="share-social" size={18} color="#fff" />
            <Text style={styles.btnPriText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Selfie Face Search */}
      <View style={styles.searchCard}>
        <Text style={styles.searchTitle}>🔍 Find My Photos</Text>
        <Text style={styles.searchSub}>Take a selfie to find photos of yourself in this event</Text>
        <TouchableOpacity style={styles.selfieBtn} onPress={startFaceSearch} disabled={searching}>
          {searching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="camera" size={20} color="#fff" />
              <Text style={styles.selfieBtnText}>Take Selfie</Text>
            </>
          )}
        </TouchableOpacity>

        {hasSearched && !searching && (
          searchResults.length === 0 ? (
            <Text style={styles.noResults}>No photos found. Try again with better lighting.</Text>
          ) : (
            <>
              <Text style={styles.resultsCount}>
                Found {searchResults.length} photo{searchResults.length !== 1 ? 's' : ''} of you!
              </Text>
              <View style={styles.resultsGrid}>
                {searchResults.map((p, i) => (
                  <Image
                    key={i}
                    source={{ uri: p.thumbUrl || p.url }}
                    style={styles.resultCell}
                  />
                ))}
              </View>
            </>
          )
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  qrCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  qrTitle: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center', marginBottom: 4 },
  qrSub: { ...Typography.caption, color: Colors.textSecondary, marginBottom: Spacing.lg },
  qrBg: { backgroundColor: '#fff', padding: 10, borderRadius: Radius.md, marginBottom: Spacing.lg },
  qrImg: { width: 200, height: 200 },
  qrLink: {
    ...Typography.caption, color: Colors.textSecondary,
    backgroundColor: Colors.bgSurface2, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.sm,
    marginBottom: Spacing.lg, width: '100%', textAlign: 'center',
  },
  qrActions: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  btnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bgSurface2, padding: Spacing.md,
    borderRadius: Radius.md, gap: Spacing.xs,
  },
  btnSecText: { ...Typography.button, color: Colors.textPrimary },
  btnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, padding: Spacing.md,
    borderRadius: Radius.md, gap: Spacing.xs,
  },
  btnPriText: { ...Typography.button, color: '#fff' },
  searchCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchTitle: { ...Typography.h3, color: Colors.textPrimary, marginBottom: 4 },
  searchSub: { ...Typography.caption, color: Colors.textSecondary, marginBottom: Spacing.lg },
  selfieBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, padding: Spacing.md,
    borderRadius: Radius.md, gap: Spacing.sm,
  },
  selfieBtnText: { ...Typography.button, color: '#fff' },
  noResults: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.lg },
  resultsCount: { ...Typography.bodyMedium, color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: Spacing.md },
  resultsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  resultCell: { width: CELL_SIZE, height: CELL_SIZE },
});
