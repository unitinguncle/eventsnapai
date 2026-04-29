/**
 * Client Event Layout — 4-tab navigator wrapped in ClientEventProvider context
 * The Provider fetches data ONCE and shares it across all tabs (no white flash, no duplicate calls)
 */
import React from 'react';
import { TouchableOpacity, Alert } from 'react-native';
import { Tabs, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../../hooks/useAuth';
import { ClientEventProvider } from '../../../../contexts/ClientEventContext';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing } from '../../../../constants/typography';

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

function HeaderRight() {
  const { logout } = useAuth();
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => { await logout(); },
      },
    ]);
  };
  return (
    <TouchableOpacity
      onPress={handleLogout}
      style={{ marginRight: Spacing.md, padding: Spacing.xs }}
    >
      <Ionicons name="log-out-outline" size={22} color={Colors.error} />
    </TouchableOpacity>
  );
}

export default function ClientEventLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Array.isArray(id) ? id[0] : id as string;

  return (
    <ClientEventProvider eventId={eventId}>
      <Tabs
        screenOptions={{
          headerShown: true,
          headerStyle: {
            backgroundColor: Colors.bgPrimary,
            elevation: 0,
            shadowOpacity: 0,
            borderBottomWidth: 1,
            borderBottomColor: Colors.border,
          },
          headerTitleStyle: {
            color: Colors.textPrimary,
            ...Typography.h3,
          },
          headerLeft: () => <HeaderLeft />,
          headerRight: () => <HeaderRight />,
          tabBarStyle: {
            backgroundColor: Colors.bgSurface,
            borderTopColor: Colors.border,
            height: 65,
            paddingBottom: 10,
            paddingTop: 5,
          },
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.textSecondary,
          // KEY: unmountOnBlur=false so tabs keep their scroll position
          unmountOnBlur: false,
        }}
        backBehavior="none"
      >
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
