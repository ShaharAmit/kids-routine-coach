import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DailyProgress } from '../types';

interface DailyProgressCardProps {
  segment: 'morning' | 'evening';
  progress: DailyProgress;
}

export default function DailyProgressCard({ segment, progress }: DailyProgressCardProps) {
  const isSegmentMorning = segment === 'morning';
  const completed = isSegmentMorning ? progress.morningCompleted : progress.eveningCompleted;
  const total = isSegmentMorning ? progress.morningTotal : progress.eveningTotal;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  const isComplete = completed === total && total > 0;

  const emoji = isSegmentMorning ? '🌅' : '🌙';
  const label = isSegmentMorning ? 'Morning' : 'Evening';
  const bgColor = isSegmentMorning ? '#FFF8E6' : '#E6F2FF';
  const accentColor = isSegmentMorning ? '#FFB800' : '#4A90D9';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.label}>{label} Tasks</Text>
        {isComplete && <Text style={styles.badge}>✓ Complete!</Text>}
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View
            style={[
              styles.progressBar,
              { width: `${percentage}%`, backgroundColor: accentColor },
            ]}
          />
        </View>
        <View style={styles.statsRow}>
          <Text style={styles.statsText}>
            <Text style={styles.statsBold}>{completed}</Text> / {total} completed
          </Text>
          <Text style={[styles.percentage, { color: accentColor }]}>{percentage}%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E4EAF1',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  emoji: {
    fontSize: 24,
    marginRight: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
  },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  progressSection: {
    gap: 10,
  },
  progressBarContainer: {
    height: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsText: {
    fontSize: 13,
    color: '#475569',
  },
  statsBold: {
    fontWeight: '700',
    color: '#1F2937',
  },
  percentage: {
    fontSize: 13,
    fontWeight: '700',
  },
});
