/**
 * Client Library Tab
 * Shows all event photos in a grid with heart/favourite toggle on each.
 * Mirrors renderLibrary() + toggleFav() from public/client/script.js
 */
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, FlatList, Dimensions,
} from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { useClientEvent } from '../../../../hooks/useClientEvent';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

export default function ClientLibraryTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id as string;
  const { event, photos, favSet, featureAlbum, albumSet, loading, toggleFav, toggleAlbum } = useClientEvent(eventId);

  const stats = useMemo(() => ({
    total: photos.length,
    faces: photos.filter(p => p.has_faces).length,
    favs: favSet.size,
  }), [photos, favSet]);

  if (loading && photos.length === 0) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.stat}>📷 {stats.total}</Text>
        <Text style={styles.stat}>🤖 {stats.faces} indexed</Text>
        <Text style={styles.stat}>❤️ {stats.favs} favs</Text>
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
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <Image source={{ uri: item.thumbUrl }} style={styles.img} />
              {/* Favourite button */}
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
              {/* Album bookmark (if premium) */}
              {featureAlbum && (
                <TouchableOpacity
                  style={[styles.albumBtn, albumSet.has(item.id) && styles.albumBtnActive]}
                  onPress={() => toggleAlbum(item.id)}
                >
                  <Text style={{ fontSize: 12 }}>{albumSet.has(item.id) ? '📚' : '📖'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(244,67,54,0.7)' },
  albumBtn: {
    position: 'absolute', bottom: 4, right: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, padding: 4,
  },
  albumBtnActive: { backgroundColor: 'rgba(217,119,6,0.7)' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
});
