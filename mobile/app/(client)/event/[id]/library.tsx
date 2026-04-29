/**
 * Client Library Tab
 * Uses shared ClientEventContext (no white flash, hearts work across tabs).
 * Tapping a photo opens the full-screen PhotoViewer with swipe/zoom/download.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, FlatList, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useClientEventContext, ClientPhoto } from '../../../../contexts/ClientEventContext';
import { PhotoViewer } from '../../../../components/PhotoViewer/PhotoViewer';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing } from '../../../../constants/typography';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

// Map ClientPhoto → shape expected by PhotoViewer
function toViewerPhoto(p: ClientPhoto) {
  return {
    id: p.id,
    filename: p.rustfs_object_id || p.id,
    originalUrl: p.fullUrl,
    compressedUrl: p.thumbUrl,
  };
}

export default function ClientLibraryTab() {
  const { photos, favSet, featureAlbum, albumSet, loading, toggleFav, toggleAlbum } = useClientEventContext();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (loading && photos.length === 0) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>;
  }

  const viewerPhotos = photos.map(toViewerPhoto);

  return (
    <View style={styles.container}>
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.stat}>📷 {photos.length} photos</Text>
        <Text style={styles.stat}>❤️ {favSet.size} favourites</Text>
      </View>

      {photos.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="images-outline" size={64} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No photos yet</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={item => item.id}
          numColumns={NUM_COLS}
          contentContainerStyle={{ gap: GAP, padding: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={styles.cell}
              activeOpacity={0.9}
              onPress={() => setViewerIndex(index)}
            >
              <Image source={{ uri: item.thumbUrl }} style={styles.img} />
              {/* Favourite heart */}
              <TouchableOpacity
                style={[styles.heartBtn, favSet.has(item.id) && styles.heartBtnActive]}
                onPress={() => toggleFav(item.id)}
              >
                <Ionicons
                  name={favSet.has(item.id) ? 'heart' : 'heart-outline'}
                  size={16}
                  color={favSet.has(item.id) ? Colors.error : '#fff'}
                />
              </TouchableOpacity>
              {/* Album bookmark (premium) */}
              {featureAlbum && (
                <TouchableOpacity
                  style={[styles.albumBtn, albumSet.has(item.id) && styles.albumBtnActive]}
                  onPress={() => toggleAlbum(item.id)}
                >
                  <Text style={{ fontSize: 11 }}>{albumSet.has(item.id) ? '📚' : '📖'}</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Full-screen photo viewer */}
      {viewerIndex !== null && (
        <PhotoViewer
          photos={viewerPhotos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onToggleFavourite={async (photoId) => { await toggleFav(photoId); }}
          favouriteIds={favSet}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statsBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    padding: Spacing.md,
    backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  stat: { ...Typography.caption, color: Colors.textSecondary },
  cell: {
    width: CELL_SIZE, height: CELL_SIZE,
    backgroundColor: Colors.bgSurface2,
    position: 'relative',
  },
  img: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(220,38,38,0.75)' },
  albumBtn: {
    position: 'absolute', bottom: 4, right: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12, padding: 3,
  },
  albumBtnActive: { backgroundColor: 'rgba(217,119,6,0.7)' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
});
