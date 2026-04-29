/**
 * useClientEvent — Manages all state for a client's event view
 * Mirrors public/client/script.js:
 *   - openEvent(), loadFavorites(), syncFavorites(), toggleFav()
 *   - loadCliAlbumIds(), loadCliAlbum(), toggleCliAlbum(), syncCliAlbum()
 *   - refreshCliUserFlags()
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import api from '../services/api';

export interface Photo {
  id: string;
  rustfs_object_id: string;
  thumbUrl: string;
  fullUrl: string;
  has_faces: boolean;
}

export interface ClientEvent {
  id: string;
  name: string;
  bucket_name: string;
}

export function useClientEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<ClientEvent | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [albumSet, setAlbumSet] = useState<Set<string>>(new Set());
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [featureAlbum, setFeatureAlbum] = useState(false);
  const [loading, setLoading] = useState(true);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Refresh premium flags (mirrors refreshCliUserFlags) ───────────────────
  const refreshFlags = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setFeatureAlbum(!!data.featureAlbum);
    } catch {}
  }, []);

  // ── Load favourites ───────────────────────────────────────────────────────
  const loadFavourites = useCallback(async (evtId: string) => {
    try {
      const { data } = await api.get(`/favorites/${evtId}`);
      setFavSet(new Set((data as any[]).map((f: any) => f.photo_id)));
    } catch {}
  }, []);

  // ── Load album IDs ────────────────────────────────────────────────────────
  const loadAlbumIds = useCallback(async (evtId: string) => {
    try {
      const { data } = await api.get(`/album/${evtId}`);
      setAlbumSet(new Set((data as any[]).map((r: any) => r.photo_id)));
    } catch {}
  }, []);

  // ── Sync favourites (10s poll — mirrors syncFavorites) ───────────────────
  const syncFavourites = useCallback(async (evtId: string) => {
    try {
      const { data } = await api.get(`/favorites/${evtId}`);
      const newSet = new Set((data as any[]).map((f: any) => f.photo_id));
      setFavSet(newSet);
    } catch {}
  }, []);

  // ── Load full album photos ────────────────────────────────────────────────
  const loadAlbum = useCallback(async (evtId: string) => {
    try {
      const { data } = await api.get(`/album/${evtId}/photos`);
      setAlbumPhotos(data);
      setAlbumSet(new Set((data as any[]).map((p: any) => p.id)));
    } catch {}
  }, []);

  // ── Initial load (mirrors openEvent) ─────────────────────────────────────
  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      await refreshFlags();
      const [eventRes] = await Promise.all([
        api.get(`/events/${eventId}/photos`),
        loadFavourites(eventId),
        loadAlbumIds(eventId),
      ]);
      setEvent(eventRes.data.event);
      setPhotos(eventRes.data.photos ?? []);
    } catch (e) {
      console.error('Client event load error', e);
    } finally {
      setLoading(false);
    }
  }, [eventId, refreshFlags, loadFavourites, loadAlbumIds]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 10s sync interval (mirrors setInterval in openEvent) ─────────────────
  useEffect(() => {
    if (!eventId) return;
    syncRef.current = setInterval(() => {
      syncFavourites(eventId);
    }, 10_000);
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [eventId, syncFavourites]);

  // ── Toggle favourite (mirrors toggleFav) ─────────────────────────────────
  const toggleFav = useCallback(async (photoId: string) => {
    if (!eventId) return;
    const isFav = favSet.has(photoId);
    // Optimistic update
    setFavSet(prev => {
      const next = new Set(prev);
      if (isFav) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    try {
      if (isFav) {
        await api.delete(`/favorites/${eventId}/${photoId}`);
      } else {
        await api.post(`/favorites/${eventId}/${photoId}`);
      }
    } catch {
      // Rollback optimistic update
      setFavSet(prev => {
        const next = new Set(prev);
        if (isFav) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
    }
  }, [eventId, favSet]);

  // ── Toggle album photo (mirrors toggleCliAlbum) ───────────────────────────
  const toggleAlbum = useCallback(async (photoId: string) => {
    if (!eventId || !featureAlbum) return;
    const inAlbum = albumSet.has(photoId);
    setAlbumSet(prev => {
      const next = new Set(prev);
      if (inAlbum) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
    try {
      if (inAlbum) {
        await api.delete(`/album/${eventId}/${photoId}`);
      } else {
        await api.post(`/album/${eventId}/${photoId}`);
      }
    } catch {
      setAlbumSet(prev => {
        const next = new Set(prev);
        if (inAlbum) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
    }
  }, [eventId, albumSet, featureAlbum]);

  return {
    event, photos, favSet, albumSet, albumPhotos,
    featureAlbum, loading,
    load, loadAlbum, toggleFav, toggleAlbum,
  };
}
