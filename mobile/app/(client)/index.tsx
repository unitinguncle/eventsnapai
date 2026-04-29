/**
 * Client Dashboard — mirrors public/client/script.js loadEvents() + renderEvents()
 * Auto-opens the event if only 1 assigned, otherwise shows card grid.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import api from '../../services/api';
import { Colors, Gradients } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

interface ClientEvent {
  id: string;
  name: string;
  bucket_name: string;
  created_at: string;
}

export default function ClientDashboard() {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [events, setEvents] = useState<ClientEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const autoNavigated = useRef(false);

  if (!user) return <Redirect href="/" />;

  const fetchEvents = useCallback(async () => {
    try {
      const { data } = await api.get('/events/my');
      setEvents(data);
      // Auto-open if only 1 event (mirrors loadEvents behaviour)
      if (data.length === 1 && !autoNavigated.current) {
        autoNavigated.current = true;
        router.replace(`/(client)/event/${data[0].id}/library`);
      }
    } catch (e: any) {
      if (e?.response?.status !== 401) {
        Alert.alert('Error', 'Failed to load events');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleLogout = async () => {
    await logout();
    // <Redirect> triggered by user becoming null
  };

  const renderCard = ({ item }: { item: ClientEvent }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/(client)/event/${item.id}/library`)}
      activeOpacity={0.85}
    >
      <LinearGradient colors={Gradients.card} style={styles.cardGradient}>
        <View style={styles.cardTop}>
          <Ionicons name="images" size={20} color={Colors.accent} />
          <Text style={styles.eventName} numberOfLines={2}>{item.name}</Text>
        </View>
        <Text style={styles.eventMeta}>
          {item.bucket_name} · {new Date(item.created_at).toLocaleDateString()}
        </Text>
        <View style={styles.cardArrow}>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome,</Text>
          <Text style={styles.username}>{user.displayName || user.username}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/(manager)/notifications')}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.textSecondary} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>Your Events</Text>
        <Text style={styles.versionText}>v1.3.0</Text>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={item => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchEvents(); }}
              tintColor={Colors.accent}
              colors={[Colors.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="camera-outline" size={64} color={Colors.textSecondary} />
              <Text style={styles.emptyTitle}>No events assigned</Text>
              <Text style={styles.emptySub}>Contact your event manager to get access.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  greeting: { ...Typography.caption, color: Colors.textSecondary },
  username: { ...Typography.h3, color: Colors.textPrimary },
  bellBtn: { position: 'relative', padding: Spacing.xs },
  badge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: Colors.error, borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { ...Typography.caption, color: '#fff', fontSize: 10, fontWeight: 'bold' },
  logoutBtn: {
    backgroundColor: Colors.bgSurface2,
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: Radius.sm,
  },
  logoutText: { ...Typography.caption, color: Colors.textPrimary },
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  title: { ...Typography.h2, color: Colors.textPrimary },
  versionText: { ...Typography.caption, color: Colors.textSecondary },
  list: { padding: Spacing.xl, gap: Spacing.md },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  cardGradient: {
    padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.lg,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.sm },
  eventName: { ...Typography.h3, color: Colors.textPrimary, flex: 1 },
  eventMeta: { ...Typography.caption, color: Colors.textSecondary },
  cardArrow: { position: 'absolute', right: Spacing.lg, top: '50%' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { ...Typography.h3, color: Colors.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
});
