/**
 * Push Notification Service
 * Mirrors Phase 0 / Phase 5 plan:
 *   - Register device Expo push token after login
 *   - Save to server via PATCH /users/me/push-token
 *   - Clear on logout via DELETE /users/me/push-token
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import api from './api';

/**
 * Request permission and get Expo push token.
 * Must only be called on a physical device — will silently fail on emulator.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[push] Skipping push registration — emulator/simulator detected');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[push] Push notification permission denied');
    return null;
  }

  // Expo push token
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'f7d12345-abcd-4567-efgh-ijklmnopqrst', // Replace with your EAS project ID from app.json
  });
  const token = tokenData.data;

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAFE3',
    });
  }

  return token;
}

/**
 * Store the push token on the server.
 * Called immediately after login and on app launch if token changes.
 */
export async function savePushToken(token: string): Promise<void> {
  try {
    await api.patch('/users/me/push-token', { pushToken: token });
    console.log('[push] Token registered on server');
  } catch (e: any) {
    console.warn('[push] Failed to save push token:', e?.message);
  }
}

/**
 * Clear the push token on the server.
 * Called during logout so this device stops receiving notifications.
 */
export async function clearPushToken(): Promise<void> {
  try {
    await api.delete('/users/me/push-token');
    console.log('[push] Token cleared from server');
  } catch (e: any) {
    console.warn('[push] Failed to clear push token:', e?.message);
  }
}
