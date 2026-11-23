import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import PlayingCard, { CARD_SIZES } from './PlayingCard';
import OfferDeclaration from './OfferDeclaration';
import { PHASES } from '../../constants/events';
import { useI18n } from '../../i18n';
import { rich } from '../../i18n/rich';
import { colors, fonts, gradients } from '../../theme';
import { noTranslateProps } from '../../utils/webTranslation';

const FELT_BORDER = 4;
const FELT_PADDING = 6;
const INNER_BORDER = 2;
const INNER_PADDING = 8;

function OfferSlot({ number, offer, forcedSlot, showFace, cardSize, width, available }) {
  const { t, textStyle } = useI18n();
  const s = CARD_SIZES[cardSize] || CARD_SIZES.md;
  if (!offer) {
    return (
      <View style={[styles.slotCol, { width }]}>
        <View style={[styles.emptySlot, { width: s.w, height: s.h, borderRadius: s.radius }]}>
          <Text style={[styles.slotNumber, { fontSize: s.rank + 4 }]}>{number}</Text>
        </View>
        <Text style={[styles.slotLabel, forcedSlot && styles.forcedLabel, textStyle]} numberOfLines={1} adjustsFontSizeToFit>
          {forcedSlot ? t('table.forced') : t('table.offerN', { n: number })}
        </Text>
      </View>
    );
  }
  const rejected = offer.status === 'rejected' && !available;
  return (
    <View style={[styles.slotCol, { width }]}>
      <Animated.View entering={ZoomIn.springify().damping(12)} style={rejected && styles.rejectedCard}>
        {/* Holder sees their own face-down cards (unless Anti-spy is on); everyone else gets null from the server */}
        <PlayingCard card={showFace ? offer.card : null} size={cardSize} highlighted={available || offer.status === 'pending'} />
        {rejected && (
          <View style={styles.stamp}>
            <Text style={styles.stampText}>✗</Text>
          </View>
        )}
        {offer.lieDeyeUsed && (
          <View style={styles.eyeBadge} accessibilityLabel={t('table.a11yLieDeye')}>
            <Text style={styles.eyeText}>👁️</Text>
          </View>
        )}
      </Animated.View>
      <Text style={[styles.slotLabel, (available || forcedSlot) && styles.forcedLabel, textStyle]} numberOfLines={1} adjustsFontSizeToFit>
        {available ? t('table.offerN', { n: number }) : rejected ? t('table.rejected') : forcedSlot ? t('table.forced') : t('table.pending')}
      </Text>
    </View>
  );
}

/**
 * Center felt: who's trading with whom, the requested rank, and the
 * 3 face-down offer slots (slot 3 = forced, auto-accepted).
 * `concealed` (Anti-spy) also hides the holder's own offered faces.
 */
export default function TableArea({ game, nameOf, myId, cardSize = 'md', width, concealed = false, compact = false }) {
  const { t, textStyle } = useI18n();
  const holderName = nameOf(game.holderId);
  const activeName = nameOf(game.activeId);
  const isHolderView = myId === game.holderId;
  const choosing = myId === game.activeId && game.phase === PHASES.DECISION && game.offers.length === 2;
  const slotGap = compact || width < 235 ? 6 : 14;
  const feltPadding = compact ? 4 : FELT_PADDING;
  const cardWidth = (width - 2 * (FELT_BORDER + feltPadding + INNER_BORDER + INNER_PADDING + slotGap)) / game.maxOffers;
  const fittedSize = [cardSize, 'sm', 'xs'].find((size) => CARD_SIZES[size].w <= cardWidth) ?? 'xs';
  const slotWidth = Math.max(CARD_SIZES[fittedSize].w, Math.min(cardWidth, CARD_SIZES.sm.w));

  return (
    <LinearGradient colors={gradients.felt} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[styles.felt, { padding: feltPadding }]}>
      <View style={[styles.inner, compact && styles.innerCompact]}>
        <View style={[styles.heading, compact && styles.headingCompact, compact && width >= 280 && styles.headingInline]}>
          {/* Trade direction is a physical arrow (giver -> asker): stays LTR in every language */}
          <View style={styles.tradeRow}>
            <Text style={styles.tradeName} numberOfLines={1} ellipsizeMode="tail">
              {game.holderId === myId ? t('common.you') : holderName}
            </Text>
            <Text style={styles.arrow}>🎴 ➜</Text>
            <Text style={styles.tradeName} numberOfLines={1} ellipsizeMode="tail">
              {game.activeId === myId ? t('common.you') : activeName}
            </Text>
          </View>

          {game.requestedRank ? (
            <Animated.View entering={FadeIn} key={`ask-${game.turn}`} style={styles.bubble}>
              <Text style={[styles.bubbleText, compact && { fontSize: 14 }, textStyle]}>
                {rich(t('table.gotAny'), { rank: <Text {...noTranslateProps} style={styles.bubbleRank}>{game.requestedRank}</Text> })}
              </Text>
            </Animated.View>
          ) : (
            <View style={[styles.bubble, styles.bubbleIdle]}>
              <Text style={[styles.bubbleIdleText, textStyle]} numberOfLines={1}>
                {game.phase === PHASES.REQUEST
                  ? game.activeId === myId
                    ? t('table.youPicking')
                    : t('table.picking', { name: activeName })
                  : '…'}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.slots, { gap: slotGap }]}>
          {[1, 2, 3].map((n) => (
            <OfferSlot
              key={n}
              number={n}
              offer={game.offers[n - 1]}
              forcedSlot={n === game.maxOffers}
              showFace={isHolderView && !concealed}
              cardSize={fittedSize}
              width={slotWidth}
              available={choosing && n <= 2}
            />
          ))}
        </View>
        {game.offers.filter(({ declaration }) => declaration).map(({ number, declaration }) => (
          <OfferDeclaration key={number} declaration={declaration} number={number} style={styles.declaration} />
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  felt: {
    borderRadius: 36,
    borderWidth: FELT_BORDER,
    borderColor: colors.night,
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 0,
    elevation: 6,
  },
  inner: {
    borderRadius: 30,
    borderWidth: INNER_BORDER,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 10,
    paddingHorizontal: INNER_PADDING,
    alignItems: 'center',
    gap: 8,
  },
  innerCompact: { paddingVertical: 4, gap: 5 },
  heading: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  headingCompact: { gap: 5 },
  headingInline: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  tradeName: { flexShrink: 1, minWidth: 0, overflow: 'hidden', fontFamily: fonts.bold, color: colors.white, fontSize: 15, maxWidth: 110 },
  arrow: { fontSize: 15, color: colors.yellow },
  bubble: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.night,
    paddingHorizontal: 12,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  bubbleText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.night },
  declaration: {
    alignSelf: 'stretch',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontFamily: fonts.semibold,
    fontSize: 13,
    backgroundColor: colors.cream,
    color: colors.night,
    textAlign: 'center',
  },
  bubbleRank: { fontFamily: fonts.bold, color: colors.pink, fontSize: 20 },
  bubbleIdle: { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'transparent' },
  bubbleIdleText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.white },
  slots: { flexDirection: 'row', marginTop: 2 },
  slotCol: { alignItems: 'center', gap: 4 },
  emptySlot: {
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumber: { fontFamily: fonts.bold, color: 'rgba(255,255,255,0.6)' },
  slotLabel: { width: '100%', textAlign: 'center', fontFamily: fonts.bold, fontSize: 11, color: colors.white },
  forcedLabel: { color: colors.yellow },
  rejectedCard: { opacity: 0.6, transform: [{ rotate: '-6deg' }] },
  stamp: {
    position: 'absolute',
    top: '28%',
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.red,
    borderWidth: 3,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: { color: colors.white, fontFamily: fonts.bold, fontSize: 20, marginTop: -2 },
  eyeBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeText: { fontSize: 12 },
});
