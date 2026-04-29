import React, { useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text,
  Dimensions, Share, BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { FlatList, GestureHandlerRootView, PinchGestureHandler, State } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';

import { Photo } from '../PhotoGrid/PhotoCell';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface PhotoViewerProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onToggleFavourite?: (photoId: string) => Promise<void>;
  showFavouriteBtn?: boolean;
}

// ── Per-photo zoomable wrapper ────────────────────────────────────────────────
function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinchHandler = useAnimatedGestureHandler({
    onActive: (event) => {
      scale.value = Math.max(1, Math.min(savedScale.value * event.scale, 5));
    },
    onEnd: () => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
      } else {
        savedScale.value = scale.value;
      }
    },
  });

  // Double-tap resets zoom
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleDoubleTap = () => {
    if (scale.value > 1) {
      scale.value = withSpring(1);
      savedScale.value = 1;
    } else {
      scale.value = withSpring(2.5);
      savedScale.value = 2.5;
    }
  };

  return (
    <PinchGestureHandler onGestureEvent={pinchHandler}>
      <Animated.View style={[styles.imgContainer, animatedStyle]}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          onLongPress={handleDoubleTap}
          delayLongPress={250}
          style={styles.imgContainer}
        >
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit="contain"
            transition={200}
          />
        </TouchableOpacity>
      </Animated.View>
    </PinchGestureHandler>
  );
}

// ── Main Viewer ───────────────────────────────────────────────────────────────
export function PhotoViewer({
  photos, initialIndex, onClose, onToggleFavourite, showFavouriteBtn,
}: PhotoViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);
  const [showUI, setShowUI] = useState(true);

  const flatListRef = useRef<FlatList>(null);

  // Hardware back button closes viewer
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const handleDownload = async () => {
    const photo = photos[currentIndex];
    if (!photo?.originalUrl) return;
    try {
      setDownloading(true);
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { alert('Permission needed to save photos'); return; }
      const fileUri = `${FileSystem.documentDirectory}${photo.filename}`;
      const { uri } = await FileSystem.downloadAsync(photo.originalUrl, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('Photo saved to gallery! 🎉');
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
      Share.share({ url: photo.originalUrl });
    }
  };

  const renderItem = ({ item }: { item: Photo }) => (
    <TouchableOpacity
      activeOpacity={1}
      onPress={() => setShowUI(v => !v)}
      style={styles.pageContainer}
    >
      <ZoomableImage uri={item.originalUrl || item.compressedUrl} />
    </TouchableOpacity>
  );

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
          <LinearGradient colors={['rgba(0,0,0,0.85)', 'transparent']} style={styles.topBar}>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <Text style={styles.iconText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.counterWrap}>
              <Text style={styles.counter}>{currentIndex + 1} / {photos.length}</Text>
              <Text style={styles.zoomHint}>Pinch to zoom · Long-press to zoom 2.5×</Text>
            </View>
            <View style={styles.iconBtn} />
          </LinearGradient>

          {/* Bottom Bar */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomBar}>
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
  pageContainer: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imgContainer: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 110,
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
    fontSize: 22,
  },
  counterWrap: {
    alignItems: 'center',
    marginBottom: 6,
  },
  counter: {
    ...Typography.bodyMedium,
    color: '#fff',
  },
  zoomHint: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
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
    justifyContent: 'space-around',
    backgroundColor: 'rgba(20,27,45,0.75)',
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  actionBtn: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
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
