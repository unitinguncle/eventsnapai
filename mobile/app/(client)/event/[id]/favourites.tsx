/**
 * Client Favourites Tab
 * - Tap heart: heart turns EMPTY instantly (via pendingRemoval set)
 * - Photo stays visible for 4 seconds then disappears (mirrors web setTimeout logic)
 * - Download All saves to device gallery
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
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

export default function FavouritesTab() {
  const { photos, favSet, loading, toggleFav } = useClientEventContext();
  // pendingRemoval: photoIds the user clicked to remove — still shown for 4s
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  const timerMap = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Photos visible = actually fav OR pending removal (kept for 4s)
  const visiblePhotos = useMemo(() =>
    photos.filter(p => favSet.has(p.id) || pendingRemoval.has(p.id)),
    [photos, favSet, pendingRemoval]
  );

  const handleToggle = async (photoId: string) => {
    const isCurrentlyFav = favSet.has(photoId) && !pendingRemoval.has(photoId);
    if (isCurrentlyFav) {
      // Add to pendingRemoval immediately (photo stays, heart empties)
      setPendingRemoval(prev => { const n = new Set(prev); n.add(photoId); return n; });
      // Clear any existing timer
      if (timerMap.current[photoId]) clearTimeout(timerMap.current[photoId]);
      // After 4s — remove from pendingRemoval (photo disappears)
      timerMap.current[photoId] = setTimeout(() => {
        setPendingRemoval(prev => { const n = new Set(prev); n.delete(photoId); return n; });
        delete timerMap.current[photoId];
      }, 4000);
    }
    await toggleFav(photoId);
  };

  useEffect(() => {
    return () => { Object.values(timerMap.current).forEach(clearTimeout); };
  }, []);

  const downloadAll = async () => {
    const favPhotos = photos.filter(p => favSet.has(p.id));
    if (!favPhotos.length) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Media library access required.');
      return;
    }
    Alert.alert('Downloading', `Saving ${favPhotos.length} photos...`);
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
        <Text style={styles.emptySub}>Tap the ♡ on any photo in Library.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.countText}>
          {favSet.size} favourite{favSet.size !== 1 ? 's' : ''}
        </Text>
        {favSet.size > 0 && (
          <TouchableOpacity style={styles.dlBtn} onPress={downloadAll}>
            <Ionicons name="download-outline" size={18} color="#fff" />
            <Text style={styles.dlBtnText}>Download All</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={visiblePhotos}
        keyExtractor={item => item.id}
        numColumns={NUM_COLS}
        contentContainerStyle={{ gap: GAP, padding: GAP }}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item }) => {
          // If in pendingRemoval: show empty heart immediately + dimmed cell
          const isPending = pendingRemoval.has(item.id);
          const showFilledHeart = favSet.has(item.id) && !isPending;
          return (
            <TouchableOpacity
              style={[styles.cell, isPending && styles.cellFading]}
              activeOpacity={0.85}
              onPress={() => handleToggle(item.id)}
            >
              <Image source={{ uri: item.thumbUrl }} style={styles.img} />
              <View style={[styles.heartBtn, showFilledHeart ? styles.heartFilled : styles.heartEmpty]}>
                <Ionicons
                  name={showFilledHeart ? 'heart' : 'heart-outline'}
                  size={16}
                  color={showFilledHeart ? Colors.error : 'rgba(255,255,255,0.9)'}
                />
              </View>
              {isPending && (
                <View style={styles.removingOverlay}>
                  <Text style={styles.removingText}>Removing...</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.md, backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  countText: { ...Typography.caption, color: Colors.textSecondary },
  dlBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.accent, paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.sm,
  },
  dlBtnText: { ...Typography.caption, color: '#fff', fontWeight: 'bold' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: Colors.bgSurface2, position: 'relative' },
  cellFading: { opacity: 0.45 },
  img: { width: '100%', height: '100%' },
  heartBtn: { position: 'absolute', bottom: 4, right: 4, borderRadius: 12, padding: 4 },
  heartFilled: { backgroundColor: 'rgba(220,38,38,0.75)' },
  heartEmpty: { backgroundColor: 'rgba(0,0,0,0.55)' },
  removingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  removingText: { ...Typography.caption, color: '#fff', fontWeight: 'bold' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
});
