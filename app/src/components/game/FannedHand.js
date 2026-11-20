import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import PlayingCard, { CARD_SIZES } from './PlayingCard';
import { useI18n } from '../../i18n';
import { colors, fonts } from '../../theme';

const SPRING = { damping: 14, stiffness: 180, mass: 0.8 };
const SLOT_TRANSITION = LinearTransition.springify().damping(14).stiffness(180).mass(0.8);
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
 * The visual layer is transparent to touches. The enclosing gesture target
 * owns the card hitbox for both faces.
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
    <View pointerEvents="none" style={{ width: s.w, height: s.h }}>
      <Animated.View style={[styles.face, front]}>
        <PlayingCard card={card} size={size} highlighted={highlighted} />
      </Animated.View>
      <Animated.View style={[styles.face, styles.backFace, back]}>
        <PlayingCard card={null} faceDown size={size} highlighted={highlighted} />
      </Animated.View>
    </View>
  );
}

function HandCard({
  card,
  left,
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
  resetKey,
  shuffleNonce,
}) {
  const { t, textStyle } = useI18n();
  const s = CARD_SIZES[size];
  const br = useSharedValue(rotate);
  const lift = useSharedValue(selected ? 1 : 0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const opacity = useSharedValue(1);
  const hop = useSharedValue(0);
  const moveTick = useSharedValue(0);

  useEffect(() => {
    br.value = withSpring(rotate, SPRING);
  }, [rotate, br]);

  useEffect(() => {
    lift.value = withSpring(selected ? 1 : 0, SPRING);
  }, [selected, lift]);

  // Shuffle feedback: every card does a little hop while sliding to its new slot.
  useEffect(() => {
    if (!shuffleNonce) return;
    hop.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, { damping: 9, stiffness: 220 }));
  }, [shuffleNonce, hop]);

  // Reset a thrown card when the server rejects the offer or the move changes.
  useEffect(() => {
    dragX.value = withSpring(0, SPRING);
    dragY.value = withSpring(0, SPRING);
    opacity.value = withTiming(1);
  }, [resetKey, dragX, dragY, opacity]);

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
      .onEnd((e, success) => {
        if (success && e.translationY < -OFFER_DRAG_THRESHOLD) {
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
      { translateX: dragX.value },
      { translateY: -lift.value * LIFT_PX - hop.value * 18 + dragY.value },
      { rotate: `${br.value * (1 - dragging.value)}deg` },
      { scale: 1 + lift.value * 0.06 + dragging.value * 0.08 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        collapsable={false}
        entering={FadeIn}
        layout={SLOT_TRANSITION}
        style={[styles.slot, { left, bottom, width: s.w, height: s.h, zIndex }, animatedStyle]}
        accessible
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !canSelect }}
        accessibilityLabel={concealed ? t('hand.hiddenCard') : card.rank === 'JOKER' ? t('hand.joker') : t('hand.card', { rank: card.rank, suit: t(`suit.${card.suit}`) })}
        onAccessibilityTap={canSelect ? () => onSelect?.(card.id) : undefined}
      >
        <FlipCard card={card} size={size} highlighted={selected || isNew} concealed={concealed} />
        {isNew && (
          <View style={styles.newBadge} pointerEvents="none">
            <Text style={[styles.newText, textStyle]}>{t('hand.new')}</Text>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
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
 * Each gesture target is a direct sibling with its own native slot frame.
 * Mounted card identities stay stable while their frames and stacking follow
 * the current hand order.
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
  resetKey,
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
        const i = slotOf.get(card.id);
        const rel = i - center;
        // Place the innermost card above its neighbours. Break ties to the right.
        const slotZIndex = 2 * n - 2 * Math.abs(rel) + (rel > 0 ? 1 : 0);
        return (
          <HandCard
            key={card.id}
            card={card}
            size={size}
            left={(containerWidth - s.w) / 2 + rel * spread}
            bottom={bottom - rel * rel * 5}
            rotate={rel * 7}
            zIndex={card.id === selectedId ? 2 * n + 1 : slotZIndex}
            selected={card.id === selectedId}
            isNew={card.id === newCardId}
            concealed={concealed}
            canSelect={canSelect}
            canDrag={canDrag}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onDragOffer={onDragOffer}
            onTouchSample={onTouchSample}
            resetKey={resetKey}
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
