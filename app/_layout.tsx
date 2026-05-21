import React, { useEffect, useCallback } from 'react';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { requestNotificationPermissions } from '../services/notifications';
import { ensureAuth } from '../services/firebase';

export default function RootLayout() {
  // Sign in anonymously + request permissions on first launch
  useEffect(() => {
    requestNotificationPermissions();
    ensureAuth().catch((err) =>
      console.warn('[RootLayout] Anonymous sign-in failed:', err)
    );
  }, []);

  // Handle notification tap when app is open or in background
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as {
        routineId?: string;
        url?: string;
      };

      if (data?.routineId) {
        // Deep-link directly to the active routine screen
        router.push(`/routine/${data.routineId}`);
      }
    },
    []
  );

  useEffect(() => {
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
      responseListener.remove();
    };
  }, [handleNotificationResponse]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#4A90D9' },
        headerTintColor: '#FFF',
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Kids Routine Coach' }} />
      <Stack.Screen name="routine/[id]" options={{ title: 'Active Routine', headerShown: false }} />
      <Stack.Screen name="parent/create" options={{ title: 'Create Routine' }} />
    </Stack>
  );
}
