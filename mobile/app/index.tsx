/**
 * Home Screen — EventSnapAI
 *
 * Three entry points beautifully presented:
 *   1. Scan QR Code  → Visitor flow (anonymous)
 *   2. Client Login  → Client event portal
 *   3. Manager Login → Manager dashboard
 *
 * Design: Dark premium aesthetic matching RaidCloud web portal.
 * Animated title, gradient cards, subtle particle/glow effects.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
  AppState,
} from 'react-native';
import { router, useNavigation } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useAuth } from '../hooks/useAuth';
import { Colors, Gradients } from '../constants/colors';
import { Typography, Spacing, Radius } from '../constants/typography';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Icons (inline SVG-style using View outlines for zero native deps) ─────────
// Replaced with text emojis during development, swap for react-native-svg icons
const ICONS = {
  qr:      '▦',
  client:  '◐',
  manager: '⬡',
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, member, isLoading } = useAuth();

  // Animations
  const logoScale    = useRef(new Animated.Value(0)).current;
  const logoOpacity  = useRef(new Animated.Value(0)).current;
  const titleY       = useRef(new Animated.Value(30)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const cardsY       = useRef(new Animated.Value(50)).current;
  const cardsOpacity = useRef(new Animated.Value(0)).current;
  const glowAnim     = useRef(new Animated.Value(0)).current;

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading) {
      if (user?.role === 'manager' || user?.role === 'admin') {
        router.replace('/(manager)/');
      } else if (user?.role === 'user') {
        router.replace('/(client)/');
      } else if (member) {
        router.replace(`/(collab)/${member.eventId}`);
      }
    }
  }, [user, member, isLoading]);

  // Entrance animation sequence
  useEffect(() => {
    if (isLoading) return;

    Animated.sequence([
      // 1. Logo pop in
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 60,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      // 2. Title slides up
      Animated.parallel([
        Animated.timing(titleY, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
      ]),
      // 3. Cards appear
      Animated.parallel([
        Animated.spring(cardsY, {
          toValue: 0,
          tension: 50,
          friction: 9,
          useNativeDriver: true,
        }),
        Animated.timing(cardsOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Pulsing glow on accent
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, [isLoading]);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.04, 0.12],
  });

  const handlePress = useCallback((target: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(target as any);
  }, []);

  if (isLoading) return null;

  return (
    <View style={styles.container}>
      {/* Background gradient */}
      <LinearGradient
        colors={['#0A0F1E', '#0D1525', '#090D1A']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Ambient glow behind logo */}
      <Animated.View
        style={[
          styles.ambientGlow,
          { opacity: glowOpacity },
        ]}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Logo & Branding ──────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.logoContainer,
            { transform: [{ scale: logoScale }], opacity: logoOpacity },
          ]}
        >
          <LinearGradient
            colors={[Colors.bgSurface2, Colors.bgSurface]}
            style={styles.logoCircle}
          >
            <View style={styles.logoInner}>
              <Text style={styles.logoRaid}>R</Text>
            </View>
          </LinearGradient>

          {/* Accent ring */}
          <View style={styles.logoRing} />
        </Animated.View>

        {/* ── Title ────────────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.titleContainer,
            {
              transform: [{ translateY: titleY }],
              opacity: titleOpacity,
            },
          ]}
        >
          <Text style={styles.appName}>EventSnapAI</Text>
          <Text style={styles.tagline}>Your moments, found instantly</Text>
          <View style={styles.poweredBadge}>
            <Text style={styles.poweredText}>Powered by </Text>
            <Text style={styles.raidText}>RaidCloud</Text>
          </View>
        </Animated.View>

        {/* ── Action Cards ──────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.cardsContainer,
            {
              transform: [{ translateY: cardsY }],
              opacity: cardsOpacity,
            },
          ]}
        >
          {/* ── QR Scan Card ── */}
          <ActionCard
            icon="⊞"
            title="Scan QR Code"
            subtitle="Find your photos instantly"
            accentColor={Colors.accent}
            isPrimary
            onPress={() => handlePress('/(visitor)/scan')}
          />

          {/* ── Divider ── */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or sign in</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Client Login Card ── */}
          <ActionCard
            icon="⬡"
            title="Client Login"
            subtitle="View your event photos & favourites"
            accentColor="#8B5CF6"
            onPress={() => handlePress('/(auth)/login?role=client')}
          />

          {/* ── Manager Login Card ── */}
          <ActionCard
            icon="◈"
            title="Manager Login"
            subtitle="Upload, manage & curate events"
            accentColor={Colors.accent}
            onPress={() => handlePress('/(auth)/login?role=manager')}
          />
        </Animated.View>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <Animated.View style={[styles.footer, { opacity: cardsOpacity }]}>
          <Text style={styles.footerText}>
            © 2026 RaidCloud · EventSnapAI
          </Text>
          <Text style={styles.footerSub}>
            v1.2.7 · delivery.raidcloud.in
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ── Action Card Component ─────────────────────────────────────────────────────
interface ActionCardProps {
  icon: string;
  title: string;
  subtitle: string;
  accentColor: string;
  isPrimary?: boolean;
  onPress: () => void;
}

function ActionCard({ icon, title, subtitle, accentColor, isPrimary, onPress }: ActionCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        {isPrimary ? (
          // Primary card — full gradient accent
          <LinearGradient
            colors={['#1a3a52', '#0e2233', '#0A1828']}
            style={[styles.card, styles.cardPrimary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <CardContent icon={icon} title={title} subtitle={subtitle} accentColor={accentColor} isPrimary />
          </LinearGradient>
        ) : (
          <LinearGradient
            colors={[Colors.bgSurface2, Colors.bgSurface]}
            style={styles.card}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <CardContent icon={icon} title={title} subtitle={subtitle} accentColor={accentColor} />
          </LinearGradient>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

function CardContent({
  icon, title, subtitle, accentColor, isPrimary,
}: {
  icon: string; title: string; subtitle: string; accentColor: string; isPrimary?: boolean;
}) {
  return (
    <View style={styles.cardContent}>
      <View style={[styles.iconContainer, { backgroundColor: `${accentColor}22` }]}>
        <Text style={[styles.cardIcon, { color: accentColor }]}>{icon}</Text>
      </View>
      <View style={styles.cardTextContainer}>
        <Text style={[styles.cardTitle, isPrimary && { color: Colors.accent }]}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.cardArrow, { borderColor: `${accentColor}40` }]}>
        <Text style={[styles.cardArrowText, { color: accentColor }]}>›</Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
  },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  ambientGlow: {
    position: 'absolute',
    top: '10%',
    left: '25%',
    right: '25%',
    height: SCREEN_H * 0.3,
    backgroundColor: Colors.accent,
    borderRadius: 1000,
    // Creates soft glow in the upper center
    transform: [{ scaleX: 3 }, { scaleY: 0.4 }],
  },

  // Logo
  logoContainer: {
    width: 96,
    height: 96,
    marginBottom: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRaid: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.accent,
    fontFamily: 'Inter_800ExtraBold',
  },
  logoRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5,
    borderColor: Colors.accentBorder,
  },

  // Title
  titleContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  appName: {
    ...Typography.display,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  tagline: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  poweredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgSurface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  poweredText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  raidText: {
    ...Typography.caption,
    color: Colors.accent,
    fontFamily: 'Inter_600SemiBold',
  },

  // Cards
  cardsContainer: {
    width: '100%',
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardPrimary: {
    borderColor: Colors.accentBorder,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIcon: {
    fontSize: 22,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    ...Typography.h3,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  cardSubtitle: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  cardArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardArrowText: {
    fontSize: 20,
    lineHeight: 28,
    marginTop: -2,
  },

  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: Spacing.xxxl,
    gap: Spacing.xs,
  },
  footerText: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  footerSub: {
    fontSize: 10,
    color: Colors.textMuted,
    opacity: 0.6,
  },
});
