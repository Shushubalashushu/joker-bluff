import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import CartoonButton from '../common/CartoonButton';
import { PHASES } from '../../constants/events';
import { useI18n } from '../../i18n';
import OfferDecisionButtons from './OfferDecisionButtons';
import OfferDeclaration from './OfferDeclaration';
import { rich } from '../../i18n/rich';
import { colors, fonts, gradients } from '../../theme';
import { noTranslateProps } from '../../utils/webTranslation';

function RankPicker({ ranks, onPick, disabled, compact, substitute = false, selectedRank }) {
  const { t } = useI18n();
  return (
    <View style={styles.rankRow}>
      {ranks.map((r) => {
        const joker = r === 'JOKER';
        const label = joker ? t('hand.joker') : r;
        return (
          <Pressable
            key={r}
            disabled={disabled}
            onPress={() => onPick(r)}
            style={({ pressed }) => [
              styles.rankChip,
              compact && styles.rankChipCompact,
              selectedRank === r && styles.rankChipSelected,
              pressed && styles.rankChipPressed,
              disabled && { opacity: 0.5 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t(substitute ? 'declaration.a11yPick' : 'action.a11yAskRank', { rank: label })}
            aria-pressed={substitute ? selectedRank === r : undefined}
          >
            <Text {...(joker ? {} : noTranslateProps)} style={[styles.rankText, compact && { fontSize: 18 }]}>{label}</Text>
          </Pressable>
        );
      })}
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

function SubstituteToggle({ armed, onToggle, disabled }) {
  const { t, textStyle } = useI18n();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="switch"
      aria-checked={armed}
      aria-disabled={disabled}
      accessibilityLabel={t('declaration.toggle')}
      style={({ pressed }) => [styles.noCard, armed && styles.noCardOn, pressed && styles.noCardPressed, disabled && { opacity: 0.5 }]}
    >
      <Text>💬</Text>
      <View style={styles.noCardTextCol}>
        <Text style={[styles.noCardTitle, armed && { color: colors.white }, textStyle]}>
          {t('declaration.toggle')}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Context-sensitive controls. What you see depends on your role this turn:
 *   ACTIVE (asker)  -> pick a rank, then Accept / Reject offers 1 & 2 (+ Lie Deye)
 *   HOLDER (giver)  -> choose a card to offer (tap + button, or drag up)
 *                      (+ optional substitute declaration)
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
  choosingSubstitute,
  substituteRank,
  onToggleSubstitute,
  onPickSubstitute,
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
    const armed = !final && choosingSubstitute;
    const title = selectedCardId
      ? final
        ? t('action.forceCard')
        : t('action.offerFaceDown')
      : t('action.selectCard');
    content = (
      <>
        <Text style={[styles.title, compact && styles.titleCompact, textStyle]}>
          {rich(t('action.wants'), { name: activeName, rank: <Text {...noTranslateProps} style={styles.hl}>{game.requestedRank}</Text> })}
        </Text>
        {armed && substituteRank ? (
          <OfferDeclaration declaration={{ requestedRank: game.requestedRank, substituteRank }} style={[styles.sub, styles.claimSub]} />
        ) : (
          <Text style={[styles.sub, final && styles.warn, armed && styles.claimSub, textStyle]}>
            {armed ? t('declaration.pick') : final ? t('action.finalOffer') : t('action.offerHint', { n: nextNumber })}
          </Text>
        )}
        {armed && (
          <RankPicker
            ranks={[...game.ranks.filter((rank) => rank !== game.requestedRank), 'JOKER']}
            substitute
            selectedRank={substituteRank}
            onPick={onPickSubstitute}
            disabled={busy}
            compact
          />
        )}
        <View style={styles.offerRow}>
          {!final && <SubstituteToggle armed={armed} onToggle={onToggleSubstitute} disabled={busy} />}
          <CartoonButton
            title={title}
            size="sm"
            gradient={armed ? gradients.blue : final ? gradients.danger : gradients.primary}
            lipColor={armed ? colors.darkBlue : final ? colors.darkRed : colors.darkOrange}
            disabled={!selectedCardId || (armed && !substituteRank)}
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
        {!(compact && offerNumber === 2) && (
          <Text style={[styles.title, compact && styles.titleCompact, textStyle]}>
            {t('action.offerFrom', { n: offerNumber, name: holderName })}
            {pendingOffer?.lieDeyeUsed ? ' 👁️' : ''}
          </Text>
        )}
        {(offerNumber === 2 || !compact) && (
          <Text style={[styles.sub, offerNumber === 2 && styles.warn, textStyle]}>
            {t(offerNumber === 2 ? 'action.rejectWarn' : 'action.bluffQ')}
          </Text>
        )}
        <LieDeyeBar game={game} busy={busy} onUse={onLieDeye} onOpen={onOpenLieDeye} />
        <OfferDecisionButtons offerCount={offerNumber} onDecide={onDecide} busy={busy || !pendingOffer} compact={compact} />
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
      style={[
        styles.panel,
        compact && styles.panelCompact,
        compact && game.phase === PHASES.DECISION && isActive && offerNumber === 2 && styles.panelChoice,
      ]}
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
  panelChoice: { paddingVertical: 4, gap: 4 },
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
  rankChipSelected: { borderColor: colors.darkBlue, backgroundColor: colors.cream },
  rankChipPressed: { transform: [{ translateY: 3 }], shadowOpacity: 0 },
  rankText: { fontFamily: fonts.bold, fontSize: 22, color: colors.night, writingDirection: 'ltr' },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  flex: { flex: 1 },
  wide: { alignSelf: 'stretch' },
  waiting: { fontFamily: fonts.semibold, fontSize: 16, color: colors.night, textAlign: 'center' },
  isolatedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  isolatedIcon: { fontSize: 22 },
  isolatedText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.night },
  // Player claim
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
  noCardTextCol: { maxWidth: 104 },
  noCardTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.night },
  claimSub: { color: colors.blue },
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
