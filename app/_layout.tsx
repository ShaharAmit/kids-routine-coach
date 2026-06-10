import React, { useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { clearDebugHomeAccess, hasDebugHomeAccess } from '../services/debugFlow';

export default function RootLayout() {
  const pathname = usePathname();

  // Handle notification tap when app is open or in background
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as {
        routineId?: string;
        url?: string;
      };

      if (data?.routineId) {
        // Deep-link to the unified daily dashboard
        router.push('/');
      }
    },
    []
  );

  useEffect(() => {
    const enforceDebugLaunchRouting = () => {
      const alreadyInOnboarding = pathname.startsWith('/onboarding');
      const alreadyInLoading = pathname === '/loading';
      if (!hasDebugHomeAccess() && !alreadyInOnboarding && !alreadyInLoading) {
        router.replace('/onboarding/welcome' as never);
      }
    };

    enforceDebugLaunchRouting();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        enforceDebugLaunchRouting();
        return;
      }

      if (state === 'inactive' || state === 'background') {
        clearDebugHomeAccess();
      }
    });

    // Listener for taps while app is running
    const responseListener = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

    // Handle the notification that launched the app from a closed state
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    return () => {
      appStateSub.remove();
      responseListener.remove();
    };
  }, [handleNotificationResponse, pathname]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        initialRouteName="loading"
        screenOptions={{
          headerStyle: { backgroundColor: '#4A90D9' },
          headerTintColor: '#FFF',
          headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        }}
      >
        <Stack.Screen name="loading" options={{ title: 'Loading', headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: 'Kids Routine Coach' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="parent/create" options={{ title: 'Create Routine' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
