/**
 * useNotifications — Shared hook for Manager and Client notification polling
 * Mirrors the pollCliNotifications / startCliNotifPolling pattern from client/script.js
 * 
 * - Polls every 30s (matching web)
 * - Returns unread count for badge
 * - Exposes mark read, pin, discard
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import api from '../services/api';

export interface Notification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  is_pinned: boolean;
  created_at: string;
  sender_name?: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        api.get('/notifications/my/unread-count'),
        api.get('/notifications/my'),
      ]);
      setUnreadCount(countRes.data?.count ?? 0);
      setNotifications(listRes.data ?? []);
    } catch {
      // Non-fatal — silently retry on next interval
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) { console.warn('markRead failed', e); }
  };

  const pin = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/pin`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_pinned: !n.is_pinned } : n));
    } catch (e) { console.warn('pin failed', e); }
  };

  const discard = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/discard`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e) { console.warn('discard failed', e); }
  };

  return { notifications, unreadCount, poll, markRead, pin, discard };
}
