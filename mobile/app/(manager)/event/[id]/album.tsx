import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing } from '../../../../constants/typography';
import { Ionicons } from '@expo/vector-icons';

export default function AlbumTab() {
  return (
    <View style={styles.container}>
      <Ionicons name="albums-outline" size={64} color={Colors.textSecondary} />
      <Text style={styles.title}>Photo Album</Text>
      <Text style={styles.subtitle}>Premium feature coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  title: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
});
