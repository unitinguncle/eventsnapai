/**
 * Client Event Context — Shared state across all 4 client event tabs.
 * Prevents white-flash on tab switch and duplicate API calls.
 * All tabs read from this single context instead of calling useClientEvent independently.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import api from '../../../../services/api';

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
  if (!ctx) throw new Error('useClientEventContext must be used inside ClientEventProvider');
  return ctx;
}

interface Props {
  eventId: string;
  children: ReactNode;
}

export function ClientEventProvider({ eventId, children }: Props) {
  const [event, setEvent] = useState<ClientEventData | null>(null);
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [albumSet, setAlbumSet] = useState<Set<string>>(new Set());
  const [albumPhotos, setAlbumPhotos] = useState<ClientPhoto[]>([]);
  const [featureAlbum, setFeatureAlbum] = useState(false);
  const [loading, setLoading] = useState(true);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Refresh premium flags ─────────────────────────────────────────────────
  const refreshFlags = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      if (mountedRef.current) setFeatureAlbum(!!data.featureAlbum);
    } catch {}
  }, []);

  // ── Load favourites ───────────────────────────────────────────────────────
  const loadFavourites = useCallback(async () => {
    try {
      const { data } = await api.get(`/favorites/${eventId}`);
      if (mountedRef.current)
        setFavSet(new Set((data as any[]).map((f: any) => f.photo_id)));
    } catch {}
  }, [eventId]);

  // ── Load album IDs ────────────────────────────────────────────────────────
  const loadAlbumIds = useCallback(async () => {
    try {
      const { data } = await api.get(`/album/${eventId}`);
      if (mountedRef.current)
        setAlbumSet(new Set((data as any[]).map((r: any) => r.photo_id)));
    } catch {}
  }, [eventId]);

  // ── Load full album photos ────────────────────────────────────────────────
  const loadAlbum = useCallback(async () => {
    try {
      const { data } = await api.get(`/album/${eventId}/photos`);
      if (mountedRef.current) {
        setAlbumPhotos(data);
        setAlbumSet(new Set((data as any[]).map((p: any) => p.id)));
      }
    } catch {}
  }, [eventId]);

  // ── Main fetch ────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      await refreshFlags();
      const [eventRes] = await Promise.all([
        api.get(`/events/${eventId}/photos`),
        loadFavourites(),
        loadAlbumIds(),
      ]);
      if (mountedRef.current) {
        setEvent(eventRes.data.event);
        setPhotos(eventRes.data.photos ?? []);
      }
    } catch (e) {
      console.error('ClientEventProvider load error', e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [eventId, refreshFlags, loadFavourites, loadAlbumIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── 10s sync interval (mirrors web's setInterval) ────────────────────────
  useEffect(() => {
    syncRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const { data } = await api.get(`/favorites/${eventId}`);
        const newSet = new Set((data as any[]).map((f: any) => f.photo_id));
        if (mountedRef.current) setFavSet(newSet);
      } catch {}
    }, 10_000);
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [eventId]);

  // ── Toggle favourite (optimistic update) ─────────────────────────────────
  const toggleFav = useCallback(async (photoId: string) => {
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
      // Rollback
      setFavSet(prev => {
        const next = new Set(prev);
        if (isFav) next.add(photoId); else next.delete(photoId);
        return next;
      });
    }
  }, [eventId, favSet]);

  // ── Toggle album photo ────────────────────────────────────────────────────
  const toggleAlbum = useCallback(async (photoId: string) => {
    if (!featureAlbum) return;
    const inAlbum = albumSet.has(photoId);
    setAlbumSet(prev => {
      const next = new Set(prev);
      if (inAlbum) next.delete(photoId); else next.add(photoId);
      return next;
    });
    try {
      if (inAlbum) await api.delete(`/album/${eventId}/${photoId}`);
      else await api.post(`/album/${eventId}/${photoId}`);
    } catch {
      setAlbumSet(prev => {
        const next = new Set(prev);
        if (inAlbum) next.add(photoId); else next.delete(photoId);
        return next;
      });
    }
  }, [eventId, albumSet, featureAlbum]);

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
