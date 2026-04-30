/**
 * ClientEventContext — Shared state across all 4 client event tabs
 *
 * ARCHITECTURE NOTES (prevent infinite loops):
 * - favSetRef / albumSetRef: refs that always mirror the state value
 *   → toggleFav / toggleAlbum read from refs, NOT state
 *   → means these callbacks have [] / [eventId] deps, never recreate on state change
 * - pendingActionsRef: protects optimistic updates from being stomped by the sync interval
 * - refresh useEffect uses [] (mount only) + explicit eventId capture inside the function
 *   → avoids refresh → state change → refresh dependency change → infinite loop
 */
import React, {
  createContext, useContext, useState, useCallback,
  useEffect, useRef, ReactNode,
} from 'react';
import api from '../services/api';

export interface ClientPhoto {
  id: string;
  rustfs_object_id: string;
  thumbUrl: string;
  fullUrl: string;
  has_faces: boolean;
}

export interface ClientEventData {
  id: string;
  name: string;
  bucket_name: string;
}

interface ClientEventContextType {
  event: ClientEventData | null;
  photos: ClientPhoto[];
  favSet: Set<string>;
  albumSet: Set<string>;
  albumPhotos: ClientPhoto[];
  featureAlbum: boolean;
  loading: boolean;
  toggleFav: (photoId: string) => Promise<void>;
  toggleAlbum: (photoId: string) => Promise<void>;
  loadAlbum: () => Promise<void>;
  refresh: () => Promise<void>;
}

const ClientEventContext = createContext<ClientEventContextType | null>(null);

export function useClientEventContext() {
  const ctx = useContext(ClientEventContext);
  if (!ctx) throw new Error('useClientEventContext must be inside ClientEventProvider');
  return ctx;
}

export function ClientEventProvider({ eventId, children }: { eventId: string; children: ReactNode }) {
  const [event, setEvent] = useState<ClientEventData | null>(null);
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [albumSet, setAlbumSet] = useState<Set<string>>(new Set());
  const [albumPhotos, setAlbumPhotos] = useState<ClientPhoto[]>([]);
  const [featureAlbum, setFeatureAlbum] = useState(false);
  const [loading, setLoading] = useState(true);

  // Refs that shadow state — used in callbacks to avoid stale closures
  // and to prevent useCallback deps from including state (which causes re-creation loops)
  const favSetRef = useRef<Set<string>>(new Set());
  const albumSetRef = useRef<Set<string>>(new Set());
  const featureAlbumRef = useRef(false);
  const mountedRef = useRef(true);
  // In-flight photoIds — sync interval skips these to avoid stomping optimistic UI
  const pendingRef = useRef<Set<string>>(new Set());

  // Keep refs in sync with state
  const updateFavSet = useCallback((next: Set<string>) => {
    favSetRef.current = next;
    setFavSet(next);
  }, []);
  const updateAlbumSet = useCallback((next: Set<string>) => {
    albumSetRef.current = next;
    setAlbumSet(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Load favourites (called on mount + every 10s) ─────────────────────────
  const loadFavourites = useCallback(async () => {
    try {
      const { data } = await api.get(`/favorites/${eventId}`);
      if (!mountedRef.current) return;
      const incoming = new Set<string>((data as any[]).map((f: any) => f.photo_id));
      // For any in-flight action, preserve current optimistic state
      pendingRef.current.forEach(id => {
        if (favSetRef.current.has(id)) incoming.add(id);
        else incoming.delete(id);
      });
      updateFavSet(incoming);
    } catch {}
  }, [eventId, updateFavSet]);

  // ── Load album IDs ────────────────────────────────────────────────────────
  const loadAlbumIds = useCallback(async () => {
    try {
      const { data } = await api.get(`/album/${eventId}`);
      if (!mountedRef.current) return;
      const next = new Set<string>((data as any[]).map((r: any) => r.photo_id));
      updateAlbumSet(next);
    } catch {}
  }, [eventId, updateAlbumSet]);

  // ── Load full album photos (called when album tab is opened) ──────────────
  const loadAlbum = useCallback(async () => {
    try {
      const { data } = await api.get(`/album/${eventId}/photos`);
      if (!mountedRef.current) return;
      setAlbumPhotos(data);
      const next = new Set<string>((data as any[]).map((p: any) => p.id));
      updateAlbumSet(next);
    } catch {}
  }, [eventId, updateAlbumSet]);

  // ── Main refresh — stable, runs ONCE on mount ─────────────────────────────
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const [, , , eventRes] = await Promise.all([
        api.get('/auth/me').then(r => {
          if (mountedRef.current) {
            featureAlbumRef.current = !!r.data.featureAlbum;
            setFeatureAlbum(!!r.data.featureAlbum);
          }
        }).catch(() => {}),
        loadFavourites(),
        loadAlbumIds(),
        api.get(`/events/${eventId}/photos`),
      ]);
      if (mountedRef.current) {
        setEvent(eventRes.data.event);
        setPhotos(eventRes.data.photos ?? []);
      }
    } catch (e) {
      console.error('[ClientEventProvider] load error', e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [eventId, loadFavourites, loadAlbumIds]); // stable: eventId is a string from URL

  // Mount-only effect — refresh exactly once
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally [] — eventId doesn't change while this provider is mounted

  // 10s sync — matches web's syncFavorites interval
  useEffect(() => {
    const timer = setInterval(loadFavourites, 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally [] — loadFavourites captures eventId from closure

  // ── Toggle favourite — reads from REF to avoid dep on favSet state ────────
  const toggleFav = useCallback(async (photoId: string) => {
    const isFav = favSetRef.current.has(photoId);
    pendingRef.current.add(photoId);
    // Optimistic update
    const optimistic = new Set(favSetRef.current);
    if (isFav) optimistic.delete(photoId); else optimistic.add(photoId);
    updateFavSet(optimistic);
    try {
      if (isFav) await api.delete(`/favorites/${eventId}/${photoId}`);
      else await api.post(`/favorites/${eventId}/${photoId}`);
    } catch {
      // Rollback
      const rollback = new Set(favSetRef.current);
      if (isFav) rollback.add(photoId); else rollback.delete(photoId);
      updateFavSet(rollback);
    } finally {
      pendingRef.current.delete(photoId);
    }
  }, [eventId, updateFavSet]); // no `favSet` dep → never recreated on heart tap

  // ── Toggle album — reads from REF ────────────────────────────────────────
  const toggleAlbum = useCallback(async (photoId: string) => {
    if (!featureAlbumRef.current) return;
    const inAlbum = albumSetRef.current.has(photoId);
    const optimistic = new Set(albumSetRef.current);
    if (inAlbum) optimistic.delete(photoId); else optimistic.add(photoId);
    updateAlbumSet(optimistic);
    try {
      if (inAlbum) await api.delete(`/album/${eventId}/${photoId}`);
      else await api.post(`/album/${eventId}/${photoId}`);
    } catch {
      const rollback = new Set(albumSetRef.current);
      if (inAlbum) rollback.add(photoId); else rollback.delete(photoId);
      updateAlbumSet(rollback);
    }
  }, [eventId, updateAlbumSet]); // no `albumSet` dep

  return (
    <ClientEventContext.Provider value={{
      event, photos, favSet, albumSet, albumPhotos,
      featureAlbum, loading,
      toggleFav, toggleAlbum, loadAlbum, refresh,
    }}>
      {children}
    </ClientEventContext.Provider>
  );
}
