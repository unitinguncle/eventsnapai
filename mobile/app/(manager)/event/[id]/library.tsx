import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { useEventData } from '../../../../hooks/useEventData';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

export default function LibraryTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { photos, loading, fetchEventData, deletePhoto } = useEventData(eventId as string);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchEventData();
    setRefreshing(false);
  };

  const handleLongPress = (photoId: string, rustfsObjectId: string) => {
    Alert.alert(
      'Delete Photo',
      `Delete photo ${rustfsObjectId.slice(0, 8)}? This removes it from storage and face recognition. Cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePhoto(photoId);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete photo');
            }
          }
        }
      ]
    );
  };

  if (loading && photos.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.statsRow}>
        <Text style={styles.statText}>Total: {photos.length}</Text>
        <Text style={styles.statText}>Indexed: {photos.filter(p => p.has_faces).length}</Text>
        <Text style={styles.statText}>Faceless: {photos.filter(p => !p.has_faces).length}</Text>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.md,
    backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    padding: 2,
  },
  image: {
    flex: 1,
    backgroundColor: Colors.bgSurface2,
    borderRadius: Radius.sm,
  },
});
