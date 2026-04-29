/**
 * Member Login Screen — Collab event member authentication
 * Calls POST /auth/member-login with username + password + eventId
 * eventId can be pre-filled from QR deep-link URL params
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

export default function MemberLoginScreen() {
  const { eventId: prefilledEventId } = useLocalSearchParams<{ eventId?: string }>();
  const { memberLogin } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [eventId, setEventId] = useState(prefilledEventId || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username || !password || !eventId) {
      setError('Username, password, and Event ID are all required.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await memberLogin(username.trim().toLowerCase(), password, eventId.trim());
      router.replace(`/(collab)/${eventId.trim()}`);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Back */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.roleTag}>📸 Collaborative Event</Text>
            <Text style={styles.title}>Member Login</Text>
            <Text style={styles.subtitle}>Sign in to view and upload photos for your event</Text>
          </View>

          {/* Error */}
          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Event ID (pre-filled or manual) */}
          <View style={styles.group}>
            <Text style={styles.label}>Event ID</Text>
            <TextInput
              style={[styles.input, !!prefilledEventId && styles.inputDisabled]}
              value={eventId}
              onChangeText={setEventId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Event UUID from QR code"
              placeholderTextColor={Colors.textSecondary}
              editable={!prefilledEventId}
            />
            {!!prefilledEventId && (
              <Text style={styles.hint}>Pre-filled from QR scan ✓</Text>
            )}
          </View>

          <View style={styles.group}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Your member username"
              placeholderTextColor={Colors.textSecondary}
              returnKeyType="next"
            />
          </View>

          <View style={styles.group}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Your password"
                placeholderTextColor={Colors.textSecondary}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(p => !p)}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, isLoading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In as Member</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  kav: { flex: 1 },
  scroll: { padding: Spacing.xl, paddingBottom: 80 },
  backBtn: { marginBottom: Spacing.xl, alignSelf: 'flex-start' },
  header: { marginBottom: Spacing.xxl },
  roleTag: {
    ...Typography.caption, color: Colors.accent,
    backgroundColor: Colors.accentDim, paddingHorizontal: Spacing.md,
    paddingVertical: 4, borderRadius: Radius.full,
    alignSelf: 'flex-start', marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.accentBorder,
  },
  title: { ...Typography.h1, color: Colors.textPrimary, marginBottom: Spacing.xs },
  subtitle: { ...Typography.body, color: Colors.textSecondary },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(244,67,54,0.1)',
    padding: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: 'rgba(244,67,54,0.3)',
    marginBottom: Spacing.lg,
  },
  errorText: { ...Typography.caption, color: Colors.error, flex: 1 },
  group: { marginBottom: Spacing.lg },
  label: { ...Typography.caption, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.bgSurface2, borderRadius: Radius.sm,
    padding: Spacing.md, color: Colors.textPrimary,
    borderWidth: 1, borderColor: Colors.border,
    ...Typography.body,
  },
  inputDisabled: { opacity: 0.6 },
  hint: { ...Typography.caption, color: Colors.success, marginTop: 4 },
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  eyeBtn: {
    position: 'absolute', right: 0,
    padding: Spacing.md, height: '100%',
    justifyContent: 'center',
  },
  loginBtn: {
    backgroundColor: Colors.accent, borderRadius: Radius.md,
    padding: Spacing.md + 2, alignItems: 'center', marginTop: Spacing.md,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { ...Typography.button, color: '#fff' },
});
