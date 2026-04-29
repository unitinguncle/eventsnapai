/**
 * Client Favourites Tab — uses shared ClientEventContext
 * Removing a favourite shows the photo for 4 seconds before it disappears from grid
 * (mirrors the setTimeout logic from public/client/script.js toggleFav)
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, Dimensions, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useClientEventContext, ClientPhoto } from '../../../../contexts/ClientEventContext';
import { PhotoViewer } from '../../../../components/PhotoViewer/PhotoViewer';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

function toViewerPhoto(p: ClientPhoto) {
  return {
    id: p.id,
    filename: p.rustfs_object_id || p.id,
    originalUrl: p.fullUrl,
    compressedUrl: p.thumbUrl,
  };
}

export default function FavouritesTab() {
  const { photos, favSet, loading, toggleFav } = useClientEventContext();
  // Pending-removal set: photos unfaved but kept on screen for 4s
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  const timerMap = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Photos that are currently in favSet OR pending removal (still visible)
  const visiblePhotos = useMemo(() =>
    photos.filter(p => favSet.has(p.id) || pendingRemoval.has(p.id)),
    [photos, favSet, pendingRemoval]
  );

  const handleToggle = (photoId: string) => {
    const isFav = favSet.has(photoId);
    if (isFav) {
      // Add to pending removal so it stays visible for 4s (mirrors web logic)
      setPendingRemoval(prev => new Set(prev).add(photoId));
      if (timerMap.current[photoId]) clearTimeout(timerMap.current[photoId]);
      timerMap.current[photoId] = setTimeout(() => {
        setPendingRemoval(prev => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
      }, 4000);
    }
    toggleFav(photoId);
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timerMap.current).forEach(clearTimeout);
    };
  }, []);

  const downloadAll = async () => {
    const favPhotos = photos.filter(p => favSet.has(p.id));
    if (!favPhotos.length) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need media library access to save photos.');
      return;
    }
    Alert.alert('Downloading', `Saving ${favPhotos.length} photos to your gallery...`);
    for (const photo of favPhotos) {
      try {
        const uri = `${FileSystem.cacheDirectory}${photo.id}.jpg`;
        await FileSystem.downloadAsync(photo.fullUrl, uri);
        await MediaLibrary.saveToLibraryAsync(uri);
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {}
    }
    Alert.alert('Done', 'All favourites saved to your gallery!');
  };

  if (loading && photos.length === 0) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>;
  }

  if (visiblePhotos.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="heart-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.emptyTitle}>No favourites yet</Text>
        <Text style={styles.emptySub}>Tap the heart on any photo in the Library tab.</Text>
      </View>
    );
  }

  const viewerPhotos = visiblePhotos.map(toViewerPhoto);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.countText}>
          {favSet.size} favourite{favSet.size !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity style={styles.dlBtn} onPress={downloadAll}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.dlBtnText}>Download All</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={visiblePhotos}
        keyExtractor={item => item.id}
        numColumns={NUM_COLS}
        contentContainerStyle={{ gap: GAP, padding: GAP }}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item, index }) => {
          const isFav = favSet.has(item.id);
          const isPendingRemoval = pendingRemoval.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.cell, isPendingRemoval && styles.cellFading]}
              activeOpacity={0.9}
              onPress={() => setViewerIndex(index)}
            >
              <Image source={{ uri: item.thumbUrl }} style={styles.img} />
              <TouchableOpacity
                style={[styles.heartBtn, isFav ? styles.heartBtnActive : styles.heartBtnInactive]}
                onPress={() => handleToggle(item.id)}
              >
                <Ionicons
                  name={isFav ? 'heart' : 'heart-outline'}
                  size={16}
                  color={isFav ? Colors.error : '#fff'}
                />
              </TouchableOpacity>
              {isPendingRemoval && (
                <View style={styles.fadingOverlay}>
                  <Text style={styles.fadingText}>Removing...</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      {viewerIndex !== null && (
        <PhotoViewer
          photos={viewerPhotos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onToggleFavourite={async (photoId) => handleToggle(photoId)}
          favouriteIds={favSet}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
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
  cell: {
    width: CELL_SIZE, height: CELL_SIZE,
    backgroundColor: Colors.bgSurface2, position: 'relative',
  },
  cellFading: { opacity: 0.5 },
  img: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute', bottom: 4, right: 4,
    borderRadius: 12, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(220,38,38,0.75)' },
  heartBtnInactive: { backgroundColor: 'rgba(0,0,0,0.55)' },
  fadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  fadingText: { ...Typography.caption, color: '#fff' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
});
