import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useUserRoutines } from '../hooks/useRoutine';
import RoutineCard from '../components/RoutineCard';

// Hardcoded demo userId — replace with Firebase Auth uid in production
const DEMO_USER_ID = 'parent_uid_123';

export default function HomeScreen() {
  const { routines, loading, error } = useUserRoutines(DEMO_USER_ID);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4A90D9" />
        <Text style={styles.loadingText}>Loading routines…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>⚠️ Failed to load routines.</Text>
        <Text style={styles.errorSub}>{error.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#4A90D9" />

      <View style={styles.heroBar}>
        <Text style={styles.heroTitle}>🌟 Good Morning!</Text>
        <Text style={styles.heroSub}>
          {routines.length === 0
            ? "No routines yet. Tap + to create one!"
            : `You have ${routines.length} routine${routines.length > 1 ? 's' : ''} scheduled.`}
        </Text>
      </View>

      <FlatList
        data={routines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RoutineCard routine={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>No routines yet!</Text>
            <Text style={styles.emptySub}>
              Tap the + button below to create your first morning routine.
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/parent/create')}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E53935',
    marginBottom: 8,
  },
  errorSub: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  heroBar: {
    backgroundColor: '#4A90D9',
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 4,
  },
  heroSub: {
    fontSize: 15,
    color: '#D0E8FF',
  },
  listContent: {
    paddingVertical: 12,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: {
    fontSize: 32,
    color: '#FFF',
    lineHeight: 36,
    fontWeight: '300',
  },
});
