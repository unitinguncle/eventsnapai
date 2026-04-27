import React from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { MasonryFlashList } from '@shopify/flash-list';

import { Photo, PhotoCell } from './PhotoCell';
import { Colors } from '../../constants/colors';
import { Typography, Spacing } from '../../constants/typography';

interface PhotoGridProps {
  photos: Photo[];
  onPhotoPress: (photo: Photo, index: number) => void;
  isLoading?: boolean;
  onEndReached?: () => void;
  emptyMessage?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function PhotoGrid({
  photos,
  onPhotoPress,
  isLoading,
  onEndReached,
  emptyMessage = 'No photos found.',
  refreshing,
  onRefresh,
}: PhotoGridProps) {
  if (isLoading && photos.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (!isLoading && photos.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <MasonryFlashList
      data={photos}
      numColumns={2}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <PhotoCell item={item} onPress={() => onPhotoPress(item, index)} index={index} />
      )}
      estimatedItemSize={220}
      contentContainerStyle={styles.listContent}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingBottom: 100, // accommodate safe area + navigation
  },
  emptyText: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
