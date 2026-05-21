import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Routine } from '../types';
import { ACTIVITIES } from '../constants/activities';

interface RoutineCardProps {
  routine: Routine;
}

export default function RoutineCard({ routine }: RoutineCardProps) {
  const activityEmojis = routine.activityStack
    .map((key) => ACTIVITIES[key]?.emoji ?? '•')
    .join('  ');

  const [hour, minute] = routine.scheduledTime.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayTime = `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/routine/${routine.id}`)}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <Text style={styles.childName}>{routine.childName}</Text>
        <Text style={styles.time}>⏰ {displayTime}</Text>
      </View>
      <Text style={styles.activities} numberOfLines={1}>
        {activityEmojis}
      </Text>
      <Text style={styles.stepCount}>
        {routine.activityStack.length} steps
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 18,
    marginHorizontal: 16,
    marginVertical: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  childName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
  },
  time: {
    fontSize: 14,
    color: '#4A90D9',
    fontWeight: '600',
  },
  activities: {
    fontSize: 22,
    marginBottom: 8,
    letterSpacing: 4,
  },
  stepCount: {
    fontSize: 13,
    color: '#888',
  },
});
