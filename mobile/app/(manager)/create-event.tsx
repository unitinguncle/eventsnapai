import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';
import { useEvents } from '../../hooks/useEvents';

export default function CreateEventScreen() {
  const [name, setName] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [isCollaborative, setIsCollaborative] = useState(false);
  const [loading, setLoading] = useState(false);
  const { createEvent } = useEvents();

  const handleNameChange = (text: string) => {
    setName(text);
    // Auto-generate bucket name: lowercase, replace spaces with hyphens, remove non-alphanumeric
    if (!bucketName || bucketName === name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')) {
      const generated = text.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      setBucketName(generated);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return Alert.alert('Error', 'Event name is required');
    if (!bucketName.trim()) return Alert.alert('Error', 'Bucket name is required');
    if (!/^[a-z0-9-]+$/.test(bucketName)) {
      return Alert.alert('Error', 'Bucket name must be lowercase alphanumeric with hyphens only');
    }

    try {
      setLoading(true);
      await createEvent(name, bucketName, isCollaborative);
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Event</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Event Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Summer Wedding 2024"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={handleNameChange}
            editable={!loading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Bucket Name (System ID)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. summer-wedding-2024"
            placeholderTextColor={Colors.textMuted}
            value={bucketName}
            onChangeText={setBucketName}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <Text style={styles.helperText}>Used for storage. Lowercase, numbers, and hyphens only.</Text>
        </View>

        <View style={styles.switchGroup}>
          <View>
            <Text style={styles.label}>Collaborative Event</Text>
            <Text style={styles.helperText}>Allow guests to upload their own photos.</Text>
          </View>
          <Switch
            value={isCollaborative}
            onValueChange={setIsCollaborative}
            trackColor={{ false: Colors.bgSurface3, true: Colors.accent }}
            thumbColor={'#fff'}
            disabled={loading}
          />
        </View>

        <TouchableOpacity 
          style={[styles.createBtn, loading && styles.createBtnDisabled]} 
          onPress={handleCreate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Create Event</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.full,
  },
  backIcon: {
    color: Colors.textSecondary,
    fontSize: 20,
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
  },
  content: {
    padding: Spacing.xl,
  },
  inputGroup: {
    marginBottom: Spacing.xl,
  },
  label: {
    ...Typography.bodyMedium,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.bgSurface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.textPrimary,
    ...Typography.body,
  },
  helperText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 6,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.bgSurface2,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: Spacing.xxl,
  },
  createBtn: {
    backgroundColor: Colors.accent,
    padding: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  createBtnDisabled: {
    opacity: 0.7,
  },
  createBtnText: {
    ...Typography.button,
    color: '#fff',
  },
});
