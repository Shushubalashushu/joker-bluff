import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { BounceIn, FadeIn, FadeInUp, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, ZoomIn } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../common/Avatar';
import CartoonButton from '../common/CartoonButton';
import PlayingCard from './PlayingCard';
import OfferDeclaration from './OfferDeclaration';
import { LIE_DEYE } from '../../config';
import { useI18n } from '../../i18n';
import { rich } from '../../i18n/rich';
import { playerName } from '../../utils/playerName';
import { noTranslateProps } from '../../utils/webTranslation';
import { colors, fonts, gradients, cartoonShadow } from '../../theme';
import { viewport, verticalScrollProps } from '../../theme/layout';

function MobileHands({ podium, summary, label, children }) {
  const [podiumHeight, setPodiumHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const summaryStyle = useAnimatedStyle(() => {
    const progress = podiumHeight > 0 ? Math.min(1, Math.max(0, (scrollY.value - podiumHeight + 76) / 36)) : 0;
    return { opacity: progress, transform: [{ translateY: (progress - 1) * 8 }] };
  });
  // Keep enough travel to collapse the podium when only part of the last hand needs to scroll.
  const minHeight = listHeight > 0 && contentHeight > listHeight ? listHeight + Math.max(0, podiumHeight - 36) : undefined;

  return (
    <View style={styles.mobileHands}>
      <Animated.ScrollView
        {...verticalScrollProps}
        accessibilityLabel={label}
        tabIndex={0}
        testID="revealed-hands"
        contentContainerStyle={{ minHeight }}
        onLayout={({ nativeEvent }) => setListHeight(nativeEvent.layout.height)}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.handsContent} onLayout={({ nativeEvent }) => setContentHeight(nativeEvent.layout.height)}>
          <View onLayout={({ nativeEvent }) => setPodiumHeight(nativeEvent.layout.height)}>{podium}</View>
          {children}
        </View>
      </Animated.ScrollView>
      <Animated.View
        testID="round-summary"
        pointerEvents="none"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.summary, summaryStyle]}
      >
        {summary}
      </Animated.View>
    </View>
  );
}

/**
 * End-of-round results: winner, Joker loser, every hand revealed, and the
 * Lie Deye balances everyone carries into the next game (winner gets +1).
 * Wrapped in its own SafeAreaProvider: RN Modals render in a separate native
 * window, so they don't inherit the app's safe-area context.
 */
export default function GameOverModal({ visible, result, lastTransfer, economy = LIE_DEYE, players, seats = [], myId, isHost, onPlayAgain, onEndGame, onLeave }) {
  const { t, tError, lang, textStyle, alignStart } = useI18n();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!result) return null;

  const mobile = width < 600;
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const tokensOf = Object.fromEntries(seats.map((s) => [s.id, s.tokens]));
  const winner = byId[result.winnerId];
  const loser = byId[result.loserId];
  const iWon = result.winnerId === myId;
  const iLost = result.loserId === myId;
  const title = t(iWon ? 'results.win' : iLost ? 'results.loss' : 'results.over');
  const quad = rich(t('results.quad'), { rank: <Text {...noTranslateProps}>{result.winningRank}</Text> });

  const run = (key, fn) => async () => {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res);
    setBusy(null);
  };

  const podium = (
    <View style={styles.podium} testID="round-podium">
      <View style={styles.podiumCol}>
        <Text style={[styles.medal, mobile && styles.mobileMedal]}>🏆</Text>
        <Avatar avatarId={winner?.avatarId ?? 0} size={mobile ? 54 : 72} ring={colors.gold} />
        <Text style={[styles.podiumName, textStyle]} numberOfLines={1}>{playerName(winner, t, lang)}</Text>
        <Text style={[styles.podiumSub, textStyle]}>{quad}</Text>
        <Animated.View entering={ZoomIn.delay(700)} style={styles.bonus}>
          <Text style={[styles.bonusText, textStyle]}>{t('results.bonus', { amount: economy.WIN_BONUS })}</Text>
        </Animated.View>
      </View>
      {loser && (
        <View style={styles.podiumCol}>
          <Text style={[styles.medal, mobile && styles.mobileMedal]}>🤡</Text>
          <Avatar avatarId={loser.avatarId} size={mobile ? 48 : 60} ring={colors.red} />
          <Text style={[styles.podiumName, textStyle]} numberOfLines={1}>{playerName(loser, t, lang)}</Text>
          <Text style={[styles.podiumSub, styles.loser, textStyle]}>{t('results.joker')}</Text>
        </View>
      )}
    </View>
  );

  const summary = [
    { player: winner, ring: colors.gold, label: quad },
    ...(loser ? [{ player: loser, ring: colors.red, label: t('results.joker') }] : []),
  ].map(({ player, ring, label }, i) => (
    <View key={i} style={styles.summaryPlayer}>
      <Avatar avatarId={player?.avatarId ?? 0} size={28} ring={ring} />
      <View style={styles.summaryText}>
        <Text style={[styles.handName, alignStart]} numberOfLines={1}>{playerName(player, t, lang)}</Text>
        <Text style={[styles.summaryLabel, i === 1 && styles.loser, alignStart]} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  ));

  const hands = Object.entries(result.hands).map(([pid, cards], i) => (
    <Animated.View key={pid} testID="revealed-hand" entering={mobile ? undefined : FadeInUp.delay(150 + i * 80)} style={[styles.handRow, mobile && styles.mobileHandRow]}>
      <View style={[styles.handWho, mobile && styles.mobileHandWho]}>
        <Text style={[styles.handName, alignStart]} numberOfLines={1} ellipsizeMode="tail">
          {pid === myId ? t('common.you') : playerName(byId[pid], t, lang, 'results.left')}
        </Text>
        {typeof tokensOf[pid] === 'number' && <Text style={[styles.handTokens, alignStart]}>👁️ {tokensOf[pid]}</Text>}
      </View>
      <View style={styles.handCards} testID="revealed-cards">
        {cards.map((c) => <PlayingCard key={c.id} card={c} size="xs" highlighted={c.rank === 'JOKER'} />)}
      </View>
    </Animated.View>
  ));

  const backButton = isHost && (
    <CartoonButton
      title={t('results.back')}
      size="sm"
      gradient={gradients.danger}
      lipColor={colors.darkRed}
      loading={busy === 'end'}
      disabled={!!busy}
      onPress={run('end', onEndGame)}
      style={mobile && styles.footerButton}
    />
  );
  const leaveButton = (
    <CartoonButton
      title={t('waiting.leave')}
      size="sm"
      gradient={gradients.blue}
      lipColor={colors.darkBlue}
      onPress={run('leave', onLeave)}
      loading={busy === 'leave'}
      disabled={!!busy}
      style={mobile && isHost && styles.footerButton}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent accessibilityLabel={title}>
      <SafeAreaProvider style={viewport}>
        <SafeAreaView style={[styles.backdrop, mobile && styles.mobileBackdrop]} edges={['top', 'bottom', 'left', 'right']}>
          <Animated.View entering={mobile ? FadeIn.duration(220) : BounceIn.duration(700)} style={[styles.card, mobile && styles.mobileCard]}>
            {!mobile && <Text style={styles.confetti}>🎉 ✨ 🎊</Text>}
            <Text accessibilityRole="header" style={[styles.headline, mobile && styles.mobileHeadline, textStyle]}>{title}</Text>
            <OfferDeclaration declaration={lastTransfer?.declaration} style={styles.claim} />
            {mobile ? (
              <MobileHands podium={podium} summary={summary} label={t('results.hands')}>{hands}</MobileHands>
            ) : (
              <>
                {podium}
                <ScrollView {...verticalScrollProps} accessibilityLabel={t('results.hands')} tabIndex={0} style={styles.hands} contentContainerStyle={styles.handsContent}>
                  {hands}
                </ScrollView>
              </>
            )}
            <Text style={[styles.carry, textStyle]}>
              {t('results.carry', { max: economy.MAX_USES_PER_GAME })}
            </Text>
            {!!error && <Text style={[styles.error, textStyle]}>{tError(error)}</Text>}

            <View style={[styles.buttons, mobile && styles.mobileButtons]}>
              {isHost ? (
                <CartoonButton
                  title={t('results.again')}
                  size={mobile ? 'sm' : 'md'}
                  gradient={gradients.success}
                  lipColor={colors.darkGreen}
                  icon={<Text style={{ fontSize: mobile ? 18 : 22 }}>🔁</Text>}
                  loading={busy === 'again'}
                  disabled={!!busy}
                  onPress={run('again', onPlayAgain)}
                />
              ) : (
                <Text style={[styles.waitText, textStyle]}>{t('results.wait')}</Text>
              )}
              {mobile && isHost ? <View style={styles.footerRow}>{backButton}{leaveButton}</View> : <>{backButton}{leaveButton}</>}
            </View>
          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  error: { fontFamily: fonts.semibold, color: colors.darkRed, textAlign: 'center' },
  claim: { fontFamily: fonts.bold, color: colors.darkBlue, textAlign: 'center' },
  backdrop: { ...viewport, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 18 },
  mobileBackdrop: { padding: 10 },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '100%',
    backgroundColor: colors.cream,
    borderRadius: 30,
    borderWidth: 4,
    borderColor: colors.night,
    padding: 18,
    gap: 10,
    ...cartoonShadow,
  },
  mobileCard: { height: '100%', padding: 10, gap: 6 },
  confetti: { textAlign: 'center', fontSize: 28 },
  headline: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: colors.purple,
    textAlign: 'center',
    textShadowColor: colors.yellow,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  mobileHeadline: { fontSize: 25 },
  podium: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  podiumCol: { alignItems: 'center', gap: 4, maxWidth: '48%' },
  medal: { fontSize: 28 },
  mobileMedal: { fontSize: 21 },
  podiumName: { fontFamily: fonts.bold, fontSize: 16, color: colors.night },
  podiumSub: { fontFamily: fonts.semibold, fontSize: 13, color: colors.darkGreen },
  loser: { color: colors.darkRed },
  bonus: { backgroundColor: colors.yellow, borderRadius: 10, borderWidth: 2, borderColor: colors.night, paddingHorizontal: 8, paddingVertical: 2 },
  bonusText: { fontFamily: fonts.bold, fontSize: 12, color: colors.night },
  hands: { maxHeight: 200, flexGrow: 0, minHeight: 0 },
  mobileHands: { flex: 1, minHeight: 0 },
  handsContent: { gap: 8, paddingTop: 3, paddingBottom: 8 },
  summary: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 6,
    backgroundColor: colors.cream, borderColor: colors.night, borderWidth: 2,
    borderRadius: 12, padding: 4,
  },
  summaryPlayer: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryText: { flex: 1, minWidth: 0 },
  summaryLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.darkGreen },
  handRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  mobileHandRow: { gap: 6 },
  handWho: { width: 80 },
  mobileHandWho: { width: 66 },
  handName: { fontFamily: fonts.bold, fontSize: 13, color: colors.night },
  handTokens: { fontFamily: fonts.semibold, fontSize: 11, color: colors.purple },
  handCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 },
  carry: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, textAlign: 'center' },
  buttons: { gap: 10 },
  mobileButtons: { gap: 6 },
  footerRow: { flexDirection: 'row', gap: 6 },
  footerButton: { flex: 1, minWidth: 0 },
  waitText: { fontFamily: fonts.semibold, textAlign: 'center', color: colors.muted },
});
