import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * "Slide, don't squish" keyboard handling (iOS).
 *
 * Measure the focused input and translate its wrapper by the overlap with the
 * keyboard. A transform leaves the screen and its children at their layout size.
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
    let measurement = 0;
    const adjust = (e) => {
      const request = ++measurement;
      const kbTop = e.endCoordinates.screenY;
      const node = targetRef.current;
      if (!node?.isFocused()) return;
      node.measureInWindow((x, y, w, h) => {
        if (request !== measurement || targetRef.current !== node || !node.isFocused()) return;
        // measureInWindow reports the CURRENT (possibly already lifted) frame.
        const current = lift.value;
        const top = y + current;
        const bottom = top + h;
        const needed = bottom + margin - kbTop; // how much the keyboard would cover
        const maxLift = Math.max(0, top - insets.top - 8); // never push the target under the notch
        animateTo(Math.max(0, Math.min(needed, maxLift)), e.duration);
      });
    };
    const show = Keyboard.addListener('keyboardWillShow', adjust);
    const frame = Keyboard.addListener('keyboardWillChangeFrame', adjust);
    const hide = Keyboard.addListener('keyboardWillHide', (e) => {
      measurement += 1;
      animateTo(0, e.duration);
    });
    return () => {
      measurement += 1;
      show.remove();
      frame.remove();
      hide.remove();
      lift.value = 0;
    };
  }, [active, animateTo, insets.top, lift, margin]);

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));
  return { targetRef, liftStyle };
}
