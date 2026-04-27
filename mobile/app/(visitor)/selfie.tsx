import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';

import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

export default function SelfieScreen() {
  const { eventId, visitorToken, eventName } = useLocalSearchParams<{
    eventId: string;
    visitorToken: string;
    eventName: string;
  }>();

  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>Camera Access Required</Text>
        <Text style={styles.subtitle}>We need your camera to take a selfie for face matching.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || loading) return;

    try {
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: false,
      });

      if (photo) {
        // Compress/resize selfie before upload to save bandwidth
        const manipResult = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 800 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        setPhotoUri(manipResult.uri);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to take photo');
    } finally {
      setLoading(false);
    }
  };

  const proceedToSearch = () => {
    if (!photoUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Navigate to searching processing screen
    router.replace({
      pathname: '/(visitor)/searching',
      params: { eventId, visitorToken, eventName, photoUri },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{eventName}</Text>
        <View style={{ width: 44 }} />
      </View>

      <Text style={styles.instruction}>
        {photoUri ? "Looking good! Ready to find your photos?" : "Take a quick selfie to find your photos securely."}
      </Text>

      <View style={styles.cameraWrapper}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.camera} contentFit="cover" />
        ) : (
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="front"
          />
        )}
        
        {/* Oval Overlay mapping */}
        {!photoUri && (
          <View style={styles.overlayFrame}>
             <View style={styles.ovalHole} />
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {photoUri ? (
          <View style={styles.confirmRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.retakeBtn]} onPress={() => setPhotoUri(null)}>
               <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.findBtn]} onPress={proceedToSearch}>
               <Text style={styles.findText}>Find My Photos →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.captureBtn} onPress={takePicture} disabled={loading}>
            <View style={styles.captureInner}>
              {loading && <ActivityIndicator color={Colors.accent} />}
            </View>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  title: {
    ...Typography.h2,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  btn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  btnText: {
    ...Typography.button,
    color: '#fff',
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.full,
  },
  backIcon: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
  },
  instruction: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },

  cameraWrapper: {
    flex: 1,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    backgroundColor: Colors.skeletonBase,
  },
  camera: {
    flex: 1,
  },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovalHole: {
    width: 250,
    height: 350,
    borderRadius: 150,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    borderStyle: 'dashed',
  },

  controls: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  confirmRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retakeBtn: {
    backgroundColor: Colors.bgSurface2,
  },
  retakeText: {
    ...Typography.button,
    color: Colors.textPrimary,
  },
  findBtn: {
    backgroundColor: Colors.accent,
  },
  findText: {
    ...Typography.button,
    color: '#fff',
  },
});
