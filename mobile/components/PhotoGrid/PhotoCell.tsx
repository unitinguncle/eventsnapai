import React from 'react';
import { View, Image as RNImage, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors } from '../../constants/colors';
import { Radius, Typography } from '../../constants/typography';

export interface Photo {
  id: string;
  originalUrl?: string; // Pre-signed full resolution
  compressedUrl?: string; // Pre-signed webp
  filename: string;
  isFavourite?: boolean;
}

interface PhotoCellProps {
  item: Photo;
  onPress: (photo: Photo) => void;
  onToggleFavourite?: (photo: Photo) => void;
  index: number;
}

export function PhotoCell({ item, onPress, onToggleFavourite, index }: PhotoCellProps) {
  // Simple deterministic height for masonry effect based on index
  const heights = [200, 250, 180, 280, 220, 260];
  const height = heights[index % heights.length];

  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={[styles.container, { height, transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => onPress(item)}
        style={styles.touchable}
      >
        <Image
          source={{ uri: item.compressedUrl || item.originalUrl }}
          style={styles.image}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
        />

        {/* Highlight/Favourite overlay */}
        {item.isFavourite && (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)']}
            style={styles.gradient}
          >
            <View style={styles.favBadge}>
              <Text style={styles.favIcon}>❤️</Text>
            </View>
          </LinearGradient>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 4,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.skeletonBase,
  },
  touchable: {
    flex: 1,
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    justifyContent: 'flex-end',
    padding: 8,
  },
  favBadge: {
    alignSelf: 'flex-end',
  },
  favIcon: {
    fontSize: 16,
  },
});
