import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Image } from 'react-native';
import { useGlobalSearchParams } from 'expo-router';
import { Colors } from '../../../../constants/colors';
import { Typography, Spacing, Radius } from '../../../../constants/typography';
import { Ionicons } from '@expo/vector-icons';
import { useEventData } from '../../../../hooks/useEventData';
import * as Clipboard from 'expo-clipboard';

export default function QRTab() {
  const params = useGlobalSearchParams();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { event } = useEventData(eventId as string);

  // Use the exact domain from the website
  const shareUrl = `https://delivery.raidcloud.in/e/${eventId}`;
  
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`;

  const copyLink = async () => {
    await Clipboard.setStringAsync(shareUrl);
    alert('Link copied to clipboard!');
  };

  const shareNative = async () => {
    try {
      await Share.share({
        title: `${event?.name || 'Event'} — EventSnapAI`,
        message: `🎉 Visit the album and find key photos and your own photos!\n${event?.name || 'Event'} — RaidCloud EventSnapAI\n\n${shareUrl}`,
        url: shareUrl, // iOS uses this
      });
    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{event?.name || 'Loading event...'}</Text>
        <Text style={styles.subtitle}>Scan to join the event</Text>
        
        <View style={styles.qrContainer}>
          <Image source={{ uri: qrUrl }} style={styles.qrImage} />
        </View>

        <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">
          {shareUrl}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={copyLink}>
            <Ionicons name="copy-outline" size={20} color={Colors.textPrimary} />
            <Text style={styles.btnSecondaryText}>Copy Link</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.btnPrimary} onPress={shareNative}>
            <Ionicons name="share-social" size={20} color="#fff" />
            <Text style={styles.btnPrimaryText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgPrimary,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    ...Typography.h2,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },
  qrContainer: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: Radius.md,
    marginBottom: Spacing.xl,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  linkText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
    backgroundColor: Colors.bgSurface2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    width: '100%',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  btnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgSurface2,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  btnSecondaryText: {
    ...Typography.button,
    color: Colors.textPrimary,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  btnPrimaryText: {
    ...Typography.button,
    color: '#fff',
  },
});
