import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradients } from '../../theme';

const SIZES = {
  sm: { height: 44, font: 16, depth: 4, radius: 14, padX: 14 },
  md: { height: 56, font: 20, depth: 5, radius: 18, padX: 18 },
  lg: { height: 72, font: 26, depth: 7, radius: 24, padX: 22 },
};

/**
 * Chunky 3D cartoon button: a gradient "face" sitting on a darker "lip".
 * Pressing pushes the face down onto the lip with a springy release.
 */
export default function CartoonButton({
  title,
  onPress,
  gradient = gradients.primary,
  lipColor = colors.hotPink,
  size = 'md',
  icon = null,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
}) {
  const s = SIZES[size] || SIZES.md;
  const pressed = useSharedValue(0);

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pressed.value * s.depth }],
  }));

  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 70 });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 9, stiffness: 300 });
      }}
      hitSlop={6}
      style={[{ opacity: disabled ? 0.55 : 1 }, style]}
    >
      <View style={[styles.lip, { borderRadius: s.radius, backgroundColor: lipColor, paddingBottom: s.depth }]}>
        <Animated.View style={faceStyle}>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.face, { height: s.height, borderRadius: s.radius, paddingHorizontal: s.padX }]}
          >
            <View style={[styles.shine, { borderRadius: s.radius }]} pointerEvents="none" />
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                {icon}
                {!!title && <Text style={[styles.text, { fontSize: s.font }, textStyle]}>{title}</Text>}
              </>
            )}
          </LinearGradient>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lip: {
    borderWidth: 3,
    borderColor: colors.night,
    overflow: 'hidden',
  },
  face: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  shine: {
    position: 'absolute',
    top: 4,
    left: 10,
    right: 10,
    height: '38%',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  text: {
    fontFamily: fonts.bold,
    color: colors.white,
    textShadowColor: 'rgba(43,27,74,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
    letterSpacing: 0.5,
  },
});
