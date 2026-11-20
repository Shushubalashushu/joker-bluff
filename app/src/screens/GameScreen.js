import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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

// (The old "Reveal Four of a Kind!" DeclareButton is gone: the server now ends the
// game automatically when a player passes their 5th card and holds 4 of a kind.)

/** Small round pill used for the hand tools (Anti-spy, Shuffle). */
function ToolButton({ icon, label, onPress, active = false, accessibilityLabel }) {
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
      {!!label && <Text style={[styles.toolText, active && { color: colors.white }]}>{label}</Text>}
    </Pressable>
  );
}

export default function GameScreen() {
  const {
    room,
    game,
    playerId,
    clockOffset,
    lastEvent,
    knownPlayers,
    concealed,
    requestCard,
    offerCard,
    decide,
    declareWin,
    playAgain,
    leaveRoom,
    endGame,
    spendLieDeye,
    shuffleHand,
    setConcealed,
  } = useGame();
  const { playSfx } = useAudio();
  const r = useResponsive();

  const [selectedCardId, setSelectedCardId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [toast, setToast] = useState({ message: null, key: 0 });
  const [lieDeyeOpen, setLieDeyeOpen] = useState(false);
  // Optimistic shuffle: local id order shown until the server's game_state catches up.
  const [localOrder, setLocalOrder] = useState(null);
  const [shuffleNonce, setShuffleNonce] = useState(0);

  const serverHand = game?.hand;
  const displayHand = useMemo(() => applyOrder(serverHand || [], localOrder), [serverHand, localOrder]);
  const displayHandRef = useRef(displayHand);
  displayHandRef.current = displayHand;

  const playersById = useMemo(() => Object.fromEntries((room?.players || []).map((p) => [p.id, p])), [room]);
  const nameOf = useCallback(
    (id) => playersById[id]?.nickname ?? knownPlayers[id]?.nickname ?? '???',
    [playersById, knownPlayers]
  );

  // Clear selection whenever the turn/offer step changes or the card leaves my hand.
  const offerCount = game?.offers.length ?? 0;
  useEffect(() => {
    setSelectedCardId(null);
  }, [game?.phase, game?.turn, offerCount]);

  // Server events -> toast + sfx hooks.
  useEffect(() => {
    if (!lastEvent) return;
    setToast({ message: describeEvent(lastEvent, nameOf, playerId), key: lastEvent.at });
    const sfx = {
      card_offered: SFX.CARD_SLIDE,
      offer_rejected: SFX.REJECT,
      card_transferred: lastEvent.forced ? SFX.FORCED : SFX.ACCEPT,
      lie_deye_used: SFX.CARD_FLIP,
      game_over: lastEvent.winnerId === playerId ? SFX.WIN : SFX.LOSE,
    }[lastEvent.type];
    if (sfx) playSfx(sfx);
  }, [lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ Lie Deye telemetry (giver side)
  // While *I* choose which card to offer, record where my finger rests/moves on my
  // cards. It's sent with the offer; the receiver only sees it if they spend a token.
  const isHolder = !!game && playerId === game.holderId;
  const recording = !!game && isHolder && game.phase === PHASES.OFFER;
  const touchesRef = useRef([]);
  const lastSampleAt = useRef(0);
  const offerStepKey = game ? `${game.turn}-${offerCount}-${game.phase}` : '';
  useEffect(() => {
    touchesRef.current = [];
    lastSampleAt.current = 0;
  }, [offerStepKey]);

  const onTouchSample = useCallback(
    (cardId, u, v, absX, absY, isDown) => {
      if (!recording || !game) return;
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
        t: Math.max(0, now + clockOffset - (game.phaseStartedAt || now + clockOffset)), // ms since OFFER began (server clock)
      });
    },
    [recording, game, clockOffset, r.width, r.height]
  );

  // ------------------------------------------------------------ Lie Deye overlay (receiver side)
  const lieDeyeKey = game?.lieDeye ? `${game.turn}-${game.lieDeye.offerNumber}` : null;
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
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setToast({ message: `⚠️ ${res.error}`, key: Date.now() });
    return res.ok;
  }, []);

  const onRequest = useCallback((rank) => run(() => requestCard(rank)), [run, requestCard]);
  const onDecide = useCallback(
    async (accept) => {
      const ok = await run(() => decide(accept));
      if (ok) setLieDeyeOpen(false);
    },
    [run, decide]
  );
  const onDeclare = useCallback(() => run(declareWin), [run, declareWin]);
  const onLieDeye = useCallback(() => run(spendLieDeye), [run, spendLieDeye]);
  const onOffer = useCallback(
    async (cardId) => {
      if (!cardId) return;
      const ok = await run(() => offerCard(cardId, touchesRef.current.slice()));
      if (!ok) setResetNonce((n) => n + 1); // bring a thrown card back into the fan
    },
    [run, offerCard]
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
    playSfx(SFX.CARD_SLIDE);
    setLocalOrder(order);
    setShuffleNonce((n) => n + 1);
    const res = await shuffleHand(order);
    if (!res.ok) setToast({ message: `⚠️ ${res.error}`, key: Date.now() });
    // The server's game_state (emitted before the ack) now carries the order;
    // drop the local override only if nothing newer replaced it meanwhile.
    setLocalOrder((cur) => (cur === order ? null : cur));
  }, [shuffleHand, playSfx]);

  // Anti-spy: flip my whole hand face-down in place (local only).
  const onToggleConceal = useCallback(() => {
    playSfx(SFX.CARD_FLIP);
    setConcealed();
  }, [playSfx, setConcealed]);

  const finished = game?.phase === PHASES.FINISHED;
  const isHost = room?.hostId === playerId;

  const confirmLeave = () =>
    Alert.alert(
      'Leave game?',
      finished
        ? 'You will leave this lobby.'
        : 'Leaving ends the match for EVERYONE and sends the table back to the lobby.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: leaveRoom },
      ]
    );

  const confirmEnd = () =>
    Alert.alert('End game for everyone?', 'The match stops now and all players return to the lobby.', [
      { text: 'Keep playing', style: 'cancel' },
      {
        text: 'End game',
        style: 'destructive',
        onPress: async () => {
          const res = await endGame();
          if (!res.ok) setToast({ message: `⚠️ ${res.error}`, key: Date.now() });
        },
      },
    ]);

  if (!game) {
    return (
      <View style={styles.root}>
        <PlayfulBackground colors={gradients.game} />
        <SafeAreaView style={[styles.safe, styles.loading]} edges={['top', 'bottom', 'left', 'right']}>
          <Text style={styles.loadingText}>Shuffling… 🃏</Text>
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
  const newCardId = game.lastTransfer && game.lastTransfer.turn === game.turn - 1 ? game.lastTransfer.cardId : null;
  const seatSize = crowded ? Math.min(r.seatAvatar, 44) : r.seatAvatar;
  const tight = r.compact || (crowded && r.tier !== 'tall');

  const timerLabel = finished
    ? 'Round over'
    : game.phase === PHASES.REQUEST
    ? `${nameOf(game.activeId)} is asking`
    : game.phase === PHASES.OFFER
    ? `${nameOf(game.holderId)} is offering`
    : `${nameOf(game.activeId)} is deciding`;

  const renderSeat = (seat) => {
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
        compact={crowded}
        size={seatSize}
      />
    );
  };

  return (
    <View style={styles.root}>
      <PlayfulBackground colors={gradients.game} decorations={false} />
      {/* ISOLATION MODE: dims the whole backdrop for players outside the transaction */}
      <IsolationOverlay active={isolated} />

      {/* All four edges: clears the notch / Dynamic Island, the home indicator and landscape cut-outs */}
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        {/* Header: Leave (everyone) · room chip · End (host) · space for the audio toggle */}
        <View style={styles.header}>
          <Pressable onPress={confirmLeave} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Leave game">
            <Ionicons name="exit-outline" size={22} color={colors.night} />
          </Pressable>
          <View style={styles.headerChip}>
            <Text style={styles.headerChipText} numberOfLines={1}>
              {room.code} · Turn {game.turn} · {game.deckSize} cards
            </Text>
          </View>
          {isHost && !finished ? (
            <Pressable onPress={confirmEnd} style={styles.endBtn} hitSlop={6} accessibilityLabel="End game for everyone">
              <Ionicons name="stop-circle" size={16} color={colors.white} />
              <Text style={styles.endText}>End</Text>
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

        <View style={styles.toastAnchor}>
          <GameToast message={toast.message} eventKey={toast.key} />
        </View>

        {/* Opponents (top) */}
        <View style={[styles.topRow, { marginTop: tight ? 6 : 12, gap: r.gap }]}>{top.map(renderSeat)}</View>

        {/* Opponents (sides) + table */}
        <View style={styles.middle}>
          <View style={[styles.sideCol, { gap: r.gap }]}>{left.map(renderSeat)}</View>
          <View style={styles.tableWrap}>
            <TableArea
              game={game}
              nameOf={nameOf}
              myId={playerId}
              cardSize={r.tableCard}
              concealed={concealed}
              compact={tight}
            />
          </View>
          <View style={[styles.sideCol, { gap: r.gap }]}>{right.map(renderSeat)}</View>
        </View>

        <View style={[styles.bottom, { gap: tight ? 4 : 8 }]}>
          {!finished && (
            <ActionPanel
              game={game}
              myId={playerId}
              nameOf={nameOf}
              selectedCardId={selectedCardId}
              busy={busy}
              onRequest={onRequest}
              onOffer={onOffer}
              onDecide={onDecide}
              onLieDeye={onLieDeye}
              onOpenLieDeye={() => setLieDeyeOpen(true)}
              compact={tight}
            />
          )}

          {/* When the hand is hidden, a big gold banner would tip off onlookers - use a discreet icon instead. */}
          {game.canDeclare && !concealed && <DeclareButton onPress={onDeclare} busy={busy} compact={tight} />}

          {/* My seat + hand tools + fanned hand */}
          <View style={styles.handArea}>
            <View style={styles.meRow}>
              <View style={styles.meInfo}>
                <Avatar avatarId={me?.avatarId ?? 0} size={30} ring={myRole ? colors.yellow : colors.night} />
                <Text style={styles.meName}>You</Text>
                {!!myRole && (
                  <View style={[styles.meRole, { backgroundColor: myRole === 'GIVER' ? colors.pink : colors.teal }]}>
                    <Text style={styles.meRoleText}>{myRole}</Text>
                  </View>
                )}
                {isolated && (
                  <View style={styles.meMuted}>
                    <Ionicons name="volume-mute" size={12} color={colors.white} />
                    <Text style={styles.meRoleText}>MUTED</Text>
                  </View>
                )}
                {!!mySeat && (
                  <View style={styles.meTokens}>
                    <Text style={styles.meTokensText}>👁️ {mySeat.tokens}</Text>
                  </View>
                )}
              </View>
              <View style={styles.tools}>
                {game.canDeclare && concealed && (
                  <ToolButton icon="trophy" onPress={onDeclare} accessibilityLabel="Reveal four of a kind" active />
                )}
                <ToolButton
                  icon={concealed ? 'eye-off' : 'eye'}
                  label={concealed ? 'Hidden' : 'Hide'}
                  active={concealed}
                  onPress={onToggleConceal}
                  accessibilityLabel={concealed ? 'Show my cards' : 'Hide my cards (anti-spy)'}
                />
                {!finished && (
                  <ToolButton icon="shuffle" label={r.availW >= 375 ? 'Shuffle' : null} onPress={onShuffle} accessibilityLabel="Shuffle my hand" />
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
              newCardId={newCardId}
              concealed={concealed}
              resetNonce={resetNonce}
              size={r.handCard}
              width={r.availW}
            />
            <DimLayer active={isolated} style={styles.handDim} />
          </View>
        </View>
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
        visible={finished}
        result={game.result}
        players={room.players.length ? room.players : Object.entries(knownPlayers).map(([id, p]) => ({ id, ...p }))}
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
  root: { flex: 1 },
  safe: { flex: 1 },
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
    flexShrink: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerChipText: { fontFamily: fonts.bold, color: colors.white, fontSize: 13, letterSpacing: 0.5 },
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
  toastAnchor: { height: 0, zIndex: 60, marginTop: 6 },
  topRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', paddingHorizontal: 8 },
  middle: { flex: 1, minHeight: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  sideCol: { justifyContent: 'center' },
  tableWrap: { flex: 1, justifyContent: 'center' },
  bottom: {},
  declareWrap: { paddingHorizontal: 24 },
  handArea: { position: 'relative', paddingHorizontal: 12 },
  meRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 4 },
  meInfo: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
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
