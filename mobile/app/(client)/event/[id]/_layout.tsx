/**
 * Client Event Layout — wraps all 4 tabs in ClientEventProvider
 *
 * AUTH: No <Redirect> here — (client)/index.tsx is already mounted in the stack
 * and handles the redirect when user becomes null. Having TWO simultaneous
 * <Redirect> calls causes "Maximum update depth exceeded".
 * This matches the pattern used by (manager)/event/[id]/_layout.tsx exactly.
 */
import React, { useCallback, useMemo } from 'react';
import { TouchableOpacity, Alert } from 'react-native';
import { Tabs, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../hooks/useAuth';
import { ClientEventProvider } from '../../../../contexts/ClientEventContext';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing } from '../../../../constants/typography';

// Stable components defined outside layout to prevent re-creation
function HeaderLeft() {
  return (
    <TouchableOpacity
      onPress={() => router.replace('/(client)')}
      style={{ marginLeft: Spacing.md, padding: Spacing.xs }}
    >
      <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
    </TouchableOpacity>
  );
}

function HeaderRight({ onLogout }: { onLogout: () => void }) {
  return (
    <TouchableOpacity
      onPress={onLogout}
      style={{ marginRight: Spacing.md, padding: Spacing.xs }}
    >
      <Ionicons name="log-out-outline" size={22} color={Colors.error} />
    </TouchableOpacity>
  );
}

export default function ClientEventLayout() {
  // ALL hooks before any conditional returns
  const { user, logout } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Array.isArray(id) ? id[0] : id as string;

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/');
        },
      },
    ]);
  }, [logout]);

  // Stable memoized screenOptions — Tabs won't re-register on every render
  const screenOptions = useMemo(() => ({
    headerShown: true,
    headerStyle: {
      backgroundColor: Colors.bgPrimary,
      elevation: 0,
      shadowOpacity: 0,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    headerTitleStyle: { color: Colors.textPrimary, ...Typography.h3 },
    headerLeft: () => <HeaderLeft />,
    headerRight: () => <HeaderRight onLogout={handleLogout} />,
    tabBarStyle: {
      backgroundColor: Colors.bgSurface,
      borderTopColor: Colors.border,
      height: 65,
      paddingBottom: 10,
      paddingTop: 5,
    },
    tabBarActiveTintColor: Colors.accent,
    tabBarInactiveTintColor: Colors.textSecondary,
    unmountOnBlur: false as const,
  }), [handleLogout]);

  return (
    <ClientEventProvider eventId={eventId}>
      <Tabs screenOptions={screenOptions} backBehavior="none">
        <Tabs.Screen
          name="library"
          options={{
            title: 'Library',
            headerTitle: 'All Photos',
            tabBarIcon: ({ color, size }) => <Ionicons name="images" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="favourites"
          options={{
            title: 'Favourites',
            headerTitle: 'My Favourites',
            tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="album"
          options={{
            title: 'Album',
            headerTitle: 'Curated Album',
            tabBarIcon: ({ color, size }) => <Ionicons name="albums" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="share"
          options={{
            title: 'Share',
            headerTitle: 'Share & Find Me',
            tabBarIcon: ({ color, size }) => <Ionicons name="share-social" size={size} color={color} />,
          }}
        />
      </Tabs>
    </ClientEventProvider>
  );
}
