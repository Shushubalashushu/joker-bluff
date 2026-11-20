import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { colors, cartoonShadow } from '../theme';

export const AUDIO_TOGGLE_SIZE = 48;

/**
 * Persistent speaker button. Rendered once at the app root (top-right corner)
 * so it stays visible on every screen. Wired to AudioContext, which is where
 * background music / SFX will be implemented.
 */
export default function AudioToggle() {
  const { t } = useI18n();
  const { enabled, toggle } = useAudio();
  const insets = useSafeAreaInsets();
  const wobble = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wobble.value}deg` }, { scale: 1 + Math.abs(wobble.value) / 100 }],
  }));

  const onPress = () => {
    wobble.value = withSequence(
      withTiming(-14, { duration: 70 }),
      withTiming(14, { duration: 90 }),
      withTiming(-8, { duration: 80 }),
      withSpring(0)
    );
    toggle();
  };

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 8, right: 14 }, style]}>
      <Pressable
        onPress={onPress}
        hitSlop={10}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        accessibilityLabel={t(enabled ? 'audio.mute' : 'audio.unmute')}
        style={[styles.button, { backgroundColor: enabled ? colors.yellow : colors.muted }]}
      >
        <Ionicons name={enabled ? 'volume-high' : 'volume-mute'} size={24} color={colors.night} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 100, elevation: 100 },
  button: {
    width: AUDIO_TOGGLE_SIZE,
    height: AUDIO_TOGGLE_SIZE,
    borderRadius: AUDIO_TOGGLE_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    ...cartoonShadow,
  },
});
