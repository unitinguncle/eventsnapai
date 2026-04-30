import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { useEventData } from '../../../../hooks/useEventData';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { PhotoGridSkeleton } from '../../../../components/ui/PhotoGridSkeleton';

export default function LibraryTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id as string;
  const { photos, loading, fetchEventData, deletePhoto } = useEventData(eventId);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchEventData();
    setRefreshing(false);
  };

  const handleLongPress = (photoId: string, rustfsObjectId: string) => {
    Alert.alert(
      'Delete Photo',
      `Delete ${rustfsObjectId.slice(0, 8)}…? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try { await deletePhoto(photoId); }
            catch (err: any) { Alert.alert('Error', err.message || 'Failed to delete photo'); }
          },
        },
      ]
    );
  };

  // Show skeleton while loading (replaces the ActivityIndicator + avoids "0 photos" flash)
  if (loading && photos.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.statsRow}>
          {[' ', ' ', ' '].map((_, i) => (
            <View key={i} style={styles.statSkeleton} />
          ))}
        </View>
        <PhotoGridSkeleton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.statsRow}>
        <Text style={styles.statText}>📷 {photos.length} total</Text>
        <Text style={styles.statText}>🤖 {photos.filter(p => p.has_faces).length} indexed</Text>
        <Text style={styles.statText}>◻ {photos.filter(p => !p.has_faces).length} faceless</Text>
      </View>

      {photos.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="images-outline" size={64} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>No photos uploaded yet</Text>
        </View>
      ) : (
        <FlashList
          data={photos}
          numColumns={3}
          estimatedItemSize={120}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          contentContainerStyle={{ padding: 2 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.cell}
              onLongPress={() => handleLongPress(item.id, item.rustfs_object_id)}
              delayLongPress={500}
            >
              <Image source={{ uri: item.thumbUrl }} style={styles.image} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    padding: Spacing.md, backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statText: { ...Typography.caption, color: Colors.textSecondary },
  statSkeleton: {
    width: 70, height: 14, borderRadius: 4,
    backgroundColor: Colors.bgSurface2,
  },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  cell: { flex: 1, aspectRatio: 1, padding: 2 },
  image: { flex: 1, backgroundColor: Colors.bgSurface2, borderRadius: Radius.sm },
});
