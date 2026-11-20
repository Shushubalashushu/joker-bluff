import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import PlayingCard, { CARD_SIZES } from './PlayingCard';
import { colors, fonts } from '../../theme';

const REPLAY_MS = 2600; // the whole touch trail replays in this time

/** teal (early) -> yellow -> red (late) */
const STOPS = [
  [46, 196, 182],
  [255, 210, 63],
  [255, 59, 92],
];
export function heatColor(f, alpha = 1) {
  const x = Math.min(1, Math.max(0, f)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const k = x - i;
  const [r, g, b] = STOPS[i].map((c, j) => Math.round(c + (STOPS[i + 1][j] - c) * k));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Derived numbers used by the VAR overlay (cards touched, switches, per-slot counts…). */
export function analyzeTouches(touches, handSize) {
  const perSlot = Array.from({ length: handSize }, () => 0);
  let switches = 0;
  let lastSlot = null;
  for (const t of touches) {
    if (t.s === null || t.s === undefined) continue;
    perSlot[t.s] += 1;
    if (lastSlot !== null && t.s !== lastSlot) switches += 1;
    lastSlot = t.s;
  }
  return {
    perSlot,
    switches,
    cardsTouched: perSlot.filter((n) => n > 0).length,
    maxPerSlot: Math.max(1, ...perSlot),
    onCards: perSlot.reduce((a, b) => a + b, 0),
  };
}

/**
 * Touch heatmap over a flat row of the giver's card backs (in the order they
 * were in when the card was offered). Each glowing dot is a touch sample placed
 * at the exact spot inside the card it landed on; colour = when it happened.
 * Change `replayKey` to replay the trail.
 */
export default function TouchHeatmap({ touches, handSize, offeredSlot, decisionMs, width, replayKey = 0 }) {
  const stats = useMemo(() => analyzeTouches(touches, handSize), [touches, handSize]);

  const gap = 8;
  const base = CARD_SIZES.md;
  const cardW = Math.min(base.w * 1.15, (width - 24 - gap * (handSize - 1)) / handSize);
  const cardH = cardW * (base.h / base.w);
  const rowW = handSize * cardW + (handSize - 1) * gap;
  const x0 = (width - rowW) / 2;
  const padTop = 18;
  const maxT = Math.max(1, decisionMs, ...touches.map((t) => t.t));

  return (
    <View style={{ width, height: cardH + padTop + 26 }}>
      {Array.from({ length: handSize }, (_, slot) => {
        const heat = stats.perSlot[slot] / stats.maxPerSlot;
        const picked = slot === offeredSlot;
        return (
          <View
            key={slot}
            style={[styles.slot, { left: x0 + slot * (cardW + gap), top: padTop, width: cardW, height: cardH }]}
          >
            <PlayingCard card={null} faceDown size="md" style={{ width: cardW, height: cardH }} />
            {heat > 0 && (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, styles.tint, { backgroundColor: heatColor(heat, 0.18 + heat * 0.32) }]}
              />
            )}
            {picked && (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.picked]}>
                <View style={styles.pickedTag}>
                  <Text style={styles.pickedText}>PICKED</Text>
                </View>
              </View>
            )}
            <Text style={styles.count}>{stats.perSlot[slot] ? `${stats.perSlot[slot]}×` : '·'}</Text>
          </View>
        );
      })}

      {/* Dots (re-mounted on replay) */}
      <View key={replayKey} style={StyleSheet.absoluteFill} pointerEvents="none">
        {touches.map((t, i) => {
          if (t.s === null || t.s === undefined) return null;
          const f = t.t / maxT;
          const left = x0 + t.s * (cardW + gap) + t.u * cardW;
          const top = padTop + t.v * cardH;
          return (
            <Animated.View
              key={i}
              entering={ZoomIn.delay(Math.round(f * REPLAY_MS)).duration(220)}
              style={[styles.dotWrap, { left: left - 11, top: top - 11 }]}
            >
              <View style={[styles.glow, { backgroundColor: heatColor(f, 0.28) }]} />
              <View style={[styles.dot, { backgroundColor: heatColor(f, 0.95) }]} />
            </Animated.View>
          );
        })}
      </View>

      {touches.length === 0 && (
        <Animated.View entering={FadeIn} style={[StyleSheet.absoluteFill, styles.empty]} pointerEvents="none">
          <Text style={styles.emptyText}>No touches recorded</Text>
        </Animated.View>
      )}
    </View>
  );
}

/** Tiny phone-shaped map of raw screen touches (also shows touches that missed the cards). */
export function ScreenMap({ touches, decisionMs, width = 64, aspect = 2.1, replayKey = 0 }) {
  const height = width * aspect;
  const maxT = Math.max(1, decisionMs, ...touches.map((t) => t.t));
  return (
    <View style={[styles.phone, { width, height }]}>
      <View style={styles.island} />
      <View key={replayKey} style={StyleSheet.absoluteFill}>
        {touches.map((t, i) => {
          const f = t.t / maxT;
          return (
            <Animated.View
              key={i}
              entering={ZoomIn.delay(Math.round(f * REPLAY_MS)).duration(180)}
              style={[styles.miniDot, { left: t.x * width - 3, top: t.y * height - 3, backgroundColor: heatColor(f) }]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'center' },
  tint: { borderRadius: 11 },
  picked: { borderRadius: 11, borderWidth: 3, borderColor: colors.yellow, alignItems: 'center' },
  pickedTag: {
    position: 'absolute',
    top: -12,
    backgroundColor: colors.yellow,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 5,
  },
  pickedText: { fontFamily: fonts.bold, fontSize: 9, color: colors.night, letterSpacing: 0.5 },
  count: { position: 'absolute', bottom: -20, fontFamily: fonts.bold, fontSize: 12, color: colors.cream },
  dotWrap: { position: 'absolute', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 22, height: 22, borderRadius: 11 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: {
    fontFamily: fonts.bold,
    color: colors.white,
    backgroundColor: 'rgba(43,27,74,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  phone: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  island: { alignSelf: 'center', marginTop: 4, width: 18, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  miniDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
});
