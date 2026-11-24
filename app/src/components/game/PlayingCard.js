import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useI18n } from '../../i18n';
import { colors, fonts, gradients } from '../../theme';
import { noTranslateProps } from '../../utils/webTranslation';

export const CARD_SIZES = {
  xs: { w: 30, h: 42, rank: 12, pip: 14, radius: 6 },
  sm: { w: 42, h: 60, rank: 15, pip: 22, radius: 8 },
  md: { w: 58, h: 84, rank: 19, pip: 32, radius: 11 },
  lg: { w: 74, h: 106, rank: 24, pip: 42, radius: 13 },
  desktopSm: { w: 86, h: 122, rank: 28, pip: 48, radius: 14 },
  desktop: { w: 104, h: 148, rank: 34, pip: 58, radius: 16 },
  desktopLg: { w: 128, h: 182, rank: 41, pip: 70, radius: 19 },
};

const SUIT = {
  hearts: { glyph: '♥', color: colors.red },
  diamonds: { glyph: '♦', color: colors.orange },
  clubs: { glyph: '♣', color: colors.night },
  spades: { glyph: '♠', color: colors.deepPurple },
};

function CardBack({ s }) {
  return (
    <LinearGradient colors={gradients.cardBack} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      <View style={[styles.backInner, { borderRadius: s.radius - 4 }]}>
        <Text style={[styles.backLogo, { fontSize: s.pip * 0.55 }]} allowFontScaling={false}>
          JB
        </Text>
        <Text style={{ fontSize: s.pip * 0.4, color: colors.yellow }} allowFontScaling={false}>
          ★
        </Text>
      </View>
    </LinearGradient>
  );
}

function JokerFace({ s }) {
  const { t, textStyle } = useI18n();
  return (
    <LinearGradient colors={gradients.joker} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, styles.center]}>
      <Text style={{ fontSize: s.pip }} allowFontScaling={false}>
        🃏
      </Text>
      {s.w >= 42 && (
        <Text {...noTranslateProps} style={[styles.jokerText, { fontSize: s.rank * 0.6 }, textStyle]} allowFontScaling={false}>
          {t('hand.joker')}
        </Text>
      )}
    </LinearGradient>
  );
}

function RankFace({ card, s }) {
  const suit = SUIT[card.suit] || SUIT.spades;
  return (
    <View style={[styles.fill, styles.face]}>
      <View style={styles.corner}>
        <Text {...noTranslateProps} style={[styles.rank, { fontSize: s.rank, color: suit.color }]} allowFontScaling={false}>
          {card.rank}
        </Text>
        <Text style={{ fontSize: s.rank * 0.75, color: suit.color, marginTop: -4 }} allowFontScaling={false}>
          {suit.glyph}
        </Text>
      </View>
      <Text style={[styles.pip, { fontSize: s.pip, color: suit.color }]} allowFontScaling={false}>
        {suit.glyph}
      </Text>
    </View>
  );
}

/**
 * Cartoon playing card.
 * `card === null` or `faceDown` renders the back (server never sent the face).
 */
export default function PlayingCard({ card, faceDown = false, size = 'md', highlighted = false, style }) {
  const s = CARD_SIZES[size] || CARD_SIZES.md;
  const showBack = faceDown || !card;
  return (
    <View
      style={[
        styles.card,
        {
          width: s.w,
          height: s.h,
          borderRadius: s.radius,
          borderWidth: s.w < 40 ? 2 : 3,
          borderColor: highlighted ? colors.yellow : colors.night,
        },
        highlighted && styles.glow,
        style,
      ]}
    >
      {showBack ? <CardBack s={s} /> : card.rank === 'JOKER' ? <JokerFace s={s} /> : <RankFace card={card} s={s} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: colors.white,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 0,
    elevation: 4,
  },
  glow: { shadowColor: colors.yellow, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  corner: { position: 'absolute', top: 3, left: 5, alignItems: 'center' },
  rank: { fontFamily: fonts.bold, writingDirection: 'ltr' },
  pip: { marginTop: 8 },
  backInner: {
    flex: 1,
    margin: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLogo: { fontFamily: fonts.bold, color: colors.white },
  jokerText: { fontFamily: fonts.bold, color: colors.night, marginTop: 2 },
});
