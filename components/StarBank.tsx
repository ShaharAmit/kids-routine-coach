import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { STAR_LEVELS, getStarLevel, getStarsToNextLevel } from '../types';

interface StarBankProps {
  totalStars: number;
}

export default function StarBank({ totalStars }: StarBankProps) {
  const level = getStarLevel(totalStars);
  const starsToNext = getStarsToNextLevel(totalStars);
  const nextLevel = STAR_LEVELS.find((l) => l.minStars > level.maxStars) ?? level;
  
  const progress = (totalStars - level.minStars) / (level.maxStars - level.minStars + 1);
  const progressWidth = Math.min(Math.max(progress * 100, 0), 100);

  return (
    <View style={styles.container}>
      {/* Star bank display */}
      <View style={styles.bankSection}>
        <Text style={styles.starCount}>{totalStars}</Text>
        <Text style={styles.starLabel}>⭐ Stars</Text>
      </View>

      {/* Current level badge */}
      <View style={styles.levelSection}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelEmoji}>{level.emoji}</Text>
          <View>
            <Text style={styles.levelName}>{level.level}</Text>
          </View>
        </View>

        {/* Progress to next level */}
        {level.level !== 'Superstar' && (
          <View style={styles.nextLevelInfo}>
            <Text style={styles.nextLevelLabel}>Next: {nextLevel.emoji} {nextLevel.level}</Text>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${progressWidth}%` },
                ]}
              />
            </View>
            <Text style={styles.starsNeeded}>
              {starsToNext} star{starsToNext !== 1 ? 's' : ''} to next level
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#FFE8B6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  bankSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  starCount: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFB800',
    lineHeight: 52,
  },
  starLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 4,
  },
  levelSection: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 16,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  levelEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  levelName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  nextLevelInfo: {
    marginTop: 8,
  },
  nextLevelLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4A90D9',
    borderRadius: 4,
  },
  starsNeeded: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
  },
});
