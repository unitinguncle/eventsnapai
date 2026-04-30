/**
 * PhotoGrid — 3-column uniform grid (same as manager/client library)
 * Replaces the old 2-column MasonryFlashList for consistency across all user types.
 * Supports: skeleton loading, empty state, refresh, heart toggle, photo viewer.
 */
import React from 'react';
import {
  View, StyleSheet, Text, Image, TouchableOpacity,
  FlatList, Dimensions, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Photo } from './PhotoCell';
import { PhotoGridSkeleton } from '../ui/PhotoGridSkeleton';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

interface PhotoGridProps {
  photos: Photo[];
  onPhotoPress: (photo: Photo, index: number) => void;
  isLoading?: boolean;
  onEndReached?: () => void;
  emptyMessage?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  favouriteIds?: Set<string>;
  onToggleFavourite?: (photoId: string) => void;
  showFavouriteBtn?: boolean;
}

export function PhotoGrid({
  photos,
  onPhotoPress,
  isLoading,
  onEndReached,
  emptyMessage = 'No photos found.',
  refreshing,
  onRefresh,
  favouriteIds,
  onToggleFavourite,
  showFavouriteBtn = false,
}: PhotoGridProps) {
  if (isLoading && photos.length === 0) {
    return <PhotoGridSkeleton />;
  }

  if (!isLoading && photos.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="images-outline" size={56} color={Colors.textSecondary} />
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={photos}
      keyExtractor={item => item.id}
      numColumns={NUM_COLS}
      contentContainerStyle={{ gap: GAP, padding: GAP }}
      columnWrapperStyle={{ gap: GAP }}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        ) : undefined
      }
      renderItem={({ item, index }) => {
        const isFav = favouriteIds?.has(item.id) ?? item.isFavourite ?? false;
        return (
          <TouchableOpacity
            style={styles.cell}
            onPress={() => onPhotoPress(item, index)}
            activeOpacity={0.88}
          >
            <Image
              source={{ uri: item.compressedUrl || item.originalUrl }}
              style={styles.img}
            />
            {showFavouriteBtn && onToggleFavourite && (
              <TouchableOpacity
                style={[styles.heartBtn, isFav && styles.heartBtnActive]}
                onPress={() => onToggleFavourite(item.id)}
              >
                <Ionicons
                  name={isFav ? 'heart' : 'heart-outline'}
                  size={14}
                  color={isFav ? Colors.error : '#fff'}
                />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    backgroundColor: Colors.bgSurface2,
    position: 'relative',
  },
  img: {
    width: '100%',
    height: '100%',
  },
  heartBtn: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(220,38,38,0.75)' },
});
