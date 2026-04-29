import { Tabs, router } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography, Spacing } from '../../../../constants/typography';

export default function EventDetailLayout() {
  const { id } = useLocalSearchParams();

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
        headerLeft: () => (
          <TouchableOpacity 
            onPress={() => router.replace('/(manager)')} 
            style={{ marginLeft: Spacing.md, padding: Spacing.xs }}
          >
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        ),
        tabBarStyle: {
          backgroundColor: Colors.bgSurface,
          borderTopColor: Colors.border,
          height: 65,
          paddingBottom: 10,
          paddingTop: 5,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        // When pressing the Android hardware back button, pop directly to dashboard without cycling tabs
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
