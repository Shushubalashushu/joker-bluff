import React, { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const DECOR = [
  { glyph: '♥', color: '#FFD23F', x: 0.08, y: 0.12, size: 44, delay: 0 },
  { glyph: '♠', color: '#2EC4B6', x: 0.82, y: 0.2, size: 52, delay: 400 },
  { glyph: '★', color: '#FFFFFF', x: 0.15, y: 0.55, size: 30, delay: 800 },
  { glyph: '♦', color: '#FF9F1C', x: 0.88, y: 0.62, size: 40, delay: 200 },
  { glyph: '♣', color: '#8AE234', x: 0.05, y: 0.85, size: 46, delay: 600 },
  { glyph: '🃏', color: '#FFFFFF', x: 0.75, y: 0.9, size: 38, delay: 1000 },
];

function Floater({ glyph, color, x, y, size, delay, width, height }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -10 + t.value * 20 }, { rotate: `${-12 + t.value * 24}deg` }],
  }));
  return (
    <Animated.View style={[styles.floater, { left: x * width, top: y * height }, style]}>
      <Text style={{ fontSize: size, color, opacity: 0.35 }} allowFontScaling={false}>
        {glyph}
      </Text>
    </Animated.View>
  );
}

/** Colorful gradient backdrop with gently bobbing card-suit decorations. */
export default function PlayfulBackground({ colors: gradientColors, decorations = true }) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.blob, { width: width * 0.9, height: width * 0.9, top: -width * 0.35, right: -width * 0.4 }]} />
      <View style={[styles.blob, { width: width * 0.7, height: width * 0.7, bottom: -width * 0.25, left: -width * 0.3 }]} />
      {decorations && DECOR.map((d, i) => <Floater key={i} {...d} width={width} height={height} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  floater: { position: 'absolute' },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
});
