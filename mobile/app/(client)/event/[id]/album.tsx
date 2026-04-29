/**
 * Client Album Tab
 * Manager-curated photo album. Read-only view (clients can add/remove if featureAlbum).
 * Mirrors loadCliAlbum() from public/client/script.js
 */
import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, Dimensions, ActivityIndicator, Alert,
} from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { useClientEvent } from '../../../../hooks/useClientEvent';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

export default function AlbumTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id as string;
  const { albumPhotos, albumSet, featureAlbum, loading, loadAlbum, toggleAlbum } = useClientEvent(eventId);

  useEffect(() => {
    if (eventId) loadAlbum(eventId);
  }, [eventId]);

  const downloadAll = async () => {
    if (!albumPhotos.length) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need media library access to save photos.');
      return;
    }
    Alert.alert('Downloading', `Saving ${albumPhotos.length} album photos...`);
    for (const photo of albumPhotos) {
      try {
        const uri = `${FileSystem.cacheDirectory}${photo.id}.jpg`;
        await FileSystem.downloadAsync(photo.fullUrl, uri);
        await MediaLibrary.saveToLibraryAsync(uri);
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {}
    }
    Alert.alert('Done', 'Album saved to your gallery!');
  };

  if (!featureAlbum) {
    return (
      <View style={styles.gateContainer}>
        <View style={styles.gateLock}>
          <Text style={styles.gateIcon}>🔒</Text>
          <Text style={styles.gateTitle}>Album — Premium Feature</Text>
          <Text style={styles.gateSub}>
            The manager has the ability to create a curated album for you.
            Contact your event administrator to enable this feature.
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>;
  }

  if (!albumPhotos.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="albums-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.emptyTitle}>No photos in album yet</Text>
        <Text style={styles.emptySub}>The event manager adds photos to the album.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.countText}>
          {albumPhotos.length} photo{albumPhotos.length !== 1 ? 's' : ''} in album
        </Text>
        <TouchableOpacity style={styles.dlBtn} onPress={downloadAll}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.dlBtnText}>Download Album</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={albumPhotos}
        keyExtractor={item => item.id}
        numColumns={NUM_COLS}
        contentContainerStyle={{ gap: GAP, padding: GAP }}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <Image source={{ uri: item.thumbUrl }} style={styles.img} />
            <TouchableOpacity
              style={[styles.bookmarkBtn, albumSet.has(item.id) && styles.bookmarkBtnActive]}
              onPress={() => toggleAlbum(item.id)}
            >
              <Text style={{ fontSize: 12 }}>{albumSet.has(item.id) ? '📚' : '📖'}</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  gateContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.bgPrimary, padding: Spacing.xl,
  },
  gateLock: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg, padding: Spacing.xl,
    borderWidth: 1, borderColor: 'rgba(217,119,6,0.3)',
    alignItems: 'center',
  },
  gateIcon: { fontSize: 48, marginBottom: Spacing.md },
  gateTitle: { ...Typography.h3, color: Colors.textPrimary, marginBottom: Spacing.sm, textAlign: 'center' },
  gateSub: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  countText: { ...Typography.caption, color: Colors.textSecondary },
  dlBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.accent,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.sm,
  },
  dlBtnText: { ...Typography.caption, color: '#fff', fontWeight: 'bold' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: Colors.bgSurface2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  bookmarkBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 4,
  },
  bookmarkBtnActive: { backgroundColor: 'rgba(217,119,6,0.7)' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
});
