import { useState, useCallback, useEffect } from 'react';
import api from '../services/api';

export interface EventDetail {
  id: string;
  name: string;
  bucket_name: string;
  is_collaborative: boolean;
  jpeg_quality: number | null;
}

export interface Photo {
  id: string;
  rustfs_object_id: string;
  thumbUrl: string;
  has_faces: boolean;
}

export function useEventData(eventId: string) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEventData = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const { data } = await api.get(`/events/${eventId}/photos`);
      setEvent(data.event);
      setPhotos(data.photos || []);
    } catch (err: any) {
      console.error('Failed to fetch event data:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to load event data');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEventData();
  }, [fetchEventData]);

  const setJpegQuality = async (quality: number | null) => {
    try {
      await api.patch(`/events/${eventId}/quality`, { quality });
      setEvent(prev => prev ? { ...prev, jpeg_quality: quality } : prev);
      return true;
    } catch (err: any) {
      throw new Error(err?.response?.data?.error || 'Failed to update quality');
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      await api.delete(`/events/${eventId}/photos/${photoId}`);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (err: any) {
      throw new Error(err?.response?.data?.error || 'Failed to delete photo');
    }
  };

  return { event, photos, loading, error, fetchEventData, setJpegQuality, deletePhoto };
}
