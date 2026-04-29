import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../../../services/api';
import { useAuth } from '../../../../hooks/useAuth';
import { useEventData } from '../../../../hooks/useEventData';
import Slider from '@react-native-community/slider';

interface UploadItem {
  uri: string;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export default function UploadTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { event, setJpegQuality } = useEventData(eventId as string);
  
  const isPremium = user?.featureManualCompression;
  const currentQuality = event?.jpeg_quality ?? 82;
  const [sliderValue, setSliderValue] = useState(currentQuality);
  const [isSavingQuality, setIsSavingQuality] = useState(false);

  React.useEffect(() => {
    if (event) setSliderValue(event.jpeg_quality ?? 82);
  }, [event]);

  const saveQuality = async () => {
    try {
      setIsSavingQuality(true);
      await setJpegQuality(sliderValue);
      Alert.alert('Saved', `JPEG Quality set to ${sliderValue}. Next upload will use this setting.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save quality');
    } finally {
      setIsSavingQuality(false);
    }
  };

  const resetQuality = async () => {
    try {
      setIsSavingQuality(true);
      await setJpegQuality(null);
      setSliderValue(82);
      Alert.alert('Reset', 'Quality reset to system default (82).');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reset quality');
    } finally {
      setIsSavingQuality(false);
    }
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need access to your gallery to upload photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });

    if (!result.canceled && result.assets) {
      const newItems = result.assets.map((asset, index) => ({
        uri: asset.uri,
        id: `img-${Date.now()}-${index}`,
        status: 'pending' as const,
      }));
      setItems((prev) => [...prev, ...newItems]);
    }
  };

  const removeImage = (idToRemove: string) => {
    if (isProcessing) return;
    setItems((prev) => prev.filter((item) => item.id !== idToRemove));
  };

  const startUpload = async () => {
    const pendingItems = items.filter(item => item.status === 'pending' || item.status === 'error');
    if (pendingItems.length === 0) return;

    setIsProcessing(true);
    const token = await SecureStore.getItemAsync('auth_token');

    try {
      const batchSize = 5;
      for (let i = 0; i < pendingItems.length; i += batchSize) {
        const batch = pendingItems.slice(i, i + batchSize);
        
        setItems(prev => prev.map(item => 
          batch.find(b => b.id === item.id) ? { ...item, status: 'uploading' } : item
        ));

        const formData = new FormData();
        
        for (const item of batch) {
          const filename = item.uri.split('/').pop() || 'photo.jpg';
          formData.append('files', {
            uri: item.uri,
            name: filename,
            type: 'image/jpeg',
          } as any);
        }

        const response = await fetch(`${API_BASE_URL}/upload/${eventId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Upload failed for a batch');
        }

        setItems(prev => prev.map(item => 
          batch.find(b => b.id === item.id) ? { ...item, status: 'success' } : item
        ));
      }

      Alert.alert('Success', `Uploaded ${pendingItems.length} photos successfully!`);
      setTimeout(() => {
        setItems(prev => prev.filter(item => item.status !== 'success'));
      }, 2000);

    } catch (err: any) {
      console.error('Upload Error:', err);
      setItems(prev => prev.map(item => 
        pendingItems.find(p => p.id === item.id) ? { ...item, status: 'error', error: err.message } : item
      ));
      Alert.alert('Upload Failed', err.message || 'An error occurred during upload.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.listContent}>
        
        <View style={[styles.compressionPanel, !isPremium && styles.compressionPanelDisabled]}>
          <View style={styles.compressionHeader}>
            <Text style={styles.compressionTitle}>🎛️ JPEG Compression Quality</Text>
            {!isPremium && <Text style={styles.premiumBadge}>🔒 Premium</Text>}
          </View>
          <Text style={styles.compressionHint}>Next upload takes effect · existing photos unchanged</Text>

          <View style={[styles.sliderRow, !isPremium && { opacity: 0.4 }]}>
            <Text style={styles.sliderLabel}>Low</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={sliderValue}
              onValueChange={setSliderValue}
              minimumTrackTintColor={Colors.accent}
              maximumTrackTintColor="rgba(255,255,255,0.1)"
              thumbTintColor={Colors.accent}
              disabled={!isPremium || isSavingQuality}
            />
            <Text style={styles.sliderLabel}>High</Text>
          </View>

          <View style={styles.compressionActions}>
            <Text style={styles.qualityValue}>{sliderValue} <Text style={{ fontSize: 12, color: Colors.textSecondary }}>/ 100</Text></Text>
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity style={styles.resetBtn} onPress={resetQuality} disabled={!isPremium || isSavingQuality}>
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveQuality} disabled={!isPremium || isSavingQuality}>
                {isSavingQuality ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Apply ✔</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {isPremium && sliderValue > 82 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>⚠️ Quality above 82 increases file size — uploads may be slower.</Text>
            </View>
          )}
          {!isPremium && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>🔒 Manual compression is a premium feature. Contact your admin to enable it.</Text>
            </View>
          )}
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-upload-outline" size={64} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>No photos selected</Text>
            <Text style={styles.emptySub}>Tap below to choose photos from your gallery.</Text>
          </View>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.itemCard}>
              <Image source={{ uri: item.uri }} style={styles.itemImage} />
              <View style={styles.itemInfo}>
                <Text style={styles.itemStatus}>
                  {item.status === 'pending' && 'Ready to upload'}
                  {item.status === 'uploading' && 'Uploading...'}
                  {item.status === 'success' && 'Uploaded successfully!'}
                  {item.status === 'error' && <Text style={{ color: Colors.error }}>{item.error || 'Failed'}</Text>}
                </Text>
              </View>
              {item.status === 'pending' || item.status === 'error' ? (
                <TouchableOpacity onPress={() => removeImage(item.id)} style={styles.removeBtn}>
                  <Ionicons name="close-circle" size={24} color={Colors.textSecondary} />
                </TouchableOpacity>
              ) : (
                <ActivityIndicator color={item.status === 'success' ? Colors.success : Colors.accent} />
              )}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.pickBtn} 
          onPress={pickImages}
          disabled={isProcessing}
        >
          <Ionicons name="images" size={20} color="#fff" />
          <Text style={styles.btnText}>Pick Photos</Text>
        </TouchableOpacity>
        
        {items.filter(i => i.status === 'pending' || i.status === 'error').length > 0 && (
          <TouchableOpacity 
            style={[styles.uploadBtn, isProcessing && styles.uploadBtnDisabled]} 
            onPress={startUpload}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={20} color="#fff" />
                <Text style={styles.btnText}>Upload All</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  compressionPanel: {
    backgroundColor: Colors.bgSurface,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
  },
  compressionPanelDisabled: {
    borderColor: 'rgba(217,119,6,0.3)',
  },
  compressionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  compressionTitle: {
    ...Typography.bodyMedium,
    color: Colors.textPrimary,
  },
  premiumBadge: {
    ...Typography.caption,
    color: '#d97706',
    backgroundColor: 'rgba(217,119,6,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.3)',
  },
  compressionHint: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sliderLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    width: 32,
    textAlign: 'center',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  compressionActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qualityValue: {
    ...Typography.h3,
    color: Colors.accent,
  },
  resetBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.bgSurface2,
    borderRadius: Radius.sm,
  },
  resetBtnText: {
    ...Typography.caption,
    color: Colors.textPrimary,
  },
  saveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
  },
  saveBtnText: {
    ...Typography.caption,
    color: '#fff',
    fontWeight: 'bold',
  },
  warningBox: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    backgroundColor: 'rgba(217,119,6,0.08)',
    borderRadius: Radius.sm,
  },
  warningText: {
    ...Typography.caption,
    color: '#d97706',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  emptySub: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgSurface,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: Radius.sm,
    backgroundColor: Colors.bgSurface2,
  },
  itemInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  itemStatus: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  removeBtn: {
    padding: Spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    padding: Spacing.xl,
    backgroundColor: Colors.bgSurface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
  },
  pickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgSurface2,
    padding: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  uploadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    padding: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  uploadBtnDisabled: {
    opacity: 0.7,
  },
  btnText: {
    ...Typography.button,
    color: '#fff',
  },
});
