import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';

import { Colors } from '../../constants/colors';
import { Typography, Radius } from '../../constants/typography';
import api from '../../services/api';
import { useVisitorStore } from '../../store/visitorStore';

export default function SearchingScreen() {
  const { eventId, visitorToken, eventName, photoUri } = useLocalSearchParams<{
    eventId: string;
    visitorToken: string;
    eventName: string;
    photoUri: string;
  }>();

  const scanAnim = useRef(new Animated.Value(0)).current;

  // Run scanner animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { 
          toValue: 1, 
          duration: 1500, 
          easing: Easing.inOut(Easing.ease), 
          useNativeDriver: true 
        }),
        Animated.timing(scanAnim, { 
          toValue: 0, 
          duration: 1500, 
          easing: Easing.inOut(Easing.ease), 
          useNativeDriver: true 
        }),
      ])
    ).start();
  }, [scanAnim]);

  // Execute Search
  useEffect(() => {
    let active = true;

    const performSearch = async () => {
      try {
        const fileInfo = await FileSystem.getInfoAsync(photoUri);
        if (!fileInfo.exists) throw new Error('Photo not found');

        const formData = new FormData();
        // Matches website exactly: selfie + Authorization header only
        formData.append('selfie', {
          uri: photoUri,
          name: 'selfie.jpg',
          type: 'image/jpeg',
        } as any);

        // Use fetch (not axios) — exactly how the website does it.
        // axios has a known React Native bug with multipart FormData boundaries.
        const response = await fetch('https://delivery.raidcloud.in/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${visitorToken}`,
            // Do NOT set Content-Type — fetch sets it automatically with the correct boundary
          },
          body: formData,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Search failed with status ${response.status}`);
        }

        const data = await response.json();

        // Store full payload in Zustand (same structure as website's myPhotos/generalPhotos/favoritePhotos)
        useVisitorStore.getState().setSearchResults(data);
        
        // Let animation play for at least 1-2 seconds for effect, then navigate
        setTimeout(() => {
          if (active) {
            router.replace({
              pathname: '/(visitor)/results',
              params: { eventId, eventName },
            });
          }
        }, 1200);

      } catch (err: any) {
        // Log full details to help diagnose
        console.error('Search error:', err?.message || err);
        console.error('Search error detail:', JSON.stringify(err));
        
        // Still navigate to results - will show empty state gracefully
        setTimeout(() => {
          if (active) {
            router.replace({
              pathname: '/(visitor)/results',
              params: { eventId, eventName },
            });
          }
        }, 1500);
      }
    };

    performSearch();

    return () => { active = false; };
  }, [eventId, visitorToken, photoUri]);

  const translateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 250], 
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scanning Faces...</Text>
      <Text style={styles.subtitle}>AI is identifying your photos in {eventName}</Text>

      <View style={styles.avatarBox}>
        <Image source={{ uri: photoUri }} style={styles.avatar} contentFit="cover" />
        
        {/* Scanner Line */}
        <Animated.View style={[styles.scannerLine, { transform: [{ translateY }] }]}>
          <LinearGradient
            colors={['transparent', Colors.accent, 'transparent']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    ...Typography.h2,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: 40,
    textAlign: 'center',
  },
  avatarBox: {
    width: 200,
    height: 250,
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  scannerLine: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    height: 6,
    shadowColor: Colors.accent,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
});
