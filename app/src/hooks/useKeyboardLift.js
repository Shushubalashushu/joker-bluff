import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * "Slide, don't squish" keyboard handling (iOS).
 *
 * Instead of letting a KeyboardAvoidingView shrink the screen (which compresses
 * every flex child), we measure the focused target (`targetRef`, e.g. the
 * profile card or the bottom sheet) and translate a wrapper UP by exactly the
 * amount the keyboard would cover. Transforms never trigger a re-layout, so
 * nothing changes size - it just glides up and back down with the keyboard's
 * own animation curve/duration.
 *
 * Android uses `softwareKeyboardLayoutMode: "pan"` (app.json) instead, where
 * the OS pans the window, so the hook is a no-op there.
 *
 * @param {{ margin?: number, enabled?: boolean }} [opts]
 * @returns {{ targetRef: object, liftStyle: object }}
 */
export default function useKeyboardLift({ margin = 12, enabled = true } = {}) {
  const insets = useSafeAreaInsets();
  const targetRef = useRef(null);
  const lift = useSharedValue(0);
  const active = enabled && Platform.OS === 'ios';

  const animateTo = useCallback(
    (value, duration) => {
      lift.value = withTiming(value, { duration: Math.max(120, duration || 250), easing: Easing.out(Easing.cubic) });
    },
    [lift]
  );

  useEffect(() => {
    if (!active) return undefined;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      const kbTop = e.endCoordinates.screenY;
      const node = targetRef.current;
      if (!node?.measureInWindow) return;
      node.measureInWindow((x, y, w, h) => {
        // measureInWindow reports the CURRENT (possibly already lifted) frame.
        const current = lift.value;
        const top = y + current;
        const bottom = top + h;
        const needed = bottom + margin - kbTop; // how much the keyboard would cover
        const maxLift = Math.max(0, top - insets.top - 8); // never push the target under the notch
        animateTo(Math.max(0, Math.min(needed, maxLift)), e.duration);
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => animateTo(0, e.duration));
    return () => {
      show.remove();
      hide.remove();
      lift.value = 0;
    };
  }, [active, animateTo, insets.top, lift, margin]);

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));
  return { targetRef, liftStyle };
}
