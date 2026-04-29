/**
 * Client Favourites Tab
 * Shows only favourited photos. Download All button.
 * Mirrors renderFavorites() + downloadAllFavs() from public/client/script.js
 */
import React, { useMemo } from 'react';
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

export default function FavouritesTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id as string;
  const { photos, favSet, loading, toggleFav } = useClientEvent(eventId);

  const favPhotos = useMemo(() =>
    photos.filter(p => favSet.has(p.id)),
    [photos, favSet]
  );

  const downloadAll = async () => {
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

  if (favPhotos.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="heart-outline" size={64} color={Colors.textSecondary} />
        <Text style={styles.emptyTitle}>No favourites yet</Text>
        <Text style={styles.emptySub}>Tap the heart on any photo to add it to your favourites.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.countText}>
          {favPhotos.length} favourite{favPhotos.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity style={styles.dlBtn} onPress={downloadAll}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.dlBtnText}>Download All</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={favPhotos}
        keyExtractor={item => item.id}
        numColumns={NUM_COLS}
        contentContainerStyle={{ gap: GAP, padding: GAP }}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <Image source={{ uri: item.thumbUrl }} style={styles.img} />
            <TouchableOpacity
              style={[styles.heartBtn, styles.heartBtnActive]}
              onPress={() => toggleFav(item.id)}
            >
              <Ionicons name="heart" size={16} color={Colors.error} />
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
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: Radius.sm,
  },
  dlBtnText: { ...Typography.caption, color: '#fff', fontWeight: 'bold' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: Colors.bgSurface2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(244,67,54,0.7)' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
});
