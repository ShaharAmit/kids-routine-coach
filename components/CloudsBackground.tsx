import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from 'react-native';

const CLOUD = require('../assets/images/cloud.png');

interface CloudConfig {
  top: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

function DriftingCloud({ config, screenWidth }: { config: CloudConfig; screenWidth: number }) {
  const translateX = useRef(new Animated.Value(-config.size)).current;

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

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.cloud,
        {
          top: config.top,
          opacity: config.opacity,
          transform: [{ translateX }],
        },
      ]}
    >
      <Image
        source={CLOUD}
        style={{ width: config.size, height: config.size * 0.45 }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

export default function CloudsBackground({ children }: { children?: React.ReactNode }) {
  const { width } = useWindowDimensions();

  const clouds = useMemo<CloudConfig[]>(
    () => [
      { top: 70, size: 150, duration: 34000, delay: 0, opacity: 0.95 },
      { top: 50, size: 80, duration: 30000, delay: 3000, opacity: 0.6 },
      { top: 120, size: 95, duration: 46000, delay: 6000, opacity: 0.8 },
      { top: 50, size: 80, duration: 24000, delay: 9000, opacity: 0.6 },
      { top: 30, size: 110, duration: 40000, delay: 12000, opacity: 0.7 },
      { top: 100, size: 70, duration: 52000, delay: 15000, opacity: 0.6 },
    ],
    []
  );

  return (
    <View style={styles.root} pointerEvents="none">
      {clouds.map((config, index) => (
        <DriftingCloud key={index} config={config} screenWidth={width} />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#c6e8e8',
    overflow: 'hidden',
  },
  cloud: {
    position: 'absolute',
    left: 0,
  },
});
