import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../../theme';

/**
 * Isolation Mode dimmer. Rendered between the background and the table
 * layer, so the felt + the 2 spotlighted players stay bright while the rest
 * of the screen sinks into shadow. Never intercepts touches.
 */
export default function IsolationOverlay({ active }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: 350 });
  }, [active, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, style]} />;
}

/** Same effect for a single region (e.g. the inactive player's own hand). */
export function DimLayer({ active, style }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: 350 });
  }, [active, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, style, animated]} />;
}

const styles = StyleSheet.create({
  dim: { backgroundColor: colors.overlay },
});
