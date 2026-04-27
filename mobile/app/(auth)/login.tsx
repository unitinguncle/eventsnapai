/**
 * Login Screen — Shared for Manager and Client roles
 * Role is pre-seeded from ?role= query param from Home screen
 * After /auth/me returns, routes to correct dashboard
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useAuth } from '../../hooks/useAuth';
import { Colors } from '../../constants/colors';
import { Typography, Spacing, Radius } from '../../constants/typography';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { role } = useLocalSearchParams<{ role: 'manager' | 'client' }>();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const passwordRef = useRef<TextInput>(null);
  const shakeAnim   = useRef(new Animated.Value(0)).current;

  const isManager = role !== 'client';
  const accentColor = isManager ? Colors.accent : '#8B5CF6';
  const roleLabel   = isManager ? 'Manager' : 'Client';

  const shakeForm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      shakeForm();
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const user = await login(username.trim().toLowerCase(), password);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (user.role === 'manager' || user.role === 'admin') {
        router.replace('/(manager)/');
      } else {
        router.replace('/(client)/');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Login failed. Please check your credentials.';
      setError(msg);
      shakeForm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient
        colors={['#0A0F1E', '#0D1525']}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.roleBadge, { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}44` }]}>
            <Text style={[styles.roleBadgeText, { color: accentColor }]}>{roleLabel}</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to your {roleLabel.toLowerCase()} account to continue
          </Text>
        </View>

        {/* Form */}
        <Animated.View
          style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}
        >
          {/* Username field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Username</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter username"
                placeholderTextColor={Colors.textMuted}
                value={username}
                onChangeText={(t) => { setUsername(t); setError(''); }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isLoading}
              />
            </View>
          </View>

          {/* Password field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={passwordRef}
                style={[styles.input, { paddingRight: 52 }]}
                placeholder="Enter password"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(''); }}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                editable={!isLoading}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(s => !s)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Error */}
          {!!error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>⚠ {error}</Text>
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={isManager ? ['#4CAFE3', '#2980B9'] : ['#8B5CF6', '#6D28D9']}
              style={[styles.submitBtn, isLoading && { opacity: 0.7 }]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Sign In</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Switch role hint */}
          <TouchableOpacity
            style={styles.switchRoleBtn}
            onPress={() => {
              const nextRole = isManager ? 'client' : 'manager';
              router.replace(`/(auth)/login?role=${nextRole}` as any);
            }}
          >
            <Text style={styles.switchRoleText}>
              {isManager ? 'Are you a client? ' : 'Are you a manager? '}
              <Text style={[styles.switchRoleLink, { color: accentColor }]}>
                {isManager ? 'Client login →' : 'Manager login →'}
              </Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  scroll: { paddingHorizontal: Spacing.lg },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Spacing.xxxl,
  },
  backArrow: { fontSize: 22, color: Colors.textSecondary, marginTop: -2 },
  backText: { ...Typography.body, color: Colors.textSecondary },

  header: { marginBottom: Spacing.xxxl },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  roleBadgeText: { ...Typography.label },
  title: { ...Typography.h1, color: Colors.textPrimary, marginBottom: Spacing.sm },
  subtitle: { ...Typography.body, color: Colors.textSecondary },

  form: { gap: Spacing.lg },

  fieldGroup: { gap: Spacing.sm },
  fieldLabel: { ...Typography.label, color: Colors.textSecondary },
  inputWrapper: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
    color: Colors.textPrimary,
  },
  eyeBtn: {
    position: 'absolute',
    right: Spacing.md,
    padding: Spacing.sm,
  },
  eyeIcon: { fontSize: 16 },

  errorContainer: {
    backgroundColor: Colors.errorDim,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error + '40',
  },
  errorText: { ...Typography.body, color: Colors.error },

  submitBtn: {
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  submitText: { ...Typography.button, color: '#fff' },

  switchRoleBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  switchRoleText: { ...Typography.body, color: Colors.textMuted },
  switchRoleLink: { fontFamily: 'Inter_500Medium' },
});
