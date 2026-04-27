import React, { useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Dimensions, Share } from 'react-native';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { FlatList } from 'react-native-gesture-handler';

import { Photo } from '../PhotoGrid/PhotoCell';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface PhotoViewerProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onToggleFavourite?: (photoId: string) => Promise<void>;
  showFavouriteBtn?: boolean;
}

export function PhotoViewer({ photos, initialIndex, onClose, onToggleFavourite, showFavouriteBtn }: PhotoViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const [showUI, setShowUI] = useState(true);

  const flatListRef = useRef<FlatList>(null);

  const handleDownload = async () => {
    const photo = photos[currentIndex];
    if (!photo?.originalUrl) return;

    try {
      setDownloading(true);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        alert('Permission needed to save photos');
        return;
      }

      const fileUri = `${FileSystem.documentDirectory}${photo.filename}`;
      const { uri } = await FileSystem.downloadAsync(photo.originalUrl, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('Photo saved to gallery!');
    } catch (error) {
      console.error(error);
      alert('Failed to download photo');
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = async () => {
    const photo = photos[currentIndex];
    if (!photo?.originalUrl) return;

    try {
      const fileUri = `${FileSystem.cacheDirectory}${photo.filename}`;
      await FileSystem.downloadAsync(photo.originalUrl, fileUri);
      await Sharing.shareAsync(fileUri);
    } catch (error) {
      console.error(error);
      Share.share({ url: photo.originalUrl }); // fallback to URL share
    }
  };

  const renderItem = ({ item }: { item: Photo }) => {
    return (
      <TouchableOpacity activeOpacity={1} onPress={() => setShowUI(!showUI)} style={styles.imgContainer}>
        <Image
          source={{ uri: item.originalUrl || item.compressedUrl }}
          style={styles.image}
          contentFit="contain"
          transition={200}
        />
      </TouchableOpacity>
    );
  };

  const currentPhoto = photos[currentIndex];

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={photos}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setCurrentIndex(index);
        }}
        keyExtractor={(item) => item.id}
      />

      {showUI && (
        <>
          {/* Top Bar */}
          <LinearGradient colors={['rgba(0,0,0,0.8)', 'transparent']} style={styles.topBar}>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <Text style={styles.iconText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.counter}>
              {currentIndex + 1} / {photos.length}
            </Text>
            <View style={styles.iconBtn} /> {/* Spacer */}
          </LinearGradient>

          {/* Bottom Bar */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.bottomBar}>
            <View style={styles.actionsBox}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <Text style={styles.actionIcon}>🔗</Text>
                <Text style={styles.actionLabel}>Share</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleDownload} disabled={downloading}>
                <Text style={[styles.actionIcon, downloading && { opacity: 0.5 }]}>↓</Text>
                <Text style={styles.actionLabel}>{downloading ? '...' : 'Save'}</Text>
              </TouchableOpacity>

              {showFavouriteBtn && currentPhoto && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onToggleFavourite?.(currentPhoto.id)}
                >
                  <Text style={styles.actionIcon}>{currentPhoto.isFavourite ? '❤️' : '♡'}</Text>
                  <Text style={styles.actionLabel}>Fav</Text>
                </TouchableOpacity>
              )}
            </View>
          </LinearGradient>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 999,
  },
  imgContainer: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  iconBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    color: '#fff',
    fontSize: 24,
  },
  counter: {
    ...Typography.bodyMedium,
    color: '#fff',
    marginBottom: 10,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 40,
    paddingHorizontal: Spacing.xl,
  },
  actionsBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(20,27,45,0.7)',
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  actionBtn: {
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  actionIcon: {
    fontSize: 22,
    marginBottom: 4,
    color: '#fff',
  },
  actionLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
});
