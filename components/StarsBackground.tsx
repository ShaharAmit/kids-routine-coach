import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from 'react-native';

const STAR = require('../assets/images/star.png');

interface StarConfig {
  top: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  twinkleDuration: number;
}

function DriftingStar({ config, screenWidth }: { config: StarConfig; screenWidth: number }) {
  const translateX = useRef(new Animated.Value(-config.size)).current;
  const twinkle = useRef(new Animated.Value(config.opacity)).current;

  useEffect(() => {
    const travel = screenWidth + config.size * 2;
    const animate = () => {
      translateX.setValue(-config.size);
      Animated.timing(translateX, {
        toValue: travel,
        duration: config.duration,
        delay: config.delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) animate();
      });
    };
    animate();
    return () => translateX.stopAnimation();
  }, [config, screenWidth, translateX]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, {
          toValue: Math.max(0.2, config.opacity - 0.5),
          duration: config.twinkleDuration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(twinkle, {
          toValue: config.opacity,
          duration: config.twinkleDuration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [config, twinkle]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.star,
        {
          top: config.top,
          opacity: twinkle,
          transform: [{ translateX }],
        },
      ]}
    >
      <Image
        source={STAR}
        style={{ width: config.size, height: config.size }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

export default function StarsBackground({ children }: { children?: React.ReactNode }) {
  const { width } = useWindowDimensions();

  const stars = useMemo<StarConfig[]>(
    () => [
      
      { top: 30, size: 70, duration: 48000, delay: 0, opacity: 0.95, twinkleDuration: 1600 },
      { top: 70, size: 60, duration: 48000, delay: 5000, opacity: 0.7, twinkleDuration: 2200 },
      { top: 40, size: 65, duration: 48000, delay: 10000, opacity: 0.85, twinkleDuration: 1900 },
      { top: 100, size: 60, duration: 48000, delay: 15000, opacity: 0.6, twinkleDuration: 2600 },
      { top: 55, size: 65, duration: 48000, delay: 20000, opacity: 0.8, twinkleDuration: 2000 },
      { top: 80, size: 70, duration: 48000, delay: 25000, opacity: 0.65, twinkleDuration: 2400 },
      { top: 30, size: 70, duration: 48000, delay: 30000, opacity: 0.95, twinkleDuration: 2400 },
      { top: 70, size: 65, duration: 48000, delay: 35000, opacity: 0.8, twinkleDuration: 1900 },
      { top: 110, size: 60, duration: 48000, delay: 40000, opacity: 0.65, twinkleDuration: 2200 },
    ],
    []
  );

  return (
    <View style={styles.root} pointerEvents="none">
      {stars.map((config, index) => (
        <DriftingStar key={index} config={config} screenWidth={width} />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#2e4385',
    overflow: 'hidden',
  },
  star: {
    position: 'absolute',
    left: 0,
  },
});
