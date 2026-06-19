import React, { useEffect, useCallback, useState, useRef } from 'react';
import { AppState, Text, View, Image, useWindowDimensions } from 'react-native';
import { Tabs, Stack, router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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

function TabLabel({ text, color }: { text: string; color: string }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={{
        color,
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
        width: '100%',
      }}
    >
      {text}
    </Text>
  );
}

export default function RootLayout() {
  const { width: screenWidth } = useWindowDimensions();
  const pathname = usePathname();
  const prevPathnameRef = useRef<string | null>(null);
  const [segment, setSegment] = useState<DaySegment>(getCurrentSegment);
  const [showDecorations, setShowDecorations] = useState(false);
  const tabBarHorizontalInset = Math.round(screenWidth * 0.05);

  // Re-evaluate segment when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setSegment(getCurrentSegment());
    });
    return () => sub.remove();
  }, []);

  // Show moon/sun with 1 second delay when entering routines tab
  useEffect(() => {
    const wasNotHome = prevPathnameRef.current !== null && prevPathnameRef.current !== '/';
    const isNowHome = pathname === '/';
    
    if (isNowHome && (wasNotHome || prevPathnameRef.current === null)) {
      setShowDecorations(false);
      const timer = setTimeout(() => setShowDecorations(true), 200);
      prevPathnameRef.current = pathname;
      return () => clearTimeout(timer);
    } else if (isNowHome && prevPathnameRef.current === '/') {
      return;
    } else {
      setShowDecorations(false);
      prevPathnameRef.current = pathname;
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
        router.push('/' as never);
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

    const responseListener = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

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
      {/* Moon/Sun decoration - positioned between header and content - only on routines tab */}
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

      {pathname === '/loading' || pathname.startsWith('/onboarding') ? (
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
        </Stack>
      ) : (
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: '#4A90D9' },
            headerTintColor: '#FFF',
            headerTitleStyle: { fontWeight: '700', fontSize: 18 },
            tabBarStyle: {
              position: 'absolute',
              marginHorizontal: tabBarHorizontalInset,
              bottom: 34,
              height: 66,
              borderRadius: 20,
              backgroundColor: '#FFFFFF',
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.12,
              shadowRadius: 10,
              elevation: 10,
            },
            tabBarShowLabel: true,
            tabBarLabelPosition: 'below-icon',
            tabBarItemStyle: { flex: 1, paddingVertical: 6, justifyContent: 'center' },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '700',
              textAlign: 'center',
            },
            tabBarIconStyle: { marginBottom: 2 },
            tabBarActiveTintColor: '#4A90D9',
            tabBarInactiveTintColor: '#CBD5E1',
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              headerTitle: () => <HeaderTitle segment={segment} />,
              title: 'Routines',
              tabBarLabel: ({ color }) => <TabLabel text="Routines" color={color} />,
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="rewards"
            options={{
              title: 'Rewards',
            tabBarLabel: ({ color }) => <TabLabel text="Rewards" color={color} />,
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="star" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
            tabBarLabel: ({ color }) => <TabLabel text="Settings" color={color} />,
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="cog" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen name="loading" options={{ href: null }} />
          <Tabs.Screen name="onboarding" options={{ href: null }} />
          <Tabs.Screen name="parent/create" options={{ href: null }} />
          <Tabs.Screen name="routine/[id]" options={{ href: null }} />
        </Tabs>
      )}
    </GestureHandlerRootView>
  );
}
