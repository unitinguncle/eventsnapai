import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';

import { Colors } from '../../constants/colors';
import { Typography, Radius } from '../../constants/typography';
import api from '../../services/api';

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
        formData.append('event_token', visitorToken);
        formData.append('photo', {
          uri: photoUri,
          name: 'selfie.jpg',
          type: 'image/jpeg',
        } as any);

        const response = await api.post(`/visitor/${eventId}/face-search`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        // Search successful -> parse matches
        const faceId = response.data?.faceId || null;
        
        // Let animation play for at least 1-2 seconds for effect, then navigate
        setTimeout(() => {
          if (active) {
            router.replace({
              pathname: '/(visitor)/results',
              params: { eventId, visitorToken, eventName, faceId },
            });
          }
        }, 1200);

      } catch (err) {
        console.error('Search error:', err);
        // Even if search fails, we proceed to results (it will just show 0 matches, but they can still see All Photos)
        setTimeout(() => {
          if (active) {
            router.replace({
              pathname: '/(visitor)/results',
              params: { eventId, visitorToken, eventName, faceId: 'error' },
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
