import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Routine } from '../types';
import { ACTIVITIES } from '../constants/activities';

interface RoutineCardProps {
  routine: Routine;
}

export default function RoutineCard({ routine }: RoutineCardProps) {
  const activityEmojis = routine.activityStack
    .flat()
    .map((key) => ACTIVITIES[key]?.emoji ?? '•')
    .join('  ');

  const [hour, minute] = routine.scheduledTime.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayTime = `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  const hasMultipleTimes = (routine.stepTimes?.length ?? 0) > 1;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        // RoutineCard navigation - currently unused in tab structure
        // The routine player is built into app/index.tsx
      }}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <Text style={styles.childName}>{routine.childName}</Text>
        <Text style={styles.time}>{hasMultipleTimes ? `⏰ Starts ${displayTime}` : `⏰ ${displayTime}`}</Text>
      </View>
      {hasMultipleTimes ? <Text style={styles.timeSub}>{routine.stepTimes?.length} timed steps</Text> : null}
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
  timeSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
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
