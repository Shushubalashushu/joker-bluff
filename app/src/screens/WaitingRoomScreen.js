import React, { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutUp, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PlayfulBackground from '../components/common/PlayfulBackground';
import CartoonButton from '../components/common/CartoonButton';
import Avatar from '../components/common/Avatar';
import LobbyActionModal from '../components/lobby/LobbyActionModal';
import { AUDIO_TOGGLE_SIZE } from '../components/AudioToggle';
import LanguageToggle from '../components/LanguageToggle';
import { useI18n } from '../i18n';
import { useGame } from '../context/GameContext';
import useResponsive from '../hooks/useResponsive';
import { describeAbort } from '../utils/describeEvent';
import { LIE_DEYE, MIN_PLAYERS } from '../config';
import { colors, fonts, gradients, cartoonShadow } from '../theme';
import { viewport, verticalScrollProps } from '../theme/layout';

// Grayed-out look for the host's Start button while the table is short-handed.
const DISABLED_GRADIENT = ['#C9C3D9', '#A59DBB'];
const DISABLED_LIP = '#7E7696';

function PlayerTile({ player, isMe, avatarSize, onAction, actionDisabled }) {
  const { t, textStyle } = useI18n();
  return (
    <Animated.View entering={ZoomIn.springify()} style={[styles.tile, isMe && styles.tileMe]}>
      {player.isHost && <Text style={styles.crown}>👑</Text>}
      {onAction && (
        <Pressable
          onPress={onAction}
          disabled={actionDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          accessibilityLabel={t(isMe ? 'waiting.editNickname' : 'waiting.kickPlayer', { name: player.nickname })}
          style={[styles.tileAction, actionDisabled && styles.tileActionDisabled]}
        >
          <Ionicons name={isMe ? 'pencil-outline' : 'person-remove-outline'} size={19} color={isMe ? colors.purple : colors.red} />
        </Pressable>
      )}
      <Avatar avatarId={player.avatarId} size={avatarSize} style={!player.connected && { opacity: 0.4 }} />
      <View style={styles.tileNameFrame}>
        <Text style={styles.tileName} numberOfLines={1} ellipsizeMode="tail">{player.nickname}</Text>
      </View>
      <Text style={[styles.tileSub, textStyle]}>{t(isMe ? 'common.you' : player.connected ? 'waiting.ready' : 'waiting.offline')}</Text>
      {typeof player.tokens === 'number' && (
        <View style={styles.tokenPill} accessibilityLabel={t('ld.a11yTokens', { count: player.tokens })}>
          <Text style={styles.tokenText}>👁️ {player.tokens}</Text>
        </View>
      )}
    </Animated.View>
  );
}

function EmptyTile({ height }) {
  const { t, textStyle } = useI18n();
  return (
    <View style={[styles.tile, styles.tileEmpty, { minHeight: height }]}>
      <Ionicons name="person-add" size={26} color="rgba(255,255,255,0.7)" />
      <Text style={[styles.emptyText, textStyle]}>{t('waiting.waiting')}</Text>
    </View>
  );
}

/** "Bob left — the match was ended." Shown after a match is aborted (player left / disconnected / host ended). */
function AbortBanner({ notice, playerId, onClose }) {
  const { t, alignStart } = useI18n();
  if (!notice) return null;
  return (
    <Animated.View entering={FadeInDown.springify()} exiting={FadeOutUp} style={styles.banner}>
      <Text style={[styles.bannerText, alignStart]}>{describeAbort(notice, null, playerId, t)}</Text>
      <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.dismiss')}>
        <Ionicons name="close-circle" size={22} color={colors.night} />
      </Pressable>
    </Animated.View>
  );
}

export default function WaitingRoomScreen() {
  const { room, playerId, connection, startGame, leaveRoom, kickPlayer, renamePlayer, notice, clearNotice } = useGame();
  const r = useResponsive();
  const { t, tError, textStyle } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null);

  const isHost = room.hostId === playerId;
  const players = room.players;
  const n = players.length;
  const minPlayers = Math.max(MIN_PLAYERS, room.minPlayers ?? MIN_PLAYERS);
  const allConnected = players.every((p) => p.connected);
  const canStart = n >= minPlayers && allConnected;
  const missing = Math.max(0, minPlayers - n);
  const statusLabel = t(canStart ? 'waiting.readyStatus' : missing ? 'waiting.missingStatus' : 'waiting.reconnectStatus', { count: missing });
  const economy = room.lieDeye || LIE_DEYE;
  const avatarSize = r.compact ? 46 : r.tall ? 62 : 54;
  const codeTile = Math.min(50, (r.availW - 36 - 32 - 4 * 8) / 5);

  const share = () =>
    Share.share({ message: t('waiting.shareMessage', { code: room.code }) }).catch(() => {});

  const onStart = async () => {
    setBusy(true);
    setError(null);
    const res = await startGame();
    setBusy(false);
    if (!res.ok) setError(res);
  };

  const onLeave = async () => {
    const res = await leaveRoom();
    if (!res.ok) setError(res);
  };

  return (
    <View style={styles.root}>
      <PlayfulBackground colors={gradients.waiting} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={onLeave} style={styles.iconBtn} hitSlop={8} accessibilityLabel={t('waiting.leave')}>
            <Ionicons name="arrow-back" size={24} color={colors.night} />
          </Pressable>
          <Text style={[styles.headerTitle, r.compact && { fontSize: 20 }, textStyle]} adjustsFontSizeToFit numberOfLines={1}>{t('waiting.title')}</Text>
          <LanguageToggle compact />
          <View style={{ width: AUDIO_TOGGLE_SIZE }} />
        </View>

        <AbortBanner notice={notice} playerId={playerId} onClose={clearNotice} />

        <ScrollView {...verticalScrollProps} contentContainerStyle={[styles.content, r.compact && { gap: 10, padding: 14 }]}>
          {/* Room code */}
          <Animated.View entering={FadeIn} style={styles.codeCard}>
            <Text style={[styles.codeLabel, textStyle]}>{t('waiting.roomCode')}</Text>
            <View style={styles.codeRow}>
              {room.code.split('').map((ch, i) => (
                <View
                  key={i}
                  style={[
                    styles.codeTile,
                    { width: codeTile, height: codeTile * 1.24, transform: [{ rotate: `${(i % 2 ? 1 : -1) * 3}deg` }] },
                  ]}
                >
                  <Text style={[styles.codeChar, { fontSize: codeTile * 0.64 }]}>{ch}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={share} style={styles.shareBtn} accessibilityLabel={t('waiting.share')}>
              <Ionicons name="share-social" size={18} color={colors.white} />
              <Text style={[styles.shareText, textStyle]}>{t('waiting.invite')}</Text>
            </Pressable>
          </Animated.View>

          {/* Dynamic deck preview */}
          <View style={styles.deckPill}>
            <Text style={[styles.deckText, textStyle]}>
              {t('waiting.deck', { count: n, cards: n * 4 + 1 })}
            </Text>
          </View>

          {/* Lie Deye economy reminder */}
          <View style={styles.ldInfo}>
            <Text style={styles.ldTitle}>👁️ Lie Deye</Text>
            <Text style={[styles.ldText, textStyle]}>
              {t('waiting.economy', { start: economy.STARTING_TOKENS, bonus: economy.WIN_BONUS, max: economy.MAX_USES_PER_GAME })}
            </Text>
          </View>

          {/* Players */}
          <View style={styles.grid}>
            {players.map((player) => {
              const isMe = player.id === playerId;
              return (
                <PlayerTile
                  key={player.id}
                  player={player}
                  isMe={isMe}
                  avatarSize={avatarSize}
                  onAction={isMe || isHost ? () => setAction({ kind: isMe ? 'rename' : 'kick', player }) : undefined}
                  actionDisabled={busy || connection !== 'online'}
                />
              );
            })}
            {Array.from({ length: Math.max(0, room.maxPlayers - n) }).map((_, i) => (
              <EmptyTile key={`e${i}`} height={avatarSize + 62} />
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {!!error && <Text style={[styles.error, textStyle]}>⚠️ {tError(error)}</Text>}
          {/* Player-count indicator (everyone sees it) */}
          <View style={[styles.countPill, canStart && styles.countPillReady]}>
            <Text style={[styles.countText, canStart && styles.countTextReady, textStyle]}>
              {t('waiting.playerCount', { count: n, min: minPlayers, status: statusLabel })}
            </Text>
          </View>
          {isHost ? (
            <CartoonButton
              title={t(canStart ? 'waiting.start' : missing ? 'waiting.missing' : 'waiting.reconnect', { count: missing })}
              size={r.compact ? 'md' : 'lg'}
              gradient={canStart ? gradients.success : DISABLED_GRADIENT}
              lipColor={canStart ? colors.darkGreen : DISABLED_LIP}
              icon={<Text style={{ fontSize: canStart ? 26 : 20 }}>{canStart ? '🚀' : '⏳'}</Text>}
              textStyle={!canStart && { fontSize: r.compact ? 15 : 17 }}
              disabled={!canStart || connection !== 'online'}
              loading={busy}
              onPress={onStart}
            />
          ) : (
            <View style={[styles.waitBox, r.compact && { paddingVertical: 14 }]}>
              <Text style={[styles.waitText, textStyle]}>
                {t(canStart ? 'waiting.host' : missing ? 'waiting.more' : 'waiting.reconnect', { count: missing })}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
      {action && (
        <LobbyActionModal
          action={action}
          online={connection === 'online'}
          onClose={() => setAction(null)}
          onSubmit={action.kind === 'rename' ? renamePlayer : kickPlayer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: viewport,
  safe: viewport,
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4 },
  headerTitle: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 24, color: colors.white, textShadowColor: colors.night, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 },
  iconBtn: {
    width: AUDIO_TOGGLE_SIZE,
    height: AUDIO_TOGGLE_SIZE,
    borderRadius: AUDIO_TOGGLE_SIZE / 2,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...cartoonShadow,
  },
  banner: {
    marginHorizontal: 18,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.yellow,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.night,
    paddingVertical: 8,
    paddingHorizontal: 12,
    ...cartoonShadow,
  },
  bannerText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.night },
  content: { padding: 18, gap: 16 },
  codeCard: {
    backgroundColor: colors.white,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: colors.night,
    padding: 16,
    alignItems: 'center',
    gap: 12,
    ...cartoonShadow,
  },
  codeLabel: { fontFamily: fonts.bold, color: colors.muted, letterSpacing: 2, fontSize: 14 },
  codeRow: { flexDirection: 'row', gap: 8 },
  codeTile: {
    borderRadius: 14,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: { fontFamily: fonts.bold, color: colors.night },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.blue,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.night,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  shareText: { fontFamily: fonts.bold, color: colors.white, fontSize: 16 },
  deckPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(43,27,74,0.55)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deckText: { fontFamily: fonts.semibold, color: colors.white, fontSize: 14 },
  ldInfo: {
    backgroundColor: 'rgba(43,27,74,0.75)',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.yellow,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  ldTitle: { fontFamily: fonts.bold, color: colors.yellow, fontSize: 15 },
  ldText: { fontFamily: fonts.regular, color: colors.cream, fontSize: 12, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  tile: {
    width: '46%',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.white,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.night,
    paddingVertical: 12,
    ...cartoonShadow,
  },
  tileMe: { backgroundColor: colors.cream, borderColor: colors.purple },
  tileEmpty: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.6)',
    shadowOpacity: 0,
    elevation: 0,
    justifyContent: 'center',
  },
  crown: { position: 'absolute', top: -14, fontSize: 24 },
  tileAction: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileActionDisabled: { opacity: 0.45 },
  tileNameFrame: { width: '90%', minWidth: 0, overflow: 'hidden' },
  tileName: { fontFamily: fonts.bold, fontSize: 16, color: colors.night, textAlign: 'center' },
  tileSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  tokenPill: { backgroundColor: colors.yellow, borderRadius: 10, borderWidth: 2, borderColor: colors.night, paddingHorizontal: 8 },
  tokenText: { fontFamily: fonts.bold, fontSize: 12, color: colors.night },
  emptyText: { fontFamily: fonts.semibold, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  footer: { paddingHorizontal: 18, paddingBottom: 10, paddingTop: 6, gap: 8 },
  waitBox: {
    backgroundColor: 'rgba(43,27,74,0.6)',
    borderRadius: 22,
    paddingVertical: 20,
    alignItems: 'center',
  },
  waitText: { fontFamily: fonts.bold, color: colors.white, fontSize: 18 },
  error: { fontFamily: fonts.semibold, color: colors.yellow, textAlign: 'center' },
  countPill: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.night,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  countPillReady: { backgroundColor: '#C8F7C5' },
  countText: { fontFamily: fonts.bold, fontSize: 14, color: colors.night },
  countTextReady: { color: colors.darkGreen },
});
