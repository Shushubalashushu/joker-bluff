import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import useServerCountdown from '../../hooks/useServerCountdown';
import { colors, fonts } from '../../theme';

/**
 * Strict, server-synced countdown bar.
 * The bar starts from the TRUE remaining fraction (deadline - serverNow) and
 * drains linearly on the UI thread, so all phones hit zero together.
 *
 * `frozen`: a Lie Deye token reset the clock to a full 60s - the bar turns icy
 * blue and shows "👁️ Time frozen" so everyone at the table knows.
 */
export default function TimerBar({ deadline, duration, clockOffset, label, frozen = false, compact = false }) {
  const progress = useSharedValue(1);
  const pulse = useSharedValue(1);
  const remaining = useServerCountdown(deadline, clockOffset);
  const seconds = Math.ceil(remaining / 1000);
  const urgent = remaining > 0 && remaining <= (frozen ? 5000 : 3000);

  useEffect(() => {
    cancelAnimation(progress);
    if (!deadline || !duration) {
      progress.value = 0;
      return;
    }
    const left = Math.max(0, deadline - (Date.now() + clockOffset));
    progress.value = withSequence(
      withTiming(Math.min(1, left / duration), { duration: 0 }),
      withTiming(0, { duration: left, easing: Easing.linear })
    );
  }, [deadline, duration, clockOffset, progress]);

  useEffect(() => {
    if (urgent) {
      pulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 160 }), withTiming(1, { duration: 160 })), -1);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1);
    }
  }, [urgent, pulse]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
    backgroundColor: frozen
      ? interpolateColor(progress.value, [0, 0.15, 1], [colors.red, colors.blue, colors.teal])
      : interpolateColor(progress.value, [0, 0.25, 0.55, 1], [colors.red, colors.orange, colors.yellow, colors.green]),
  }));
  const wrapStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const h = compact ? 20 : 24;
  const badge = compact ? 34 : 40;

  return (
    <Animated.View style={[styles.wrap, wrapStyle]} accessibilityRole="progressbar" accessibilityLabel={`${seconds} seconds left`}>
      <View style={[styles.track, { height: h, borderRadius: h / 2 }, frozen && styles.trackFrozen]}>
        <Animated.View style={[styles.fill, fillStyle]} />
        <View style={styles.shine} pointerEvents="none" />
        {!!(label || frozen) && (
          <Text style={[styles.label, compact && { fontSize: 11 }, frozen && styles.labelFrozen]} numberOfLines={1}>
            {frozen ? `👁️ Time frozen · ${label || ''}` : label}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.badge,
          { width: badge, height: badge, borderRadius: badge / 2 },
          frozen && { backgroundColor: colors.teal },
          urgent && { backgroundColor: colors.red },
        ]}
      >
        {/* 3-digit values (DEV_TESTING_MODE's 600s timers) shrink to fit the round badge. */}
        <Text
          style={[
            styles.seconds,
            compact && { fontSize: 15 },
            seconds >= 100 && { fontSize: compact ? 11 : 13, letterSpacing: -0.5 },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {deadline ? seconds : '–'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: {
    flex: 1,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  trackFrozen: { borderColor: colors.blue, backgroundColor: 'rgba(58,134,255,0.25)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 9 },
  shine: { position: 'absolute', top: 2, left: 6, right: 6, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  label: { fontFamily: fonts.bold, fontSize: 12, color: colors.night, textAlign: 'center', paddingHorizontal: 8 },
  labelFrozen: { color: colors.white, textShadowColor: colors.night, textShadowRadius: 0, textShadowOffset: { width: 0, height: 1 } },
  badge: {
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: { fontFamily: fonts.bold, fontSize: 18, color: colors.night },
});
