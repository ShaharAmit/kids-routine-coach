import React from 'react';
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1E2B39' },
        headerTintColor: '#FFF',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="welcome" options={{ title: 'Welcome', headerShown: false }} />
      <Stack.Screen
        name="questionnaire"
        options={{ title: 'Setup Questionnaire', headerShown: false }}
      />
    </Stack>
  );
}
