import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';

import { AuthProvider } from '../hooks/useAuth';
import { Colors } from '../constants/colors';

// Keep splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Configure how push notifications are presented when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.bgPrimary }}>
      <AuthProvider>
        <StatusBar style="light" backgroundColor={Colors.bgPrimary} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.bgPrimary },
            animation: 'fade',
          }}
        >
          {/* Splash / Home */}
          <Stack.Screen name="index" options={{ animation: 'none' }} />

          {/* Auth flows */}
          <Stack.Screen name="(auth)/login" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="(auth)/member-login" options={{ animation: 'slide_from_bottom' }} />

          {/* Visitor flow */}
          <Stack.Screen name="(visitor)/scan" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(visitor)/selfie" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(visitor)/searching" options={{ animation: 'fade' }} />
          <Stack.Screen name="(visitor)/results" options={{ animation: 'fade' }} />

          {/* Manager & Client flow (Coming in Phase 2) */}
          <Stack.Screen name="(manager)/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(manager)/event/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(client)/index" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(client)/event/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(collab)/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
