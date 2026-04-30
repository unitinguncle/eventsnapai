/**
 * Collab Event Portal — complete rewrite using correct API endpoints
 *
 * API endpoints (from src/routes/collab.js):
 *   GET /collab/:eventId/all-photos         → all photos with uploader info
 *   GET /collab/:eventId/my-favorites       → member's personal favourites
 *   GET /collab/:eventId/my-favorites/ids   → just the IDs (fast sync)
 *   GET /collab/:eventId/group-favorites    → manager-curated group favs
 *   POST/DELETE /collab/:eventId/my-favorites/:photoId
 *   GET /collab/:eventId/uploaders          → distinct uploaders for filter chips
 *   POST /upload/:eventId                   → upload photos (member JWT accepted)
 *
 * Auth: member JWT stored in SecureStore as 'auth_member' → { token, member }
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  FlatList, Dimensions, ActivityIndicator, Alert,
  ScrollView, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../../hooks/useAuth';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { API_BASE_URL } from '../../services/api';
import { PhotoGridSkeleton } from '../../components/ui/PhotoGridSkeleton';
import { PhotoViewer } from '../../components/PhotoViewer/PhotoViewer';

const NUM_COLS = 3;
const GAP = 2;
const CELL_SIZE = (Dimensions.get('window').width - GAP * (NUM_COLS + 1)) / NUM_COLS;

interface CollabPhoto {
  id: string;
  rustfs_object_id: string;
  thumbUrl: string;
  fullUrl: string;
  uploaded_by?: string;
  uploader_name?: string;
  uploader_username?: string;
  is_group_fav?: boolean;
}

interface Uploader {
  id: string;
  display_name: string;
  username: string;
  photo_count: number;
}

type TabId = 'upload' | 'mine' | 'all' | 'favs';

function toViewerPhoto(p: CollabPhoto) {
  return { id: p.id, filename: p.rustfs_object_id || p.id, originalUrl: p.fullUrl, compressedUrl: p.thumbUrl };
}

// Helper: get member token from SecureStore
// useAuth.memberLogin stores: auth_token = JWT, auth_member = member metadata (no token field)
async function getMemberToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync('auth_token');
  } catch { return null; }
}

// Helper: authenticated fetch using member token
async function memberFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getMemberToken();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function CollabEventScreen() {
  // ── ALL HOOKS FIRST ───────────────────────────────────────────────────────
  const { member, logout } = useAuth();
  const params = useLocalSearchParams();
  const eventId = (Array.isArray(params.id) ? params.id[0] : params.id) as string;

  const [activeTab, setActiveTab] = useState<TabId>('mine');
  const [allPhotos, setAllPhotos] = useState<CollabPhoto[]>([]);
  const [groupFavIds, setGroupFavIds] = useState<Set<string>>(new Set());
  const [myFavIds, setMyFavIds] = useState<Set<string>>(new Set());
  const [uploaders, setUploaders] = useState<Uploader[]>([]);
  const [uploaderFilter, setUploaderFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerPhotos, setViewerPhotos] = useState<CollabPhoto[]>([]);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!eventId) return;
    try {
      // Fetch all photos, uploaders, and fav IDs in parallel
      const [photosRes, uploadersRes, myFavRes] = await Promise.all([
        memberFetch(`${API_BASE_URL}/collab/${eventId}/all-photos`),
        memberFetch(`${API_BASE_URL}/collab/${eventId}/uploaders`),
        memberFetch(`${API_BASE_URL}/collab/${eventId}/my-favorites/ids`),
      ]);

      if (!mountedRef.current) return;

      if (photosRes.ok) {
        const data = await photosRes.json();
        setAllPhotos(data.photos ?? []);
      } else {
        console.error('[collab] all-photos error', photosRes.status, await photosRes.text());
      }

      if (uploadersRes.ok) {
        const data = await uploadersRes.json();
        setUploaders(data ?? []);
      }

      if (myFavRes.ok) {
        const ids = await myFavRes.json();
        setMyFavIds(new Set(ids as string[]));
      }

      // Group favs (manager-curated highlights)
      try {
        const gfRes = await memberFetch(`${API_BASE_URL}/collab/${eventId}/group-favorites`);
        if (gfRes.ok) {
          const gfData = await gfRes.json();
          setGroupFavIds(new Set((gfData.photos ?? []).map((p: any) => p.id)));
        }
      } catch {}

    } catch (e) {
      console.error('[collab] fetch error', e);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [eventId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Favourite toggle (optimistic) ────────────────────────────────────────
  const myFavIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { myFavIdsRef.current = myFavIds; }, [myFavIds]);

  const toggleMyFav = useCallback(async (photoId: string) => {
    const isFav = myFavIdsRef.current.has(photoId);
    // Optimistic
    setMyFavIds(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(photoId); else next.add(photoId);
      return next;
    });
    try {
      const method = isFav ? 'DELETE' : 'POST';
      const res = await memberFetch(`${API_BASE_URL}/collab/${eventId}/my-favorites/${photoId}`, { method });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Rollback
      setMyFavIds(prev => {
        const next = new Set(prev);
        if (isFav) next.add(photoId); else next.delete(photoId);
        return next;
      });
    }
  }, [eventId]);

  // ── Upload ────────────────────────────────────────────────────────────────
  const pickAndUpload = useCallback(async () => {
    if (!member?.canUpload) {
      Alert.alert('No Permission', 'Your account does not have upload permission for this event.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
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
    const token = await getMemberToken();
    let successCount = 0;
    const BATCH = 5;

    for (let i = 0; i < result.assets.length; i += BATCH) {
      const batch = result.assets.slice(i, i + BATCH);
      const formData = new FormData();
      batch.forEach(asset => {
        const name = asset.uri.split('/').pop() || `photo_${i}.jpg`;
        formData.append('files', { uri: asset.uri, name, type: 'image/jpeg' } as any);
      });
      try {
        const res = await fetch(`${API_BASE_URL}/upload/${eventId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) successCount += batch.length;
        else {
          const err = await res.json().catch(() => ({}));
          console.warn('[collab upload] batch failed:', err);
        }
      } catch (e) {
        console.error('[collab upload] error', e);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      Alert.alert('✅ Uploaded', `${successCount} photo${successCount !== 1 ? 's' : ''} uploaded! It may take a moment to process.`);
      setTimeout(() => fetchAll(), 3000); // re-fetch after processing
    } else {
      Alert.alert('Upload Failed', 'None of the photos could be uploaded. Check your connection.');
    }
  }, [member, eventId, fetchAll]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const myPhotos = useMemo(() =>
    allPhotos.filter(p => p.uploaded_by === member?.id),
    [allPhotos, member]
  );
  const filteredAll = useMemo(() =>
    uploaderFilter ? allPhotos.filter(p => p.uploaded_by === uploaderFilter) : allPhotos,
    [allPhotos, uploaderFilter]
  );
  const myFavPhotos = useMemo(() =>
    allPhotos.filter(p => myFavIds.has(p.id)),
    [allPhotos, myFavIds]
  );

  // ── Auth guard — AFTER all hooks ─────────────────────────────────────────
  if (!member) return <Redirect href="/" />;

  // ── Photo grid renderer ───────────────────────────────────────────────────
  const openViewer = (list: CollabPhoto[], index: number) => {
    setViewerPhotos(list);
    setViewerIndex(index);
  };

  const renderPhotoCell = (item: CollabPhoto, index: number, list: CollabPhoto[]) => {
    const isFav = myFavIds.has(item.id);
    const isGroupFav = groupFavIds.has(item.id);
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.cell}
        onPress={() => openViewer(list, index)}
        activeOpacity={0.88}
      >
        <Image source={{ uri: item.thumbUrl }} style={styles.img} />
        {/* Heart button */}
        <TouchableOpacity
          style={[styles.heartBtn, isFav && styles.heartBtnActive]}
          onPress={() => toggleMyFav(item.id)}
        >
          <Ionicons
            name={isFav ? 'heart' : 'heart-outline'}
            size={14}
            color={isFav ? Colors.error : '#fff'}
          />
        </TouchableOpacity>
        {/* Uploader badge */}
        {item.uploader_name && (
          <View style={styles.uploaderBadge}>
            <Text style={styles.uploaderText}>{item.uploader_name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        {/* Group fav star */}
        {isGroupFav && (
          <View style={styles.starBadge}><Text style={{ fontSize: 10 }}>⭐</Text></View>
        )}
      </TouchableOpacity>
    );
  };

  const renderGrid = (list: CollabPhoto[], emptyMsg: string) => {
    if (loading && list.length === 0) return <PhotoGridSkeleton />;
    if (!loading && list.length === 0) return (
      <View style={styles.emptyCenter}>
        <Ionicons name="images-outline" size={56} color={Colors.textSecondary} />
        <Text style={styles.emptyText}>{emptyMsg}</Text>
      </View>
    );
    return (
      <FlatList
        data={list}
        keyExtractor={p => p.id}
        numColumns={NUM_COLS}
        contentContainerStyle={{ gap: GAP, padding: GAP }}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item, index }) => renderPhotoCell(item, index, list)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={Colors.accent} />
        }
      />
    );
  };

  const tabs: { id: TabId; label: string; icon: any; count?: number }[] = [
    { id: 'upload', label: 'Upload', icon: 'cloud-upload' },
    { id: 'mine', label: 'My Photos', icon: 'person', count: myPhotos.length },
    { id: 'all', label: 'All Photos', icon: 'images', count: allPhotos.length },
    { id: 'favs', label: 'Favourites', icon: 'heart', count: myFavIds.size },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{member.eventName || 'Collab Event'}</Text>
          <Text style={styles.headerSub}>Joined as {member.displayName}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={async () => {
          Alert.alert('Exit', 'Leave this collab session?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Exit', style: 'destructive', onPress: () => logout() },
          ]);
        }}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Ionicons name={tab.icon} size={16} color={isActive ? Colors.accent : Colors.textSecondary} />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
              {!!tab.count && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{tab.count}</Text></View>}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <View style={styles.uploadCenter}>
            {member.canUpload ? (
              <>
                <View style={styles.uploadIcon}>
                  <Ionicons name="cloud-upload-outline" size={56} color={Colors.accent} />
                </View>
                <Text style={styles.uploadTitle}>Share Your Photos</Text>
                <Text style={styles.uploadSub}>Add your photos to the shared event album. Batches of 5 are processed at a time.</Text>
                <TouchableOpacity style={styles.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
                  {uploading
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={styles.uploadBtnText}>Uploading...</Text></>
                    : <><Ionicons name="images" size={20} color="#fff" /><Text style={styles.uploadBtnText}>Pick & Upload</Text></>
                  }
                </TouchableOpacity>
                <Text style={styles.uploadNote}>Photos may take a moment to appear after upload due to face indexing.</Text>
              </>
            ) : (
              <>
                <Ionicons name="lock-closed-outline" size={56} color={Colors.textSecondary} />
                <Text style={styles.uploadTitle}>Upload Disabled</Text>
                <Text style={styles.uploadSub}>Your account does not have upload permission. Contact the event organizer.</Text>
              </>
            )}
          </View>
        )}

        {/* My Photos */}
        {activeTab === 'mine' && renderGrid(myPhotos, 'You haven\'t uploaded any photos yet.')}

        {/* All Photos */}
        {activeTab === 'all' && (
          <View style={{ flex: 1 }}>
            {/* Uploader filter chips */}
            {uploaders.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                <TouchableOpacity
                  style={[styles.chip, !uploaderFilter && styles.chipActive]}
                  onPress={() => setUploaderFilter(null)}
                >
                  <Text style={[styles.chipText, !uploaderFilter && styles.chipTextActive]}>All</Text>
                </TouchableOpacity>
                {uploaders.map(u => (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.chip, uploaderFilter === u.id && styles.chipActive]}
                    onPress={() => setUploaderFilter(uploaderFilter === u.id ? null : u.id)}
                  >
                    <Text style={[styles.chipText, uploaderFilter === u.id && styles.chipTextActive]}>
                      {u.display_name} ({u.photo_count})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {renderGrid(filteredAll, 'No photos in this event yet.')}
          </View>
        )}

        {/* Favourites */}
        {activeTab === 'favs' && renderGrid(myFavPhotos, 'No favourites yet. Tap the ♡ on any photo.')}
      </View>

      {/* Photo Viewer */}
      {viewerIndex !== null && viewerPhotos.length > 0 && (
        <PhotoViewer
          photos={viewerPhotos.map(toViewerPhoto)}
          initialIndex={viewerIndex}
          onClose={() => { setViewerIndex(null); setViewerPhotos([]); }}
          onToggleFavourite={async (photoId) => toggleMyFav(photoId)}
          favouriteIds={myFavIds}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { ...Typography.h3, color: Colors.textPrimary },
  headerSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  logoutBtn: { padding: Spacing.sm },
  tabBar: {
    flexDirection: 'row', backgroundColor: Colors.bgSurface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, gap: 2, position: 'relative' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.accent },
  tabLabel: { ...Typography.caption, color: Colors.textSecondary, fontSize: 9 },
  tabLabelActive: { color: Colors.accent },
  tabBadge: {
    position: 'absolute', top: 4, right: 6,
    backgroundColor: Colors.accentDim, borderRadius: 8,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  tabBadgeText: { fontSize: 8, color: Colors.accent, fontWeight: 'bold' },
  // Photo grid
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: Colors.bgSurface2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  heartBtn: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 4,
  },
  heartBtnActive: { backgroundColor: 'rgba(220,38,38,0.75)' },
  uploaderBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10,
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  uploaderText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  starBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: 2,
  },
  emptyCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.md },
  // Upload tab
  uploadCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.md },
  uploadIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.accentDim,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadTitle: { ...Typography.h3, color: Colors.textPrimary, textAlign: 'center' },
  uploadSub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center' },
  uploadNote: { ...Typography.caption, color: Colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.accent, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md, minWidth: 180, justifyContent: 'center',
  },
  uploadBtnText: { ...Typography.button, color: '#fff' },
  // Chips
  chipsRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.bgSurface2, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.accentDim, borderColor: Colors.accentBorder ?? Colors.accent },
  chipText: { ...Typography.caption, color: Colors.textSecondary },
  chipTextActive: { color: Colors.accent, fontWeight: 'bold' },
});
