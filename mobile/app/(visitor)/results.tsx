import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, BackHandler } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { PhotoGrid } from '../../components/PhotoGrid/PhotoGrid';
import { PhotoViewer } from '../../components/PhotoViewer/PhotoViewer';
import { Photo } from '../../components/PhotoGrid/PhotoCell';
import { useVisitorStore } from '../../store/visitorStore';

const { width } = Dimensions.get('window');
const TABS = ['My Matches', 'All Photos', 'Highlights'];

export default function ResultsScreen() {
  const { eventId, eventName } = useLocalSearchParams<{
    eventId: string;
    eventName: string;
  }>();

  const insets = useSafeAreaInsets();
  const searchResults = useVisitorStore(state => state.searchResults);
  
  // Decide initial tab. If myPhotos exists, tab 0. Else tab 1.
  const hasMyPhotos = searchResults && searchResults.myPhotos && searchResults.myPhotos.length > 0;
  const [activeTab, setActiveTab] = useState(hasMyPhotos ? 0 : 1);

  // Derive photos based on active tab
  const getPhotosForTab = (): Photo[] => {
    if (!searchResults) return [];
    
    let rawList = [];
    if (activeTab === 0) rawList = searchResults.myPhotos;
    else if (activeTab === 1) rawList = searchResults.generalPhotos;
    else if (activeTab === 2) rawList = searchResults.favoritePhotos;

    return (rawList || []).map((p: any) => ({
      id: p.objectId,
      filename: `photo_${p.objectId}.jpg`,
      originalUrl: p.fullUrl,
      compressedUrl: p.thumbUrl,
      isFavourite: activeTab === 2, // If in highlights, assume it's a favourite
    }));
  };

  const photos = getPhotosForTab();

  // Photo viewer state
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Intercept Android hardware back button
  useEffect(() => {
    const onBack = () => {
      if (viewerIndex !== null) {
        // If viewer is open → close it and stay on results grid
        setViewerIndex(null);
        return true; // consumed
      }
      // If on results grid → go back to selfie screen (not QR scan)
      router.back();
      return true; // consumed
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, [viewerIndex]);

  const handlePhotoPress = useCallback((photo: Photo, index: number) => {
    setViewerIndex(index);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{eventName}</Text>
          <Text style={styles.headerSubtitle}>
            {photos.length} {photos.length === 1 ? 'Photo' : 'Photos'}
          </Text>
        </View>
        <TouchableOpacity style={styles.leaveBtn} onPress={() => router.replace('/')}>
          <Text style={styles.leaveText}>EXIT</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {TABS.map((tab, idx) => {
          const isActive = activeTab === idx;
          // If no face ID matched, visually disable My Matches
          const isDisabled = idx === 0 && !hasMyPhotos;
          
          if (isDisabled) return null;

          return (
            <TouchableOpacity 
              key={tab} 
              style={[styles.tabBtn, isActive && styles.tabBtnActive]}
              onPress={() => setActiveTab(idx)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Grid */}
      <View style={{ flex: 1 }}>
        <PhotoGrid 
          photos={photos}
          isLoading={false}
          onPhotoPress={handlePhotoPress}
          emptyMessage={
            activeTab === 0 ? "No facial matches found for your selfie." : "No photos available yet."
          }
        />
      </View>

      {/* Full Screen Viewer Overlay */}
      {viewerIndex !== null && (
        <PhotoViewer
          photos={photos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          showFavouriteBtn={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  headerTitle: {
    ...Typography.h2,
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  leaveBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.full,
  },
  leaveText: {
    ...Typography.buttonSmall,
    color: Colors.error,
  },
  
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  tabBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  tabText: {
    ...Typography.buttonSmall,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: '#fff',
  },
});
