import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Dimensions, Animated } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import api from '../../services/api';
import { PhotoGrid } from '../../components/PhotoGrid/PhotoGrid';
import { PhotoViewer } from '../../components/PhotoViewer/PhotoViewer';
import { Photo } from '../../components/PhotoGrid/PhotoCell';

const { width } = Dimensions.get('window');
const TABS = ['My Matches', 'All Photos', 'Highlights'];

export default function ResultsScreen() {
  const { eventId, visitorToken, eventName, faceId } = useLocalSearchParams<{
    eventId: string;
    visitorToken: string;
    eventName: string;
    faceId?: string;
  }>();

  const [activeTab, setActiveTab] = useState(faceId && faceId !== 'error' ? 0 : 1);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Photo viewer state
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Fetch photos based on active tab
  const fetchPhotos = async (pageNum = 1, isRefresh = false) => {
    try {
      if (pageNum === 1) {
        if (!isRefresh) setLoading(true);
        setHasMore(true);
      }

      setPage(pageNum);

      // Determine endpoint based on tab
      let endpoint = `/visitor/${eventId}/photos?page=${pageNum}`;
      if (activeTab === 0 && faceId && faceId !== 'error') {
        endpoint += `&faceId=${faceId}`;
      } else if (activeTab === 2) {
        endpoint += `&filter=highlights`;
      }

      const response = await api.get(endpoint, {
        headers: { Authorization: `Bearer ${visitorToken}` },
      });

      const newPhotos: Photo[] = response.data.map((p: any) => ({
        id: p.id,
        filename: p.original_filename,
        originalUrl: p.watermarked_url || p.presigned_url, // fallback
        compressedUrl: p.compressed_url || p.watermarked_url,
        isFavourite: false, // Could map from backend if visitors have favourites
      }));

      if (pageNum === 1) {
        setPhotos(newPhotos);
      } else {
        setPhotos(prev => [...prev, ...newPhotos]);
      }

      if (newPhotos.length < 20) { // Assuming limit=20
        setHasMore(false);
      }
    } catch (err) {
      console.error('Fetch photos err:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPhotos(1);
  }, [activeTab, faceId]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPhotos(1, true);
  };

  const onLoadMore = () => {
    if (!loading && hasMore) {
      fetchPhotos(page + 1);
    }
  };

  const handlePhotoPress = (photo: Photo, index: number) => {
    setViewerIndex(index);
  };

  return (
    <SafeAreaView style={styles.container}>
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
          // If no face ID matched, disable My Matches tab visually
          const isDisabled = idx === 0 && (!faceId || faceId === 'error');
          
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
          isLoading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onEndReached={onLoadMore}
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
    </SafeAreaView>
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
