/**
 * Client Share Tab — QR code + selfie face search (uses shared context)
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ScrollView, Alert, ActivityIndicator, Dimensions,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useClientEventContext } from '../../../../contexts/ClientEventContext';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { API_BASE_URL } from '../../../../services/api';

const CELL = (Dimensions.get('window').width - 6) / 3;

export default function ClientShareTab() {
  const { event } = useClientEventContext();
  const eventId = event?.id;
  const shareUrl = eventId ? `https://delivery.raidcloud.in/e/${eventId}` : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(shareUrl)}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`
    : null;

  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const copyLink = async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    Alert.alert('Copied!', 'Event link copied to clipboard.');
  };

  const shareNative = async () => {
    try {
      await Share.share({
        title: `${event?.name || 'Event'} — EventSnapAI`,
        message: `🎉 Find your photos at this event!\n${event?.name || 'Event'} — RaidCloud EventSnapAI\n\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (e: any) {
      if (e.name !== 'AbortError') copyLink();
    }
  };

  const startFaceSearch = async () => {
    if (!eventId) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access required for face search.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.9,
    });
    if (result.canceled) return;

    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    try {
      const tokenRes = await fetch(`${API_BASE_URL}/events/${eventId}/token`);
      if (!tokenRes.ok) throw new Error('Could not get event token');
      const { token } = await tokenRes.json();

      const formData = new FormData();
      const uri = result.assets[0].uri;
      formData.append('selfie', { uri, name: 'selfie.jpg', type: 'image/jpeg' } as any);

      const res = await fetch(`${API_BASE_URL}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      setSearchResults(data.myPhotos || []);
    } catch (e: any) {
      Alert.alert('Search Failed', e.message || 'Try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* QR Card */}
      <View style={styles.card}>
        <Text style={styles.eventName}>{event?.name || 'Loading...'}</Text>
        <Text style={styles.cardSub}>Share this event with others</Text>
        {qrUrl ? (
          <View style={styles.qrWrap}>
            <Image source={{ uri: qrUrl }} style={styles.qrImg} />
          </View>
        ) : (
          <ActivityIndicator color={Colors.accent} style={{ margin: Spacing.xl }} />
        )}
        <Text style={styles.linkText} numberOfLines={1}>{shareUrl}</Text>
        <View style={styles.actionRow}>
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

      {/* Selfie face search */}
      <View style={styles.card}>
        <Text style={styles.searchTitle}>🔍 Find My Photos</Text>
        <Text style={styles.cardSub}>Take a selfie to find photos of yourself in this event</Text>
        <TouchableOpacity style={styles.selfieBtn} onPress={startFaceSearch} disabled={searching}>
          {searching
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="camera" size={20} color="#fff" /><Text style={styles.selfieBtnText}>Take Selfie</Text></>
          }
        </TouchableOpacity>
        {hasSearched && !searching && (
          searchResults.length === 0
            ? <Text style={styles.noResults}>No matches found. Try better lighting.</Text>
            : <>
                <Text style={styles.resultsCount}>
                  Found {searchResults.length} photo{searchResults.length !== 1 ? 's' : ''} of you! 🎉
                </Text>
                <View style={styles.resultsGrid}>
                  {searchResults.map((p, i) => (
                    <Image key={i} source={{ uri: p.thumbUrl || p.url }} style={styles.resultCell} />
                  ))}
                </View>
              </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: Spacing.xl, gap: Spacing.xl },
  card: {
    backgroundColor: Colors.bgSurface, borderRadius: Radius.lg, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  eventName: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center', marginBottom: 4 },
  cardSub: { ...Typography.caption, color: Colors.textSecondary, marginBottom: Spacing.lg },
  qrWrap: { backgroundColor: '#fff', padding: 10, borderRadius: Radius.md, marginBottom: Spacing.lg },
  qrImg: { width: 200, height: 200 },
  linkText: {
    ...Typography.caption, color: Colors.textSecondary,
    backgroundColor: Colors.bgSurface2, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.sm,
    marginBottom: Spacing.lg, width: '100%', textAlign: 'center',
  },
  actionRow: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  btnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bgSurface2, padding: Spacing.md, borderRadius: Radius.md, gap: Spacing.xs,
  },
  btnSecText: { ...Typography.button, color: Colors.textPrimary },
  btnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, padding: Spacing.md, borderRadius: Radius.md, gap: Spacing.xs,
  },
  btnPriText: { ...Typography.button, color: '#fff' },
  searchTitle: { ...Typography.h3, color: Colors.textPrimary, marginBottom: 4 },
  selfieBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, padding: Spacing.md,
    borderRadius: Radius.md, gap: Spacing.sm, width: '100%',
  },
  selfieBtnText: { ...Typography.button, color: '#fff' },
  noResults: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.lg },
  resultsCount: { ...Typography.bodyMedium, color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: Spacing.md },
  resultsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, width: '100%' },
  resultCell: { width: CELL, height: CELL },
});
