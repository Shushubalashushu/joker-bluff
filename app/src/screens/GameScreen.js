import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import PlayfulBackground from '../components/common/PlayfulBackground';
import Avatar from '../components/common/Avatar';
import { AUDIO_TOGGLE_SIZE } from '../components/AudioToggle';
import LanguageToggle from '../components/LanguageToggle';
import TimerBar from '../components/game/TimerBar';
import OpponentSeat from '../components/game/OpponentSeat';
import TableArea from '../components/game/TableArea';
import ActionPanel from '../components/game/ActionPanel';
import FannedHand from '../components/game/FannedHand';
import IsolationOverlay, { DimLayer } from '../components/game/IsolationOverlay';
import GameToast from '../components/game/GameToast';
import GameOverModal from '../components/game/GameOverModal';
import LieDeyeOverlay from '../components/game/LieDeyeOverlay';
import { useGame } from '../context/GameContext';
import { useAudio, SFX } from '../context/AudioContext';
import { useI18n } from '../i18n';
import useResponsive from '../hooks/useResponsive';
import { PHASES } from '../constants/events';
import { TOUCH_TELEMETRY } from '../config';
import { describeEvent } from '../utils/describeEvent';
import { colors, fonts, gradients, cartoonShadow } from '../theme';
import { viewport, verticalScrollProps } from '../theme/layout';

const TABLE_PADDING = 4;
const TABLE_GAP = 2;

/** Splits opponents (clockwise from my left) into left column / top row / right column. */
function layoutSeats(seats, myId) {
  const me = seats.findIndex((s) => s.id === myId);
  const ordered = me === -1 ? seats : [...seats.slice(me + 1), ...seats.slice(0, me)];
  const n = ordered.length;
  const side = n >= 6 ? 2 : n >= 4 ? 1 : 0;
  return {
    left: ordered.slice(0, side).reverse(), // first seat after me sits bottom-left
    top: ordered.slice(side, n - side),
    right: ordered.slice(n - side),
    compact: n >= 5,
  };
}

/** Fisher–Yates over card ids, re-rolled until the order actually changes (if possible). */
function shuffledDifferent(ids) {
  const same = (a) => a.every((id, i) => id === ids[i]);
  let out = ids.slice();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    out = ids.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (!same(out)) break;
  }
  return out;
}

/** Reorders `hand` by `order` (array of ids) only when it is an exact permutation of it. */
function applyOrder(hand, order) {
  if (!order || order.length !== hand.length) return hand;
  const byId = new Map(hand.map((c) => [c.id, c]));
  const out = [];
  for (const id of order) {
    const card = byId.get(id);
    if (!card) return hand; // hand changed under us (card given/received) -> trust the server
    out.push(card);
    byId.delete(id);
  }
  return out;
}

/** Small round pill used for the hand tools (Anti-spy, Shuffle). */
function ToolButton({ icon, label, onPress, active = false, accessibilityLabel }) {
  const { textStyle } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.tool, active && styles.toolActive, pressed && styles.toolPressed]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.white : colors.night} />
      {!!label && <Text style={[styles.toolText, active && { color: colors.white }, textStyle]}>{label}</Text>}
    </Pressable>
  );
}

export default function GameScreen() {
  const {
    room,
    game,
    playerId,
    connection,
    clockOffset,
    events,
    knownPlayers,
    concealed,
    requestCard,
    offerCard,
    decide,
    playAgain,
    leaveRoom,
    endGame,
    spendLieDeye,
    shuffleHand,
    setConcealed,
  } = useGame();
  const { playSfx } = useAudio();
  const { t, tError, textStyle } = useI18n();
  const r = useResponsive();

  const [selectedCardId, setSelectedCardId] = useState(null);
  const [busyMove, setBusyMove] = useState(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [toast, setToast] = useState(null);
  const [lieDeyeOpen, setLieDeyeOpen] = useState(false);
  const [claimMove, setClaimMove] = useState(null);
  // Optimistic shuffle: local id order shown until the server's game_state catches up.
  const [localOrder, setLocalOrder] = useState(null);
  const [shuffleNonce, setShuffleNonce] = useState(0);

  const matchId = game?.matchId;
  const moveKey = matchId ? `${matchId}:${game.step}` : null;
  const claimNoCard = moveKey !== null && claimMove === moveKey;
  const moveRef = useRef(moveKey);
  const matchRef = useRef(matchId);
  const pendingMove = useRef(null);
  moveRef.current = moveKey;
  matchRef.current = matchId;
  const busy = connection !== 'online' || (!!moveKey && busyMove === moveKey);
  const serverHand = game?.hand;
  const displayHand = useMemo(
    () => applyOrder(serverHand || [], localOrder?.matchId === matchId ? localOrder?.order : null),
    [serverHand, localOrder, matchId]
  );
  const displayHandRef = useRef(displayHand);
  displayHandRef.current = displayHand;

  const playersById = useMemo(() => Object.fromEntries((room?.players || []).map((p) => [p.id, p])), [room]);
  const nameOf = useCallback(
    (id) => playersById[id]?.nickname ?? knownPlayers[id]?.nickname ?? t('common.aPlayer'),
    [playersById, knownPlayers, t]
  );

  // Clear selection whenever the turn/offer step changes or the card leaves my hand.
  useEffect(() => {
    setSelectedCardId(null);
  }, [moveKey]);

  // Server events -> toast + sfx hooks.
  useEffect(() => {
    const event = events.find((e) => e.type === 'game_over')
      ?? events.find((e) => e.type === 'card_transferred' && e.claimedNoCard)
      ?? events[events.length - 1];
    if (!event) return;
    setToast({ event, key: `${event.type}-${event.at}` });
    const sfx = {
      card_offered: SFX.CARD_SLIDE,
      offer_rejected: SFX.REJECT,
      card_transferred: event.forced ? SFX.FORCED : SFX.ACCEPT,
      lie_deye_used: SFX.CARD_FLIP,
      game_over: event.winnerId === playerId ? SFX.WIN : event.loserId === playerId ? SFX.LOSE : null,
    }[event.type];
    if (sfx) playSfx(sfx);
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ Lie Deye telemetry (giver side)
  // While *I* choose which card to offer, record where my finger rests/moves on my
  // cards. It's sent with the offer; the receiver only sees it if they spend a token.
  const isHolder = !!game && playerId === game.holderId;
  const recording = !!game && isHolder && game.phase === PHASES.OFFER;
  const phaseStartedAt = game?.phaseStartedAt;
  const touchesRef = useRef([]);
  const cardPresses = useRef(new Map());
  const lastSampleAt = useRef(0);
  useEffect(() => {
    touchesRef.current = [];
    cardPresses.current.clear();
    lastSampleAt.current = 0;
  }, [moveKey]);

  const onTouchSample = useCallback(
    (cardId, u, v, absX, absY, isDown) => {
      if (!recording || moveRef.current !== moveKey) return;
      const now = Date.now();
      if (!isDown && now - lastSampleAt.current < TOUCH_TELEMETRY.THROTTLE_MS) return;
      if (touchesRef.current.length >= TOUCH_TELEMETRY.MAX_SAMPLES) return;
      lastSampleAt.current = now;
      touchesRef.current.push({
        c: cardId, // card id -> the server maps it to the card's slot at offer time (shuffle-proof)
        u,
        v,
        x: absX / r.width,
        y: absY / r.height,
        t: Math.max(0, now + clockOffset - (phaseStartedAt ?? now + clockOffset)),
      });
    },
    [recording, moveKey, phaseStartedAt, clockOffset, r.width, r.height]
  );

  const onCardPress = useCallback((cardId, duration) => {
    if (recording && moveRef.current === moveKey) cardPresses.current.set(cardId, duration);
  }, [recording, moveKey]);

  // ------------------------------------------------------------ Lie Deye overlay (receiver side)
  const lieDeyeKey = game?.lieDeye ? moveKey : null;
  const seenLieDeye = useRef(null);
  useEffect(() => {
    if (!lieDeyeKey) {
      setLieDeyeOpen(false);
      return;
    }
    if (seenLieDeye.current !== lieDeyeKey) {
      seenLieDeye.current = lieDeyeKey;
      setLieDeyeOpen(true); // auto-open the VAR review the moment the stats arrive
    }
  }, [lieDeyeKey]);

  // ------------------------------------------------------------ actions
  const run = useCallback(async (fn) => {
    if (!moveKey || moveRef.current !== moveKey || pendingMove.current === moveKey) return null;
    pendingMove.current = moveKey;
    setBusyMove(moveKey);
    try {
      const res = await fn();
      if (!res.ok && moveRef.current === moveKey) setToast({ error: res, key: Date.now() });
      return res.ok;
    } finally {
      if (pendingMove.current === moveKey) {
        pendingMove.current = null;
        setBusyMove(null);
      }
    }
  }, [moveKey]);

  const onRequest = useCallback((rank) => run(() => requestCard(rank)), [run, requestCard]);
  const onDecide = useCallback((accept, offerIndex) => run(() => decide(accept, offerIndex)), [run, decide]);
  const onLieDeye = useCallback(() => run(spendLieDeye), [run, spendLieDeye]);
  const onOffer = useCallback(
    async (cardId, dragDuration) => {
      if (!cardId) return;
      const pressDurationMs = dragDuration ?? cardPresses.current.get(cardId);
      const ok = await run(() => offerCard(cardId, {
        touches: touchesRef.current.slice(), claimedNoCard: claimNoCard, pressDurationMs,
      }));
      if (!ok && moveRef.current === moveKey) setResetNonce((n) => n + 1);
    },
    [run, offerCard, moveKey, claimNoCard]
  );
  const onSelect = useCallback(
    (id) => {
      playSfx(SFX.TAP);
      setSelectedCardId((cur) => (cur === id ? null : id));
    },
    [playSfx]
  );
  const onDragStart = useCallback((id) => setSelectedCardId(id), []);

  // Shuffle: available at ANY time (doesn't use `busy`, isn't blocked by turns).
  // Optimistic: we pick the new order locally, render it immediately (so the cards
  // visibly move even on a slow ngrok link), and send it to the server, which
  // validates + stores that exact order and echoes it back in game_state.
  const onShuffle = useCallback(async () => {
    const ids = displayHandRef.current.map((c) => c.id);
    if (ids.length < 2) return;
    const order = shuffledDifferent(ids);
    const pendingOrder = { matchId, order };
    playSfx(SFX.CARD_SLIDE);
    setLocalOrder(pendingOrder);
    setShuffleNonce((n) => n + 1);
    const res = await shuffleHand(order);
    if (!res.ok && matchRef.current === matchId) setToast({ error: res, key: Date.now() });
    // The server's game_state (emitted before the ack) now carries the order;
    // drop the local override only if nothing newer replaced it meanwhile.
    setLocalOrder((cur) => (cur === pendingOrder ? null : cur));
  }, [shuffleHand, playSfx, matchId]);

  // Anti-spy: flip my whole hand face-down in place (local only).
  const onToggleConceal = useCallback(() => {
    playSfx(SFX.CARD_FLIP);
    setConcealed();
  }, [playSfx, setConcealed]);

  const finished = game?.phase === PHASES.FINISHED;
  const isHost = room?.hostId === playerId;

  const confirmLeave = () =>
    Alert.alert(
      t('game.leaveTitle'),
      t(finished ? 'game.leaveFinished' : 'game.leaveMid'),
      [
        { text: t('game.stay'), style: 'cancel' },
        {
          text: t('game.leave'),
          style: 'destructive',
          onPress: async () => {
            const res = await leaveRoom();
            if (!res.ok) setToast({ error: res, key: Date.now() });
          },
        },
      ]
    );

  const confirmEnd = () =>
    Alert.alert(t('game.endTitle'), t('game.endBody'), [
      { text: t('game.keepPlaying'), style: 'cancel' },
      {
        text: t('game.endGame'),
        style: 'destructive',
        onPress: async () => {
          const res = await endGame();
          if (!res.ok) setToast({ error: res, key: Date.now() });
        },
      },
    ]);

  if (!game) {
    return (
      <View style={styles.root}>
        <PlayfulBackground colors={gradients.game} />
        <SafeAreaView style={[styles.safe, styles.loading]} edges={['top', 'bottom', 'left', 'right']}>
          <Text style={[styles.loadingText, textStyle]}>{t('game.loading')}</Text>
        </SafeAreaView>
      </View>
    );
  }

  const isolated = game.isolated; // server says I'm not part of this transaction
  const canOffer = !finished && isHolder && game.phase === PHASES.OFFER && !busy;
  const { left, top, right, compact: crowded } = layoutSeats(game.seats, playerId);
  const me = playersById[playerId];
  const mySeat = game.seats.find((s) => s.id === playerId);
  const myRole = isHolder ? 'GIVER' : playerId === game.activeId ? 'ASKER' : null;
  const choosing = myRole === 'ASKER' && game.phase === PHASES.DECISION && game.offers.length === 2;
  const newCardId = game.lastTransfer && game.lastTransfer.turn === game.turn - 1 ? game.lastTransfer.cardId : null;
  const sideCount = Number(left.length > 0) + Number(right.length > 0);
  const sideWidth = Math.min(78, Math.floor(r.availW / 5));
  const tableWidth = r.availW - 2 * TABLE_PADDING - sideCount * (sideWidth + TABLE_GAP);
  const tight = r.compact || (crowded && r.tier !== 'tall');
  const compactChoice = choosing && tight;
  const seatSize = compactChoice ? 32 : crowded ? Math.min(r.seatAvatar, 44) : r.seatAvatar;

  const timerLabel = finished
    ? t('timer.over')
    : game.phase === PHASES.REQUEST
    ? t('timer.asking', { name: nameOf(game.activeId) })
    : game.phase === PHASES.OFFER
    ? t('timer.offering', { name: nameOf(game.holderId) })
    : t('timer.deciding', { name: nameOf(game.activeId) });

  const renderSeat = (seat, width = 78) => {
    const inTransaction = seat.id === game.holderId || seat.id === game.activeId;
    return (
      <OpponentSeat
        key={seat.id}
        seat={seat}
        player={playersById[seat.id] ?? knownPlayers[seat.id]}
        spotlight={!finished && inTransaction}
        muted={!finished && !inTransaction}
        acting={!finished && seat.id === game.actorId}
        role={finished ? null : seat.isHolder ? 'GIVER' : seat.isActive ? 'ASKER' : null}
        compact={crowded || compactChoice}
        size={Math.min(seatSize, width - 22)}
        width={width}
      />
    );
  };

  return (
    <View style={styles.root}>
      <PlayfulBackground colors={gradients.game} decorations={false} />
      {/* ISOLATION MODE: dims the whole backdrop for players outside the transaction */}
      <IsolationOverlay active={isolated} />

      {/* All four edges: clears the notch / Dynamic Island, the home indicator and landscape cut-outs */}
      <SafeAreaView pointerEvents="box-none" style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        {/* Header: Leave (everyone) · room chip · End (host) · space for the audio toggle */}
        <View style={styles.header}>
          <Pressable onPress={confirmLeave} style={styles.iconBtn} hitSlop={8} accessibilityLabel={t('game.a11yLeave')}>
            <Ionicons name="exit-outline" size={22} color={colors.night} />
          </Pressable>
          <View style={styles.headerChip}>
            <Text style={styles.headerChipText} numberOfLines={1} adjustsFontSizeToFit>{room.code}</Text>
            <Text style={[styles.headerChipText, styles.headerDetails, textStyle]}>
              {t('game.headerDetails', { turn: game.turn, cards: game.deckSize })}
            </Text>
          </View>
          <LanguageToggle compact />
          {isHost && !finished ? (
            <Pressable onPress={confirmEnd} style={styles.endBtn} hitSlop={6} accessibilityLabel={t('game.a11yEnd')}>
              <Ionicons name="stop-circle" size={16} color={colors.white} />
              {r.availW >= 400 && <Text style={[styles.endText, textStyle]}>{t('game.end')}</Text>}
            </Pressable>
          ) : null}
          <View style={{ width: AUDIO_TOGGLE_SIZE }} />
        </View>

        <View style={[styles.timer, { marginTop: tight ? 6 : 10 }]}>
          <TimerBar
            deadline={game.deadline}
            duration={game.phaseDuration}
            clockOffset={clockOffset}
            label={timerLabel}
            frozen={game.timeFrozen}
            compact={tight}
          />
        </View>

        <GameToast message={toast?.error ? `⚠️ ${tError(toast.error)}` : describeEvent(toast?.event, nameOf, playerId, t)} eventKey={toast?.key} />

        <ScrollView {...verticalScrollProps} style={styles.board} contentContainerStyle={styles.boardContent} showsVerticalScrollIndicator={false}>
          {/* Opponents (top) */}
          <View style={[styles.topRow, compactChoice && styles.topRowCompact, { gap: r.gap }]}>{top.map((seat) => renderSeat(seat))}</View>

          {/* Opponents (sides) + table */}
          <View style={[styles.middle, compactChoice && styles.middleCompact]}>
            {!!left.length && <View style={[styles.sideCol, { width: sideWidth, gap: r.gap }]}>{left.map((seat) => renderSeat(seat, sideWidth))}</View>}
            <View style={styles.tableWrap}>
              <TableArea
                game={game}
                nameOf={nameOf}
                myId={playerId}
                cardSize={compactChoice ? 'xs' : choosing ? 'sm' : r.tableCard}
                width={tableWidth}
                concealed={concealed}
                compact={tight || choosing}
              />
            </View>
            {!!right.length && <View style={[styles.sideCol, { width: sideWidth, gap: r.gap }]}>{right.map((seat) => renderSeat(seat, sideWidth))}</View>}
          </View>

          <View pointerEvents="box-none" style={[styles.bottom, { gap: tight ? 4 : 8 }]}>
            {!finished && (
              <ActionPanel
                game={game}
                myId={playerId}
                nameOf={nameOf}
                selectedCardId={selectedCardId}
                busy={busy}
                onRequest={onRequest}
                onOffer={onOffer}
                claimNoCard={claimNoCard}
                onToggleNoCard={() => setClaimMove(claimNoCard ? null : moveKey)}
                onDecide={onDecide}
                onLieDeye={onLieDeye}
                onOpenLieDeye={() => setLieDeyeOpen(true)}
                compact={tight || choosing}
              />
            )}

            {/* My seat + hand tools + fanned hand */}
            <View pointerEvents="box-none" style={styles.handArea}>
              <View style={styles.meRow}>
                <View style={styles.meInfo}>
                  <Avatar avatarId={me?.avatarId ?? 0} size={30} ring={myRole ? colors.yellow : colors.night} />
                  <Text style={[styles.meName, textStyle]}>{t('common.you')}</Text>
                  {!!myRole && (
                    <View style={[styles.meRole, { backgroundColor: myRole === 'GIVER' ? colors.pink : colors.teal }]}>
                      <Text style={[styles.meRoleText, textStyle]}>{t(`role.${myRole}`)}</Text>
                    </View>
                  )}
                  {isolated && (
                    <View style={styles.meMuted}>
                      <Ionicons name="volume-mute" size={12} color={colors.white} />
                      <Text style={[styles.meRoleText, textStyle]}>{t('role.muted')}</Text>
                    </View>
                  )}
                  {!!mySeat && (
                    <View style={styles.meTokens}>
                      <Text style={styles.meTokensText}>👁️ {mySeat.tokens}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.tools}>
                  <ToolButton
                    icon={concealed ? 'eye-off' : 'eye'}
                    label={t(concealed ? 'tools.hidden' : 'tools.hide')}
                    active={concealed}
                    onPress={onToggleConceal}
                    accessibilityLabel={t(concealed ? 'tools.a11yShow' : 'tools.a11yHide')}
                  />
                  {!finished && (
                    <ToolButton icon="shuffle" label={r.availW >= 375 ? t('tools.shuffle') : null} onPress={onShuffle} accessibilityLabel={t('tools.a11yShuffle')} />
                  )}
                </View>
              </View>
              <FannedHand
                cards={displayHand}
                shuffleNonce={shuffleNonce}
                selectedId={selectedCardId}
                onSelect={onSelect}
                onDragStart={onDragStart}
                canSelect={canOffer}
                canDrag={canOffer}
                onDragOffer={onOffer}
                onTouchSample={recording ? onTouchSample : undefined}
                onCardPress={recording ? onCardPress : undefined}
                newCardId={newCardId}
                concealed={concealed}
                resetKey={`${moveKey}:${resetNonce}`}
                size={tight ? 'sm' : r.handCard}
                width={r.availW}
                compact={compactChoice}
              />
              <DimLayer active={isolated} style={styles.handDim} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <LieDeyeOverlay
        visible={lieDeyeOpen && !!game.lieDeye && game.phase === PHASES.DECISION}
        data={game.lieDeye}
        giverName={nameOf(game.lieDeye?.giverId)}
        game={game}
        clockOffset={clockOffset}
        busy={busy}
        width={r.availW}
        onDecide={onDecide}
        onClose={() => setLieDeyeOpen(false)}
      />

      <GameOverModal
        key={matchId}
        visible={finished}
        result={game.result}
        lastTransfer={game.lastTransfer}
        economy={room.lieDeye}
        players={game.seats.map(({ id }) => playersById[id] ?? { id, ...knownPlayers[id] })}
        seats={game.seats}
        myId={playerId}
        isHost={isHost}
        onPlayAgain={playAgain}
        onEndGame={endGame}
        onLeave={leaveRoom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: viewport,
  safe: viewport,
  loading: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: fonts.bold, fontSize: 26, color: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingTop: 4 },
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
  headerChip: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    paddingHorizontal: 5,
    paddingVertical: 6,
  },
  headerChipText: { fontFamily: fonts.bold, color: colors.white, fontSize: 13, textAlign: 'center' },
  headerDetails: { fontSize: 11 },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.red,
    ...cartoonShadow,
  },
  endText: { fontFamily: fonts.bold, color: colors.white, fontSize: 13 },
  timer: { paddingHorizontal: 14 },
  board: { flex: 1, marginTop: 2 },
  boardContent: { flexGrow: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 12 },
  topRowCompact: { paddingTop: 5 },
  middle: { flexGrow: 1, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: TABLE_PADDING, paddingVertical: 6, gap: TABLE_GAP },
  middleCompact: { paddingVertical: 3 },
  sideCol: { flexShrink: 0, justifyContent: 'center' },
  tableWrap: { flex: 1, minWidth: 0, justifyContent: 'center' },
  bottom: {},
  handArea: { position: 'relative', paddingHorizontal: 12 },
  meRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 4 },
  meInfo: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 },
  meName: { fontFamily: fonts.bold, color: colors.white, fontSize: 14 },
  meRole: { borderRadius: 8, borderWidth: 2, borderColor: colors.night, paddingHorizontal: 6, paddingVertical: 1 },
  meMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.red,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  meRoleText: { fontFamily: fonts.bold, color: colors.white, fontSize: 10, letterSpacing: 0.5 },
  meTokens: { backgroundColor: colors.yellow, borderRadius: 8, borderWidth: 2, borderColor: colors.night, paddingHorizontal: 5 },
  meTokensText: { fontFamily: fonts.bold, color: colors.night, fontSize: 11 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 36,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.night,
    backgroundColor: colors.white,
    justifyContent: 'center',
    ...cartoonShadow,
  },
  toolActive: { backgroundColor: colors.purple },
  toolPressed: { transform: [{ translateY: 2 }], shadowOpacity: 0 },
  toolText: { fontFamily: fonts.bold, fontSize: 12, color: colors.night },
  handDim: { borderRadius: 24 },
});
