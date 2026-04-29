/**
 * Client Event Layout — 4-tab navigator
 * Tabs: Library | Favourites | Album | Share
 */
import React from 'react';
import { Tabs, router } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing } from '../../../../constants/typography';

export default function ClientEventLayout() {
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
            onPress={() => router.replace('/(client)')}
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
        unmountOnBlur: false,
      }}
      backBehavior="none"
    >
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          headerTitle: 'Photos',
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
          headerTitle: 'Share Event',
          tabBarIcon: ({ color, size }) => <Ionicons name="share-social" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
