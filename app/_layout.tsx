import React, { useEffect, useCallback, useState } from 'react';
import { AppState, Text, View, Image } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { clearDebugHomeAccess, hasDebugHomeAccess } from '../services/debugFlow';
import { getCurrentSegment, segmentToTitle, segmentToSubtitle, type DaySegment } from '../utils/timeOfDay';

function HeaderTitle({ segment }: { segment: DaySegment }) {
  return (
    <View>
      <Text style={{ fontWeight: '700', fontSize: 18, color: '#FFF' }}>
        {segmentToTitle(segment)}
      </Text>
      <Text style={{ fontSize: 12, color: '#E8F0F7', marginTop: 2, textAlign: 'center' }}>
        {segmentToSubtitle(segment)}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const pathname = usePathname();
  const [segment, setSegment] = useState<DaySegment>(getCurrentSegment);
  const [showDecorations, setShowDecorations] = useState(false);

  // Re-evaluate segment when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setSegment(getCurrentSegment());
    });
    return () => sub.remove();
  }, []);

  // Show moon/sun with 1 second delay when entering home screen
  useEffect(() => {
    if (pathname === '/') {
      setShowDecorations(false);
      const timer = setTimeout(() => setShowDecorations(true), 1000);
      return () => clearTimeout(timer);
    } else {
      setShowDecorations(false);
    }
  }, [pathname]);

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
      {/* Moon/Sun decoration - positioned between header and content - only on home screen */}
      {pathname === '/' && showDecorations && (
        <View style={{ position: 'absolute', right: 16, top: 80, zIndex: 50, pointerEvents: 'none' }}>
          {segment === 'evening' ? (
            <Image
              source={require('../assets/images/moon.png')}
              style={{ width: 90, height: 90 }}
              resizeMode="contain"
            />
          ) : (
            <Image
              source={require('../assets/images/sun.png')}
              style={{ width: 90, height: 90 }}
              resizeMode="contain"
            />
          )}
        </View>
      )}

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
        <Stack.Screen name="index" options={{ headerTitle: () => <HeaderTitle segment={segment} /> }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="parent/create" options={{ title: 'Create Routine' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
