import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { BounceIn, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../common/Avatar';
import CartoonButton from '../common/CartoonButton';
import PlayingCard from './PlayingCard';
import { LIE_DEYE } from '../../config';
import { useI18n } from '../../i18n';
import { colors, fonts, gradients, cartoonShadow } from '../../theme';

/**
 * End-of-round results: winner, Joker loser, every hand revealed, and the
 * Lie Deye balances everyone carries into the next game (winner gets +1).
 * Wrapped in its own SafeAreaProvider: RN Modals render in a separate native
 * window, so they don't inherit the app's safe-area context.
 */
export default function GameOverModal({ visible, result, lastTransfer, economy = LIE_DEYE, players, seats = [], myId, isHost, onPlayAgain, onEndGame, onLeave }) {
  const { t, tError, textStyle } = useI18n();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!result) return null;

  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const tokensOf = Object.fromEntries(seats.map((s) => [s.id, s.tokens]));
  const winner = byId[result.winnerId];
  const loser = byId[result.loserId];
  const iWon = result.winnerId === myId;
  const iLost = result.loserId === myId;

  const run = (key, fn) => async () => {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res);
    setBusy(null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <SafeAreaProvider>
        <SafeAreaView style={styles.backdrop} edges={['top', 'bottom', 'left', 'right']}>
          <Animated.View entering={BounceIn.duration(700)} style={styles.card}>
            <Text style={styles.confetti}>🎉 ✨ 🎊</Text>
            <Text style={[styles.headline, textStyle]}>{t(iWon ? 'results.win' : iLost ? 'results.loss' : 'results.over')}</Text>
            {lastTransfer?.verifiedNoCard && (
              <Text style={[styles.verified, textStyle]}>{t('table.verifiedTransfer', { rank: lastTransfer.verifiedRank })}</Text>
            )}

            <View style={styles.podium}>
              <View style={styles.podiumCol}>
                <Text style={styles.medal}>🏆</Text>
                <Avatar avatarId={winner?.avatarId ?? 0} size={72} ring={colors.gold} />
                <Text style={styles.podiumName} numberOfLines={1}>
                  {winner?.nickname ?? t('common.aPlayer')}
                </Text>
                <Text style={[styles.podiumSub, textStyle]}>{t('results.quad', { rank: result.winningRank })}</Text>
                <Animated.View entering={ZoomIn.delay(700)} style={styles.bonus}>
                  <Text style={[styles.bonusText, textStyle]}>{t('results.bonus', { amount: economy.WIN_BONUS })}</Text>
                </Animated.View>
              </View>
              {loser && (
                <View style={styles.podiumCol}>
                  <Text style={styles.medal}>🤡</Text>
                  <Avatar avatarId={loser.avatarId} size={60} ring={colors.red} />
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {loser.nickname}
                  </Text>
                  <Text style={[styles.podiumSub, { color: colors.red }, textStyle]}>{t('results.joker')}</Text>
                </View>
              )}
            </View>

            <ScrollView bounces={false} overScrollMode="never" style={styles.hands} contentContainerStyle={{ gap: 8 }}>
              {Object.entries(result.hands).map(([pid, cards], i) => (
                <Animated.View key={pid} entering={FadeInUp.delay(150 + i * 80)} style={styles.handRow}>
                  <View style={styles.handWho}>
                    <Text style={styles.handName} numberOfLines={1}>
                      {pid === myId ? t('common.you') : byId[pid]?.nickname ?? t('results.left')}
                    </Text>
                    {typeof tokensOf[pid] === 'number' && <Text style={styles.handTokens}>👁️ {tokensOf[pid]}</Text>}
                  </View>
                  <View style={styles.handCards}>
                    {cards.map((c) => (
                      <PlayingCard key={c.id} card={c} size="xs" highlighted={c.rank === 'JOKER'} />
                    ))}
                  </View>
                </Animated.View>
              ))}
            </ScrollView>
            <Text style={[styles.carry, textStyle]}>
              {t('results.carry', { max: economy.MAX_USES_PER_GAME })}
            </Text>
            {!!error && <Text style={[styles.error, textStyle]}>{tError(error)}</Text>}

            <View style={styles.buttons}>
              {isHost ? (
                <>
                  <CartoonButton
                    title={t('results.again')}
                    gradient={gradients.success}
                    lipColor={colors.darkGreen}
                    icon={<Text style={{ fontSize: 22 }}>🔁</Text>}
                    loading={busy === 'again'}
                    disabled={!!busy}
                    onPress={run('again', onPlayAgain)}
                  />
                  <CartoonButton
                    title={t('results.back')}
                    size="sm"
                    gradient={gradients.danger}
                    lipColor={colors.darkRed}
                    loading={busy === 'end'}
                    disabled={!!busy}
                    onPress={run('end', onEndGame)}
                  />
                </>
              ) : (
                <Text style={[styles.waitText, textStyle]}>{t('results.wait')}</Text>
              )}
              <CartoonButton
                title={t('waiting.leave')}
                size="sm"
                gradient={gradients.blue}
                lipColor={colors.darkBlue}
                onPress={run('leave', onLeave)}
                loading={busy === 'leave'}
                disabled={!!busy}
              />
            </View>
          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  error: { fontFamily: fonts.semibold, color: colors.darkRed, textAlign: 'center' },
  verified: { fontFamily: fonts.bold, color: colors.darkBlue, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 18 },
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
  podium: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end' },
  podiumCol: { alignItems: 'center', gap: 4, maxWidth: '48%' },
  medal: { fontSize: 28 },
  podiumName: { fontFamily: fonts.bold, fontSize: 16, color: colors.night },
  podiumSub: { fontFamily: fonts.semibold, fontSize: 13, color: colors.darkGreen },
  bonus: { backgroundColor: colors.yellow, borderRadius: 10, borderWidth: 2, borderColor: colors.night, paddingHorizontal: 8, paddingVertical: 2 },
  bonusText: { fontFamily: fonts.bold, fontSize: 12, color: colors.night },
  hands: { maxHeight: 200, flexGrow: 0 },
  handRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.night,
    padding: 6,
  },
  handWho: { width: 80 },
  handName: { fontFamily: fonts.bold, fontSize: 13, color: colors.night },
  handTokens: { fontFamily: fonts.semibold, fontSize: 11, color: colors.purple },
  handCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 },
  carry: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, textAlign: 'center' },
  buttons: { gap: 10 },
  waitText: { fontFamily: fonts.semibold, textAlign: 'center', color: colors.muted },
});
