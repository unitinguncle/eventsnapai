/**
 * PhotoGridSkeleton — Shimmer skeleton grid shown while photos load
 * Uses only React Native's built-in Animated API (no extra deps)
 */
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { Colors } from '../../constants/colors';

const NUM_COLS = 3;
const GAP = 2;
const CELL = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;
const CELL_COUNT = 18; // 6 rows × 3 cols

function ShimmerCell({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.cell, { opacity }]} />;
}

export function PhotoGridSkeleton() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: CELL_COUNT }).map((_, i) => (
        <ShimmerCell key={i} delay={(i % 3) * 150} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    padding: GAP,
    backgroundColor: Colors.bgPrimary,
  },
  cell: {
    width: CELL,
    height: CELL,
    backgroundColor: Colors.bgSurface2,
    borderRadius: 2,
  },
});
