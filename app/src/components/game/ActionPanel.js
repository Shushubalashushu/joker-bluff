import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import CartoonButton from '../common/CartoonButton';
import { PHASES } from '../../constants/events';
import { useI18n } from '../../i18n';
import { rich } from '../../i18n/rich';
import { colors, fonts, gradients } from '../../theme';

function RankPicker({ ranks, onPick, disabled, compact }) {
  const { t } = useI18n();
  return (
    <View style={styles.rankRow}>
      {ranks.map((r) => (
        <Pressable
          key={r}
          disabled={disabled}
          onPress={() => onPick(r)}
          style={({ pressed }) => [
            styles.rankChip,
            compact && styles.rankChipCompact,
            pressed && styles.rankChipPressed,
            disabled && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('action.a11yAskRank', { rank: r })}
        >
          <Text style={[styles.rankText, compact && { fontSize: 18 }]}>{r}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * 👁️ Lie Deye strip shown to the ASKER while they decide.
 * Shows the wallet (balance) and how many of the 3 per-game uses remain.
 */
function LieDeyeBar({ game, busy, onUse, onOpen }) {
  const { t, textStyle } = useI18n();
  const wallet = game.lieDeyeWallet || { balance: 0, usedThisGame: 0, maxPerGame: 3, usesLeft: 0 };
  const alreadyUsed = !!game.lieDeye; // spent on THIS offer -> stats are available
  const capReached = wallet.usedThisGame >= wallet.maxPerGame;
  const reason = capReached
    ? t('ld.maxReached', { max: wallet.maxPerGame })
    : wallet.balance <= 0
    ? t('ld.noTokens')
    : t('ld.usesLeft', { count: wallet.usesLeft });

  return (
    <View style={styles.ldRow}>
      <View style={styles.ldTokens} accessibilityLabel={t('ld.a11yTokens', { count: wallet.balance })}>
        {Array.from({ length: wallet.maxPerGame }, (_, i) => {
          const spent = i < wallet.usedThisGame;
          return (
            <Animated.View key={i} entering={ZoomIn.delay(i * 60)} style={[styles.token, spent && styles.tokenSpent]}>
              <Text style={styles.tokenEye}>{spent ? '✖️' : '👁️'}</Text>
            </Animated.View>
          );
        })}
        <View style={styles.ldMeta}>
          <Text style={styles.ldBalance}>×{wallet.balance}</Text>
          <Text style={[styles.ldReason, textStyle]} numberOfLines={1}>
            {reason}
          </Text>
        </View>
      </View>
      {alreadyUsed ? (
        <CartoonButton title={t('ld.var')} size="sm" gradient={gradients.blue} lipColor={colors.darkBlue} onPress={onOpen} />
      ) : (
        <CartoonButton
          title={t('ld.title')}
          size="sm"
          gradient={gradients.gold}
          lipColor={colors.darkOrange}
          textStyle={{ color: colors.night, textShadowColor: 'transparent' }}
          disabled={busy || !game.canUseLieDeye}
          onPress={onUse}
        />
      )}
    </View>
  );
}

/**
 * 🔵✔ "I don't have it" (System Verified Forced Bluff) toggle for the GIVER.
 * Only rendered when the SERVER says `canClaimNoCard` (it checked the hand).
 * Arming it doesn't send anything yet: the giver still picks any card, and the
 * claim travels with that offer (`noCard: true`) - the server re-validates it.
 */
function NoCardToggle({ armed, onToggle, disabled }) {
  const { t, textStyle } = useI18n();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: armed, disabled }}
      accessibilityLabel={t('nocard.a11yToggle')}
      style={({ pressed }) => [styles.noCard, armed && styles.noCardOn, pressed && styles.noCardPressed, disabled && { opacity: 0.5 }]}
    >
      <View style={[styles.checkDot, armed && styles.checkDotOn]}>
        <Text style={styles.checkMark}>✔</Text>
      </View>
      <View style={styles.noCardTextCol}>
        <Text style={[styles.noCardTitle, armed && { color: colors.white }, textStyle]}>
          {armed ? t('nocard.cancel') : t('nocard.button')}
        </Text>
        <Text style={[styles.noCardBadge, armed && { color: colors.white }, textStyle]}>{t('nocard.badge')}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Context-sensitive controls. What you see depends on your role this turn:
 *   ACTIVE (asker)  -> pick a rank, then Accept / Reject offers 1 & 2 (+ Lie Deye)
 *   HOLDER (giver)  -> choose a card to offer (tap + button, or drag up)
 *                      (+ "I don't have it" when the server verified you lack the rank)
 *   everyone else   -> isolated / muted spectator message
 */
export default function ActionPanel({
  game,
  myId,
  nameOf,
  selectedCardId,
  busy,
  onRequest,
  onOffer,
  onDecide,
  onLieDeye,
  onOpenLieDeye,
  claimNoCard = false,
  onToggleNoCard,
  compact = false,
}) {
  const { t, textStyle } = useI18n();
  const isActive = myId === game.activeId;
  const isHolder = myId === game.holderId;
  const holderName = nameOf(game.holderId);
  const activeName = nameOf(game.activeId);
  const offerNumber = game.offers.length;
  const pendingOffer = game.offers[offerNumber - 1];
  const hl = (s) => <Text style={styles.hl}>{s}</Text>;

  let content;

  if (game.phase === PHASES.REQUEST && isActive) {
    content = (
      <>
        <Text style={[styles.title, compact && styles.titleCompact, textStyle]}>{t('action.askFor', { name: holderName })}</Text>
        <RankPicker ranks={game.ranks} onPick={onRequest} disabled={busy} compact={compact} />
      </>
    );
  } else if (game.phase === PHASES.OFFER && isHolder) {
    const nextNumber = offerNumber + 1;
    const final = nextNumber === game.maxOffers;
    const armed = claimNoCard && game.canClaimNoCard;
    const title = selectedCardId
      ? armed
        ? t('nocard.offer')
        : final
        ? t('action.forceCard')
        : t('action.offerFaceDown')
      : t('action.selectCard');
    content = (
      <>
        <Text style={[styles.title, compact && styles.titleCompact, textStyle]}>
          {rich(t('action.wants'), { name: activeName, rank: hl(game.requestedRank) })}
        </Text>
        <Text style={[styles.sub, final && styles.warn, armed && styles.verifiedSub, textStyle]}>
          {armed
            ? t(final ? 'nocard.armedFinal' : 'nocard.armed', { rank: game.requestedRank })
            : final
            ? t('action.finalOffer')
            : t('action.offerHint', { n: nextNumber })}
        </Text>
        <View style={styles.offerRow}>
          {game.canClaimNoCard && <NoCardToggle armed={armed} onToggle={onToggleNoCard} disabled={busy} />}
          <CartoonButton
            title={title}
            size="sm"
            gradient={armed ? gradients.blue : final ? gradients.danger : gradients.primary}
            lipColor={armed ? colors.darkBlue : final ? colors.darkRed : colors.darkOrange}
            disabled={!selectedCardId}
            loading={busy}
            onPress={() => onOffer(selectedCardId)}
            style={styles.flex}
          />
        </View>
      </>
    );
  } else if (game.phase === PHASES.DECISION && isActive) {
    content = (
      <>
        <Text style={[styles.title, compact && styles.titleCompact, textStyle]}>
          {t('action.offerFrom', { n: offerNumber, name: holderName })}
          {pendingOffer?.lieDeyeUsed ? ' 👁️' : ''}
        </Text>
        {pendingOffer?.verifiedNoCard ? (
          // The giver proved (server-checked) they have no card of my rank: it's a bluff by necessity.
          <View style={styles.verifiedBox}>
            <Text style={[styles.verifiedText, textStyle]}>
              {t('nocard.received', { name: holderName, rank: game.requestedRank })}
            </Text>
          </View>
        ) : (
          !compact && (
            <Text style={[styles.sub, offerNumber === 2 && styles.warn, textStyle]}>
              {offerNumber === 2 ? t('action.rejectWarn') : t('action.bluffQ')}
            </Text>
          )
        )}
        {pendingOffer?.verifiedNoCard && offerNumber === 2 && (
          <Text style={[styles.sub, styles.warn, textStyle]}>{t('action.rejectWarn')}</Text>
        )}
        <LieDeyeBar game={game} busy={busy} onUse={onLieDeye} onOpen={onOpenLieDeye} />
        <View style={styles.decisionRow}>
          <CartoonButton
            title={t('action.reject')}
            size={compact ? 'sm' : 'md'}
            gradient={gradients.danger}
            lipColor={colors.darkRed}
            icon={<Text style={styles.emoji}>✋</Text>}
            disabled={busy || !pendingOffer}
            onPress={() => onDecide(false)}
            style={styles.flex}
          />
          <CartoonButton
            title={t('action.take')}
            size={compact ? 'sm' : 'md'}
            gradient={gradients.success}
            lipColor={colors.darkGreen}
            icon={<Text style={styles.emoji}>🤲</Text>}
            disabled={busy || !pendingOffer}
            onPress={() => onDecide(true)}
            style={styles.flex}
          />
        </View>
      </>
    );
  } else if (isActive || isHolder) {
    const waitingOn = game.actorId === game.holderId ? holderName : activeName;
    const frozen = game.phase === PHASES.DECISION && pendingOffer?.lieDeyeUsed;
    content = (
      <Text style={[styles.waiting, textStyle]}>
        {frozen ? '👁️ ' : '⏳ '}
        {frozen
          ? rich(t('action.lieDeyeOnYou'), { name: hl(waitingOn) })
          : rich(t('action.waitingFor'), { name: hl(waitingOn) })}
      </Text>
    );
  } else {
    content = (
      <View style={styles.isolatedRow}>
        <Text style={styles.isolatedIcon}>🔇</Text>
        <Text style={[styles.isolatedText, textStyle]}>{rich(t('action.mutedTrading'), { a: hl(holderName), b: hl(activeName) })}</Text>
      </View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn}
      key={`${game.phase}-${game.turn}-${offerNumber}`}
      style={[styles.panel, compact && styles.panelCompact]}
    >
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.night,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 8,
    minHeight: 64,
    justifyContent: 'center',
  },
  panelCompact: { paddingVertical: 7, gap: 6, minHeight: 52, borderRadius: 18 },
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.night, textAlign: 'center' },
  titleCompact: { fontSize: 15 },
  sub: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, textAlign: 'center' },
  warn: { color: colors.red },
  hl: { fontFamily: fonts.bold, color: colors.purple },
  rankRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  rankChip: {
    minWidth: 48,
    height: 52,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.night,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 0,
    elevation: 3,
  },
  rankChipCompact: { minWidth: 44, height: 44 },
  rankChipPressed: { transform: [{ translateY: 3 }], shadowOpacity: 0 },
  rankText: { fontFamily: fonts.bold, fontSize: 22, color: colors.night },
  decisionRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  flex: { flex: 1 },
  wide: { alignSelf: 'stretch' },
  emoji: { fontSize: 20 },
  waiting: { fontFamily: fonts.semibold, fontSize: 16, color: colors.night, textAlign: 'center' },
  isolatedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  isolatedIcon: { fontSize: 22 },
  isolatedText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.night },
  // System Verified Forced Bluff
  noCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: colors.blue,
    backgroundColor: colors.white,
  },
  noCardOn: { backgroundColor: colors.blue, borderColor: colors.night },
  noCardPressed: { transform: [{ translateY: 2 }] },
  checkDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkDotOn: { backgroundColor: colors.blue, borderColor: colors.white },
  checkMark: { color: colors.blue, fontFamily: fonts.bold, fontSize: 13, marginTop: -1 },
  noCardTextCol: { maxWidth: 104 },
  noCardTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.night },
  noCardBadge: { fontFamily: fonts.semibold, fontSize: 10, color: colors.blue },
  verifiedSub: { color: colors.blue },
  verifiedBox: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(43,123,255,0.12)',
    borderColor: colors.blue,
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  verifiedText: { fontFamily: fonts.bold, fontSize: 13, color: colors.blue, textAlign: 'center' },
  // Lie Deye
  ldRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: colors.night,
    borderRadius: 14,
    paddingVertical: 5,
    paddingLeft: 8,
    paddingRight: 5,
  },
  ldTokens: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  token: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenSpent: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)' },
  tokenEye: { fontSize: 14 },
  ldMeta: { marginLeft: 4, flexShrink: 1 },
  ldBalance: { fontFamily: fonts.bold, color: colors.yellow, fontSize: 14, lineHeight: 16 },
  ldReason: { fontFamily: fonts.regular, color: colors.cream, fontSize: 10, opacity: 0.85 },
});
