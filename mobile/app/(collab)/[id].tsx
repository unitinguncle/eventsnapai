/**
 * Collab Event Portal — 4-tab navigator for event members
 * ALL hooks are called before any conditional returns (fixes "Rendered fewer hooks" error)
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, Dimensions, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useLocalSearchParams, router, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../../hooks/useAuth';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { API_BASE_URL } from '../../services/api';
import api from '../../services/api';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

interface Photo {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  uploader_id?: string;
  uploader_name?: string;
  is_group_fav?: boolean;
}

type TabId = 'upload' | 'mine' | 'all' | 'favs';

export default function CollabEventScreen() {
  // ── ALL HOOKS FIRST — never after a conditional return ─────────────────────
  const { member, logout } = useAuth();
  const params = useLocalSearchParams();
  const eventId = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  const [activeTab, setActiveTab] = useState<TabId>('mine');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploaderFilter, setUploaderFilter] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const memberStr = await SecureStore.getItemAsync('auth_member');
      const memberData = memberStr ? JSON.parse(memberStr) : null;
      const token = memberData?.token;
      if (!token) return;
      const res = await fetch(`${API_BASE_URL}/events/${eventId}/photos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPhotos(data.photos || []);
    } catch (e) {
      console.error('Collab fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const fetchFavs = useCallback(async () => {
    if (!eventId) return;
    try {
      const { data } = await api.get(`/favorites/${eventId}`);
      setFavSet(new Set((data as any[]).map((f: any) => f.photo_id)));
    } catch {}
  }, [eventId]);

  useEffect(() => {
    fetchPhotos();
    fetchFavs();
  }, [fetchPhotos, fetchFavs]);

  const toggleFav = useCallback(async (photoId: string) => {
    if (!eventId) return;
    const isFav = favSet.has(photoId);
    setFavSet(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(photoId); else next.add(photoId);
      return next;
    });
    try {
      if (isFav) await api.delete(`/favorites/${eventId}/${photoId}`);
      else await api.post(`/favorites/${eventId}/${photoId}`);
    } catch {
      setFavSet(prev => {
        const next = new Set(prev);
        if (isFav) next.add(photoId); else next.delete(photoId);
        return next;
      });
    }
  }, [eventId, favSet]);

  const pickAndUpload = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Gallery access is required to upload photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);

    const memberStr = await SecureStore.getItemAsync('auth_member');
    const memberData = memberStr ? JSON.parse(memberStr) : null;
    const token = memberData?.token;

    const batchSize = 5;
    for (let i = 0; i < result.assets.length; i += batchSize) {
      const batch = result.assets.slice(i, i + batchSize);
      const formData = new FormData();
      batch.forEach(asset => {
        const filename = asset.uri.split('/').pop() || 'photo.jpg';
        formData.append('files', { uri: asset.uri, name: filename, type: 'image/jpeg' } as any);
      });
      try {
        await fetch(`${API_BASE_URL}/upload/${eventId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      } catch {
        Alert.alert('Upload Error', 'Some photos failed to upload.');
        break;
      }
    }
    setUploading(false);
    Alert.alert('Done', `Uploaded ${result.assets.length} photos!`);
    fetchPhotos();
  }, [eventId, fetchPhotos]);

  const myPhotos = useMemo(() =>
    photos.filter(p => p.uploader_id === member?.id),
    [photos, member]
  );
  const uploaders = useMemo(() =>
    Array.from(new Set(photos.map(p => p.uploader_name).filter(Boolean))) as string[],
    [photos]
  );
  const filteredAll = useMemo(() =>
    uploaderFilter ? photos.filter(p => p.uploader_name === uploaderFilter) : photos,
    [photos, uploaderFilter]
  );
  const favPhotos = useMemo(() =>
    photos.filter(p => favSet.has(p.id)),
    [photos, favSet]
  );

  // ── Auth guard — AFTER all hooks ─────────────────────────────────────────
  if (!member) return <Redirect href="/" />;

  const renderPhoto = (item: Photo) => (
    <View key={item.id} style={styles.cell}>
      <Image source={{ uri: item.thumbUrl }} style={styles.img} />
      <TouchableOpacity
        style={[styles.heartBtn, favSet.has(item.id) && styles.heartBtnActive]}
        onPress={() => toggleFav(item.id)}
      >
        <Ionicons
          name={favSet.has(item.id) ? 'heart' : 'heart-outline'}
          size={14}
          color={favSet.has(item.id) ? Colors.error : '#fff'}
        />
      </TouchableOpacity>
      {item.is_group_fav && <View style={styles.groupFavBadge}><Text>⭐</Text></View>}
    </View>
  );

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'upload', label: 'Upload', icon: 'cloud-upload' },
    { id: 'mine', label: 'Mine', icon: 'person' },
    { id: 'all', label: 'All Photos', icon: 'images' },
    { id: 'favs', label: 'Favourites', icon: 'heart' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Collab Event
        </Text>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={async () => {
            await logout();
            // <Redirect> above handles navigation once member becomes null
          }}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Exit</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Ionicons
              name={tab.icon as any}
              size={18}
              color={activeTab === tab.id ? Colors.accent : Colors.textSecondary}
            />
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <>
          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <View style={styles.uploadContainer}>
              {member.canUpload ? (
                <>
                  <Ionicons name="cloud-upload-outline" size={64} color={Colors.accent} />
                  <Text style={styles.uploadTitle}>Upload Photos</Text>
                  <Text style={styles.uploadSub}>Add your photos to the shared event album</Text>
                  <TouchableOpacity style={styles.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
                    {uploading
                      ? <ActivityIndicator color="#fff" />
                      : <><Ionicons name="images" size={20} color="#fff" /><Text style={styles.uploadBtnText}>Pick & Upload</Text></>
                    }
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Ionicons name="lock-closed-outline" size={64} color={Colors.textSecondary} />
                  <Text style={styles.uploadTitle}>Upload Not Permitted</Text>
                  <Text style={styles.uploadSub}>Your member account does not have upload permission.</Text>
                </>
              )}
            </View>
          )}

          {/* My Photos Tab */}
          {activeTab === 'mine' && (
            myPhotos.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="camera-outline" size={64} color={Colors.textSecondary} />
                <Text style={styles.emptyTitle}>No photos uploaded yet</Text>
              </View>
            ) : (
              <FlatList
                data={myPhotos}
                keyExtractor={i => i.id}
                numColumns={NUM_COLS}
                contentContainerStyle={{ gap: GAP, padding: GAP }}
                columnWrapperStyle={{ gap: GAP }}
                renderItem={({ item }) => renderPhoto(item)}
              />
            )
          )}

          {/* All Photos Tab */}
          {activeTab === 'all' && (
            <View style={{ flex: 1 }}>
              {uploaders.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsRow}
                >
                  <TouchableOpacity
                    style={[styles.chip, !uploaderFilter && styles.chipActive]}
                    onPress={() => setUploaderFilter(null)}
                  >
                    <Text style={[styles.chipText, !uploaderFilter && styles.chipTextActive]}>All</Text>
                  </TouchableOpacity>
                  {uploaders.map(name => (
                    <TouchableOpacity
                      key={name}
                      style={[styles.chip, uploaderFilter === name && styles.chipActive]}
                      onPress={() => setUploaderFilter(name === uploaderFilter ? null : name)}
                    >
                      <Text style={[styles.chipText, uploaderFilter === name && styles.chipTextActive]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {filteredAll.length === 0 ? (
                <View style={styles.center}>
                  <Ionicons name="images-outline" size={64} color={Colors.textSecondary} />
                  <Text style={styles.emptyTitle}>No photos yet</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredAll}
                  keyExtractor={i => i.id}
                  numColumns={NUM_COLS}
                  contentContainerStyle={{ gap: GAP, padding: GAP }}
                  columnWrapperStyle={{ gap: GAP }}
                  renderItem={({ item }) => renderPhoto(item)}
                />
              )}
            </View>
          )}

          {/* Favourites Tab */}
          {activeTab === 'favs' && (
            favPhotos.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="heart-outline" size={64} color={Colors.textSecondary} />
                <Text style={styles.emptyTitle}>No favourites yet</Text>
              </View>
            ) : (
              <FlatList
                data={favPhotos}
                keyExtractor={i => i.id}
                numColumns={NUM_COLS}
                contentContainerStyle={{ gap: GAP, padding: GAP }}
                columnWrapperStyle={{ gap: GAP }}
                renderItem={({ item }) => renderPhoto(item)}
              />
            )
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { ...Typography.h3, color: Colors.textPrimary, flex: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, padding: Spacing.xs },
  logoutText: { ...Typography.caption, color: Colors.error },
  tabBar: {
    flexDirection: 'row', backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.sm, gap: 2 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.accent },
  tabLabel: { ...Typography.caption, color: Colors.textSecondary, fontSize: 10 },
  tabLabelActive: { color: Colors.accent },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: Colors.bgSurface2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(244,67,54,0.7)' },
  groupFavBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: 2,
  },
  chipsRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.bgSurface2, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.accentDim, borderColor: Colors.accentBorder },
  chipText: { ...Typography.caption, color: Colors.textSecondary },
  chipTextActive: { color: Colors.accent },
  uploadContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  uploadTitle: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center' },
  uploadSub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accent, padding: Spacing.md,
    borderRadius: Radius.md, minWidth: 160, justifyContent: 'center',
  },
  uploadBtnText: { ...Typography.button, color: '#fff' },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
});
