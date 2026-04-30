import React, { useCallback } from 'react';
import { Tabs, router, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography, Spacing } from '../../../../constants/typography';
import { useAuth } from '../../../../hooks/useAuth';

// Stable header components — defined outside to prevent re-creation on every render
function HeaderLeft() {
  return (
    <TouchableOpacity
      onPress={() => router.replace('/(manager)')}
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

export default function EventDetailLayout() {
  const { id } = useLocalSearchParams();
  const { user, logout } = useAuth();

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: async () => {
        await logout();
        router.replace('/');
      }},
    ]);
  }, [logout]);

  return (
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
        unmountOnBlur: false,
      }}
      backBehavior="none"
    >
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          headerTitle: 'Event Library',
          tabBarIcon: ({ color, size }) => <Ionicons name="images" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: 'Upload',
          headerTitle: 'Upload Photos',
          tabBarIcon: ({ color, size }) => <Ionicons name="cloud-upload" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="album"
        options={{
          title: 'Album',
          headerTitle: 'Photo Album',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: 'QR Code',
          headerTitle: 'Share QR',
          tabBarIcon: ({ color, size }) => <Ionicons name="qr-code" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          headerTitle: 'Manage Clients',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
