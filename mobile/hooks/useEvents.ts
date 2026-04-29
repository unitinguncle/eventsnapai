import { useState, useCallback } from 'react';
import api from '../services/api';

export interface Event {
  id: string;
  name: string;
  bucket_name: string;
  is_collaborative: boolean;
  created_at: string;
  jpeg_quality: number;
}

export function useEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/events/my');
      setEvents(res.data);
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshEvents = useCallback(() => {
    setRefreshing(true);
    fetchEvents();
  }, [fetchEvents]);

  const createEvent = async (name: string, bucketName: string, isCollaborative: boolean) => {
    try {
      const res = await api.post('/events', { name, bucketName, isCollaborative });
      setEvents(prev => [res.data, ...prev]);
      return res.data;
    } catch (err: any) {
      throw new Error(err?.response?.data?.error || 'Failed to create event');
    }
  };

  return { events, loading, refreshing, error, fetchEvents, refreshEvents, createEvent };
}
