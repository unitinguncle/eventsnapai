import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useEvents, Event } from '../../hooks/useEvents';
import { router, Redirect } from 'expo-router';
import { Colors, Gradients } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export default function ManagerDashboard() {
  const { user, logout } = useAuth();
  const { events, loading, refreshing, fetchEvents, refreshEvents } = useEvents();
  useEffect(() => {
    if (user) {
      fetchEvents();
    }
  }, [user, fetchEvents]);

  if (!user) {
    return <Redirect href="/" />;
  }

  const handleLogout = async () => {
    try {
      await logout();
      // user becomes null, React re-renders, hits <Redirect> and unmounts cleanly
    } catch (e) {
      console.log('Logout error', e);
    }
  };

  const renderEventCard = ({ item }: { item: Event }) => {
    const date = new Date(item.created_at).toLocaleDateString();
    return (
      <TouchableOpacity 
        style={styles.cardContainer}
        onPress={() => router.push(`/(manager)/event/${item.id}`)}
      >
        <LinearGradient colors={Gradients.card} style={styles.cardGradient}>
          <View style={styles.cardHeader}>
            <Text style={styles.eventName}>{item.name}</Text>
            {item.is_collaborative && (
              <View style={styles.collabBadge}>
                <Text style={styles.collabText}>Collab</Text>
              </View>
            )}
          </View>
          <Text style={styles.eventMeta}>Created: {date}</Text>
          <Text style={styles.eventMeta}>Bucket: {item.bucket_name}</Text>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome,</Text>
          <Text style={styles.username}>{user?.username}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, gap: Spacing.md }}>
            <Text style={{ ...Typography.caption, color: Colors.textSecondary }}>v1.3.0</Text>
            <TouchableOpacity onPress={() => router.push('/(manager)/notifications')}>
              <Ionicons name="notifications-outline" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>Your Events</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/(manager)/create-event')}>
          <Text style={styles.createText}>+ New Event</Text>
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={renderEventCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshEvents}
              tintColor={Colors.accent}
              colors={[Colors.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No events found</Text>
              <Text style={styles.emptySub}>Create your first event to get started.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  greeting: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  username: {
    ...Typography.h3,
    color: Colors.textPrimary,
  },
  logoutBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.bgSurface2,
    borderRadius: Radius.full,
  },
  logoutText: {
    ...Typography.buttonSmall,
    color: Colors.error,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  title: {
    ...Typography.h2,
    color: Colors.textPrimary,
  },
  createBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  createText: {
    ...Typography.buttonSmall,
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  cardContainer: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardGradient: {
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  eventName: {
    ...Typography.h3,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  collabBadge: {
    backgroundColor: 'rgba(76,175,227,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accentBorder,
  },
  collabText: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: 'bold',
  },
  eventMeta: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    padding: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySub: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
