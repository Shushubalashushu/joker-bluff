import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PlayingCard, { CARD_SIZES } from './PlayingCard';
import { colors, fonts } from '../../theme';

const SPRING = { damping: 14, stiffness: 180, mass: 0.8 };
export const OFFER_DRAG_THRESHOLD = 90; // px upward to "throw" a card onto the table
const FLIP_MS = 220; // anti-spy flip: fast enough to feel instant, slow enough to read as a flip
const TOUCH_MOVE_EVERY = 3; // forward every Nth touch-move sample to JS (UI-thread throttle)
const LIFT_PX = 26;
// Real fingers drift a few px during a tap. A drag only starts after this much
// movement, and a tap still counts up to TAP_MAX_DISTANCE (iPhone fix).
const DRAG_MIN_DISTANCE = 14;
const TAP_MAX_DISTANCE = 22;
const TAP_MAX_DURATION = 1200;
const noop = () => {};

/**
 * Two-faced card that flips around the Y axis.
 * ONLY this inner layer rotates - the card's slot, fan transform and gesture
 * transform are untouched, so concealing never moves or reorders anything.
 *
 * Touch fix (iOS): both faces are `pointerEvents="none"` and the root has an
 * explicit, flat (2D) hit box. UIKit hit-testing therefore never has to deal
 * with the 3D-transformed / alpha-0 faces - every touch lands on the root,
 * which sits inside the GestureDetector's view.
 */
function FlipCard({ card, size, highlighted, concealed }) {
  const s = CARD_SIZES[size] || CARD_SIZES.md;
  const flip = useSharedValue(concealed ? 1 : 0);
  useEffect(() => {
    flip.value = withTiming(concealed ? 1 : 0, { duration: FLIP_MS });
  }, [concealed, flip]);

  const front = useAnimatedStyle(() => ({
    // opacity switch at 90° backs up backfaceVisibility (unreliable on some Android GPUs)
    opacity: flip.value < 0.5 ? 1 : 0,
    // no 3D transform at rest (only while flipping / flipped)
    transform: flip.value === 0 ? [] : [{ perspective: 800 }, { rotateY: `${flip.value * 180}deg` }],
  }));
  const back = useAnimatedStyle(() => ({
    opacity: flip.value >= 0.5 ? 1 : 0,
    transform: [{ perspective: 800 }, { rotateY: `${flip.value * 180 - 180}deg` }],
  }));

  return (
    <View style={{ width: s.w, height: s.h }} collapsable={false}>
      <Animated.View style={[styles.face, front]} pointerEvents="none">
        <PlayingCard card={card} size={size} highlighted={highlighted} />
      </Animated.View>
      <Animated.View style={[styles.face, styles.backFace, back]} pointerEvents="none">
        <PlayingCard card={null} faceDown size={size} highlighted={highlighted} />
      </Animated.View>
    </View>
  );
}

function HandCard({
  card,
  x,
  y,
  rotate,
  zIndex,
  size,
  bottom,
  selected,
  isNew,
  concealed,
  canSelect,
  canDrag,
  onSelect,
  onDragStart,
  onDragOffer,
  onTouchSample,
  resetNonce,
  shuffleNonce,
  containerWidth,
}) {
  const s = CARD_SIZES[size];
  const bx = useSharedValue(x);
  const by = useSharedValue(y);
  const br = useSharedValue(rotate);
  const lift = useSharedValue(selected ? 1 : 0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const opacity = useSharedValue(1);
  const hop = useSharedValue(0);
  const moveTick = useSharedValue(0);

  // Re-fan smoothly whenever the hand size or order changes (e.g. Shuffle).
  useEffect(() => {
    bx.value = withSpring(x, SPRING);
    by.value = withSpring(y, SPRING);
    br.value = withSpring(rotate, SPRING);
  }, [x, y, rotate, bx, by, br]);

  useEffect(() => {
    lift.value = withSpring(selected ? 1 : 0, SPRING);
  }, [selected, lift]);

  // Shuffle feedback: every card does a little hop while sliding to its new slot.
  useEffect(() => {
    if (!shuffleNonce) return;
    hop.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, { damping: 9, stiffness: 220 }));
  }, [shuffleNonce, hop]);

  // Parent bumps `resetNonce` if a drag-offer was rejected by the server.
  useEffect(() => {
    dragX.value = withSpring(0, SPRING);
    dragY.value = withSpring(0, SPRING);
    opacity.value = withTiming(1);
  }, [resetNonce, dragX, dragY, opacity]);

  const gesture = useMemo(() => {
    const select = onSelect || noop;
    const dragStart = onDragStart || noop;
    const offer = onDragOffer || noop;
    const sample = onTouchSample || noop;
    const cardId = card.id;
    const w = s.w;
    const h = s.h;

    // TAP = selection. Runs on the JS thread (`runOnJS(true)`): no worklet ->
    // JS bridging involved, so the select callback fires reliably on iOS.
    const tap = Gesture.Tap()
      .runOnJS(true)
      .enabled(canSelect)
      .maxDuration(TAP_MAX_DURATION)
      .maxDistance(TAP_MAX_DISTANCE)
      .onEnd((_e, success) => {
        if (success) select(cardId);
      });

    // DRAG = throw the card onto the table. Runs on the UI thread for smoothness.
    const pan = Gesture.Pan()
      .enabled(canDrag)
      .minDistance(DRAG_MIN_DISTANCE)
      // Lie Deye telemetry: where the giver's finger rests / hesitates while choosing.
      // (x, y) are relative to this card -> normalized so they replay on any screen.
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (t) runOnJS(sample)(cardId, t.x / w, t.y / h, t.absoluteX, t.absoluteY, true);
      })
      .onTouchesMove((e) => {
        moveTick.value = (moveTick.value + 1) % TOUCH_MOVE_EVERY;
        if (moveTick.value !== 0) return;
        const t = e.allTouches[0];
        if (t) runOnJS(sample)(cardId, t.x / w, t.y / h, t.absoluteX, t.absoluteY, false);
      })
      .onStart(() => {
        dragging.value = withTiming(1, { duration: 120 });
        runOnJS(dragStart)(cardId);
      })
      .onUpdate((e) => {
        dragX.value = e.translationX;
        dragY.value = Math.min(e.translationY, 30);
      })
      .onEnd((e) => {
        if (e.translationY < -OFFER_DRAG_THRESHOLD) {
          // Fly toward the table, then let the server confirm.
          dragY.value = withTiming(-280, { duration: 220 });
          opacity.value = withTiming(0, { duration: 220 });
          runOnJS(offer)(cardId);
        } else {
          dragX.value = withSpring(0, SPRING);
          dragY.value = withSpring(0, SPRING);
        }
      })
      .onFinalize(() => {
        dragging.value = withTiming(0, { duration: 150 });
      });

    return Gesture.Race(pan, tap);
  }, [canDrag, canSelect, card.id, s.w, s.h, onSelect, onDragStart, onDragOffer, onTouchSample, dragX, dragY, dragging, opacity, moveTick]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: bx.value + dragX.value },
      { translateY: by.value - lift.value * LIFT_PX - hop.value * 18 + dragY.value },
      { rotate: `${br.value * (1 - dragging.value)}deg` },
      { scale: 1 + lift.value * 0.06 + dragging.value * 0.08 },
    ],
  }));

  return (
    // Outer view: static position + entering animation (no transforms here,
    // so the layout animation never fights the gesture-driven transform).
    //
    // MIDDLE-CARD FIX: every slot is laid out at the SAME spot (the centre of the
    // hand) and the fan offset is only a transform on the inner view. With the
    // default pointerEvents the slot itself is a hit target, so after a shuffle the
    // slots of higher-z cards sat invisibly on top of the centre card and swallowed
    // its touches. `box-none` = the slot never takes a touch; only the visible,
    // transformed card (inside the GestureDetector) can.
    <Animated.View
      entering={FadeInUp.springify().damping(14)}
      pointerEvents="box-none"
      style={[styles.slot, { bottom, left: containerWidth / 2 - s.w / 2, zIndex, elevation: zIndex }]}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          style={animatedStyle}
          accessible
          accessibilityRole="button"
          accessibilityState={{ selected, disabled: !canSelect }}
          accessibilityLabel={concealed ? 'Hidden card' : `${card.rank} ${card.suit}`}
        >
          <FlipCard card={card} size={size} highlighted={selected || isNew} concealed={concealed} />
          {isNew && (
            <View style={styles.newBadge} pointerEvents="none">
              <Text style={styles.newText}>NEW</Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/** Height the hand needs for a given card size / count (fan arc + lift room). */
export function handHeight(size, count = 5) {
  const s = CARD_SIZES[size] || CARD_SIZES.md;
  const center = Math.max(0, (count - 1) / 2);
  return s.h + LIFT_PX + 10 + center * center * 5;
}

/**
 * The local player's fanned hand (bottom of the screen).
 * - Tap a card to select it (lifts up).
 * - When `canDrag`, drag a card upward past the threshold to offer it.
 * - `concealed` (Anti-spy): every card flips face-down IN PLACE.
 * - `onTouchSample(cardId, u, v, absX, absY, isDown)` streams touch telemetry.
 * - `shuffleNonce`: bump it to play the shuffle "hop".
 *
 * Rendering note: card views are rendered in a STABLE order (sorted by id) and
 * only their x / rotation / zIndex follow the hand order. Re-ordering keyed
 * native views (what a shuffle used to do) can leave iOS with stale transforms
 * and dead hit areas; moving props instead guarantees the visual update and
 * keeps every card tappable.
 */
export default function FannedHand({
  cards,
  selectedId,
  onSelect,
  onDragStart,
  canSelect = false,
  canDrag = false,
  onDragOffer,
  onTouchSample,
  newCardId,
  concealed = false,
  resetNonce = 0,
  shuffleNonce = 0,
  size: sizeProp,
  width: widthProp,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const size = sizeProp || (windowWidth >= 375 ? 'lg' : 'md');
  const s = CARD_SIZES[size];
  const containerWidth = (widthProp || windowWidth) - 24;

  const n = cards.length;
  const spread = n > 1 ? Math.min(s.w * 0.8, (containerWidth - s.w - 16) / (n - 1)) : 0;
  const center = (n - 1) / 2;
  // Outer cards drop by center² * 5 px on the arc - anchor high enough that they
  // never slide under the home indicator / out of the safe area.
  const bottom = 4 + center * center * 5;

  const slotOf = useMemo(() => new Map(cards.map((c, i) => [c.id, i])), [cards]);
  const stable = useMemo(() => [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [cards]);

  return (
    // box-none: the full-width hand strip itself never captures a touch.
    <View pointerEvents="box-none" style={[styles.container, { height: handHeight(size, Math.max(n, 5)) }]}>
      {stable.map((card) => {
        // `i` is the card's CURRENT (post-shuffle) slot. Stacking follows it
        // left -> right (classic fan: each card overlaps the right part of its left
        // neighbour), so the centre card (rotation 0) is always z = centre + 1 and
        // its visible face is never under another card's invisible hit area.
        const i = slotOf.get(card.id);
        const rel = i - center;
        return (
          <HandCard
            key={card.id}
            card={card}
            size={size}
            bottom={bottom}
            containerWidth={containerWidth}
            x={rel * spread}
            y={rel * rel * 5}
            rotate={rel * 7}
            zIndex={card.id === selectedId ? 50 : i + 1}
            selected={card.id === selectedId}
            isNew={card.id === newCardId}
            concealed={concealed}
            canSelect={canSelect}
            canDrag={canDrag}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onDragOffer={onDragOffer}
            onTouchSample={onTouchSample}
            resetNonce={resetNonce}
            shuffleNonce={shuffleNonce}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', justifyContent: 'flex-end' },
  slot: { position: 'absolute' },
  face: { backfaceVisibility: 'hidden' },
  backFace: { position: 'absolute', top: 0, left: 0 },
  newBadge: {
    position: 'absolute',
    top: -10,
    right: -8,
    backgroundColor: colors.pink,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  newText: { fontFamily: fonts.bold, fontSize: 11, color: colors.white },
});
