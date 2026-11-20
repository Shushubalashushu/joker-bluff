# 🃏 Joker Bluff

Real-time multiplayer bluffing card game: an **Expo (React Native)** app and a **Node.js + Socket.IO** server. There's no database. All rooms and guest sessions are kept in memory on the server.

```
joker_app/
├── server/                         # Node.js + Express + Socket.IO ("source of truth")
│   ├── src/
│   │   ├── index.js                # HTTP + Socket.IO bootstrap, /health, cleanup loop
│   │   ├── config.js               # ports, timers, limits (env-overridable)
│   │   ├── shared/events.js        # socket event names + phases
│   │   ├── game/
│   │   │   ├── deck.js             # dynamic deck: N ranks × 4 + 1 Joker
│   │   │   └── JokerBluffGame.js   # pure state machine (3-offer rule, win check, redaction)
│   │   ├── rooms/
│   │   │   ├── Room.js             # lobby membership, host, phase timer, per-player broadcast
│   │   │   └── RoomManager.js      # in-memory room registry + 5-char codes
│   │   ├── sessions/SessionStore.js# guest sessions (secret token ↔ public playerId)
│   │   ├── socket/registerSocketHandlers.js
│   │   └── utils/sanitize.js
│   └── test/                       # node:test — engine unit tests + socket e2e test
└── app/                            # Expo app
    ├── App.js                      # providers, fonts, server-state-driven routing
    └── src/
        ├── config.js               # server URL resolution
        ├── constants/              # events, avatars
        ├── theme/                  # cartoon palette, gradients, Fredoka font
        ├── services/socket.js      # socket singleton, ack helper, clock sync
        ├── context/                # Profile, Audio, Game (server mirror)
        ├── hooks/useServerCountdown.js
        ├── utils/describeEvent.js
        ├── screens/                # Lobby, WaitingRoom, Game
        └── components/
            ├── AudioToggle.js, ConnectionBanner.js
            ├── common/             # CartoonButton, Avatar, PlayfulBackground
            ├── lobby/              # ProfileCard, AvatarPickerModal, PrivateGameModal
            └── game/               # PlayingCard, FannedHand, OpponentSeat, TableArea,
                                    # ActionPanel, TimerBar, IsolationOverlay, GameToast, GameOverModal
```

## Running it

### Server
```bash
cd server
npm install
npm start            # → :3001   (npm run dev for watch mode)
npm test             # engine unit tests + socket integration test
```
Environment overrides: `PORT`, `CORS_ORIGIN`, `MIN_PLAYERS` (can't go below 4), `DEV_TESTING_MODE`, `TIMER_REQUEST_MS`, `TIMER_OFFER_MS`, `TIMER_DECISION_MS`, `TIMER_AFK_MS`, `TIMER_LIE_DEYE_MS`, `LIE_DEYE_STARTING_TOKENS`, `LIE_DEYE_MAX_USES`, `LIE_DEYE_WIN_BONUS`, `DISCONNECT_GRACE_MS`, `EMPTY_ROOM_TTL_MS`, `SESSION_TTL_MS`.

> [!WARNING]
> **Developer testing mode is ON by default.** Every phase timer (request, offer, decision, Lie Deye) is set to **600s (10 min)** so you can debug the UI without rushing. The timer logic itself hasn't changed. To get the real durations back, start the server with `DEV_TESTING_MODE=0 npm start`, or set the default to `false` in [`server/src/config.js`](server/src/config.js). The AFK timer (3s for a disconnected player) and the 45s disconnect grace period are **not** extended.

### App
```bash
cd app
npm install
npx expo install --fix   # align native module versions with your installed Expo SDK
npx expo start
```
> [!IMPORTANT]
> Expo SDK 54 requires **Node ≥ 20.19**. The server itself runs on Node ≥ 18.

### Connecting phones through ngrok
1. `cd server && npm start` (port 3001)
2. `ngrok http 3001`
3. Copy the `https://….ngrok-free.dev` forwarding URL into **`PUBLIC_SERVER_URL`** at the top of [`app/src/config.js`](app/src/config.js) (no trailing slash), then reload the app.

The client sends `ngrok-skip-browser-warning: true` (this gets past ngrok's free-tier interstitial page) and tries websocket first, falling back to HTTP long-polling. If the connection fails, the banner shows the host it's trying and the last error. Tap it to retry.

If you set `PUBLIC_SERVER_URL` to `""`, the app falls back to `EXPO_PUBLIC_SERVER_URL`, then to the **LAN host Metro serves from** on port 3001 (a phone running Expo Go on the same Wi-Fi), then to `localhost`.

> [!NOTE]
> Free ngrok URLs change every time ngrok restarts. If you see "Not connected to the server", check that the URL in `config.js` matches the one ngrok is showing now.

To play locally, open the app on **4+** devices or simulators (a match needs at least 4 players). Create a lobby on one and join with the code on the others.

## Game rules as implemented

| Rule | Implementation |
|---|---|
| Players | **Minimum 4**, maximum 8. The server rejects `start_game` with `NOT_ENOUGH_PLAYERS` below 4, and the host's Start button stays grayed out ("Waiting for X more players"). |
| Deck | `N` players → first `N` ranks of `A K Q J 10 9 8 7`, × 4 suits, + 1 Joker = `4N + 1` cards (4–8 players) |
| Deal | One random player gets **5** cards (the *holder*), the others get 4. The deal is redone if anyone starts with a winning hand. |
| Turn | The seat right after the holder is the *active* player. They `request_card` (name a rank). |
| Offers | The holder `offer_card`s **any** card face-down. The active player can accept or reject offers #1 and #2 with `player_decision`. |
| 3rd offer | After 2 rejections the holder has exactly 3 cards in hand. They choose one, and it is **auto-accepted** (there is no decision phase). |
| After a transfer | Rejected cards go back to the giver. The receiver now has 5 cards and becomes the new holder; the seat after them becomes the new active player. |
| Win / loss | `declare_win` succeeds only with four of a kind and **no Joker**. A Joker the holder has placed face-down on the table still counts as theirs. Whoever owns the Joker at that moment loses. |
| Timers | Request 15s · Offer 15s · Decision 10s (60s after a Lie Deye); **600s each while `DEV_TESTING_MODE` is on**. When time runs out the server makes the move: it asks for your most-held rank, offers a **completely random card** from the holder's hand (it may or may not be the requested rank), or accepts. A disconnected player's timer drops to 3s. |
| Leave mid-match | The deck size depends on the player count, so the match is **terminated**. Everyone gets a `game_aborted` event and goes back to the room's waiting room (same code, same group). |
| Disconnect | Your seat is kept for 45s and the server auto-plays it. If you don't come back in time, it's handled the same as leaving. |
| End Game | **Host only.** Terminates the match (or the results screen) and sends everyone back to the waiting room. |

### 👁️ Lie Deye tokens
| | |
|---|---|
| Use | During **DECISION**, the active player spends 1 token on the face-down card in front of them. |
| Effect | The clock resets to a **full 60s** ("time frozen"). A VAR overlay shows the giver's **decision time** (measured on the server), touches, cards touched, switches between cards, shuffles, which slot they picked, a **touch heatmap** with replay, a timeline and a mini screen map. |
| Privacy | Only the asking player ever receives the telemetry, and only after spending a token on that offer. Everyone else just sees a 👁️ badge and a toast. Touches are sent keyed by card id. The server converts them to slot positions at offer time, so the heatmap still lines up if the giver shuffled, and card ids are never sent back. |
| Economy | **4 tokens** for your first game in a room. **Unused tokens carry over** to later games in that room. The **winner gets +1**. You can use at most **3 per game**, however many you have. The room tracks balances on the server (leaving and rejoining doesn't reset them). |
| Aborted matches | Tokens spent in a match that gets aborted stay spent. |

### Hand tools
- **Anti-spy (👁️ Hide):** flips every card in *your* hand face-down so people nearby can't peek. Only an inner card layer rotates (Y-axis flip), so the cards keep exactly the same positions and order. It's local only (nothing is sent to the server). Your own offered cards on the table are hidden too, and the big "Reveal" banner turns into a discreet 🏆 icon.
- **Shuffle:** works at any time during a match, even when it isn't your turn and even after the timer runs out. The app picks a new order, **shows it right away** with a little hop animation, and sends it to the server. The server checks that it's an exact permutation of your hand and stores it (if it isn't, the server shuffles randomly instead), so Lie Deye slot positions always match what the giver actually saw.

## Socket protocol

Every client→server event uses an ack: `{ ok: true, ...data }` or `{ ok: false, code, error }`.

| Client → Server | Payload |
|---|---|
| `create_room` | `{ nickname, avatarId }` → `{ code }` |
| `join_room` | `{ code, nickname, avatarId }` |
| `leave_room`, `start_game`, `play_again`, `declare_win` | – |
| `end_game` | – (host only) |
| `request_card` | `{ rank }` |
| `offer_card` | `{ cardId, touches?: [{ c, u, v, x, y, t }] }`. `c` is the card under the finger, `u,v` the position inside that card, `x,y` the position on screen (all normalized 0–1), `t` the ms since OFFER started |
| `player_decision` | `{ accept: boolean }` |
| `use_lie_deye` | – (errors: `WRONG_PHASE`, `NOT_YOUR_TURN`, `ALREADY_READ`, `LIE_DEYE_LIMIT`, `NO_TOKENS`) |
| `shuffle_hand` | `{ order?: cardId[] }` → `{ order }`. The sender's new `game_state` is emitted before the ack. |
| `update_profile` | `{ nickname?, avatarId? }` |
| `time_sync` | – → `{ serverNow }` |

| Server → Client | Meaning |
|---|---|
| `session` | `{ token, playerId }`. The client stores `token` and sends it back in `auth` on reconnect to get its seat back. |
| `room_state` | Public lobby state, the same for everyone (`players[].tokens` = Lie Deye balance), or `null` |
| `game_state` | **This player's own redacted view**: their own hand, opponents' card *counts* and tokens, face-down offers (`card: null` unless you are the holder), `lieDeyeWallet`, `canUseLieDeye`, `timeFrozen`, `lieDeye` (the asker only, after spending a token), `isolated`, `canDeclare`, `deadline`, … |
| `game_event` | Public events for toasts and animations (`card_requested`, `card_offered`, `offer_rejected`, `card_transferred`, `timeout`, `game_over`, `lie_deye_used`, `lie_deye_bonus`, `game_aborted {reason: player_left / player_disconnected / host_ended}`) |

**Anti-cheat:** card ids are random (`c_9f3a…`), so a face-down card's id doesn't give away its rank. The public `playerId` is separate from the secret session `token`. All input is sanitized, touch telemetry is clamped and capped at 200 samples, and each socket is rate-limited.

## UI notes

- **Safe areas:** every screen uses `SafeAreaView` from `react-native-safe-area-context` on all four edges, and each modal has its own `SafeAreaProvider` (RN modals open in a separate native window). `useResponsive()` sorts the usable height into *compact* (SE), *regular* (14 / 14 Pro) or *tall* (14 Plus / Pro Max) and sizes the cards, avatars and gaps to match. Nothing scrolls on the game board, and nothing sits under the Dynamic Island or the home indicator.
- **Isolation Mode:** if `game.isolated` is true, the backdrop and your own hand are dimmed. Players outside the trade get a red **Muted** badge, and the two traders get a pulsing yellow spotlight ring.
- **Synced timer:** on connect the client does an NTP-style clock sync (best of 5 round trips). `TimerBar` then drains from the true remaining fraction on the UI thread (Reanimated), so all devices reach zero together. While a Lie Deye is active it turns icy blue.
- **Hand gestures:** tap a card to select it, or drag it upward about 90px to throw it onto the table as your offer. If the server rejects the offer, the card springs back into your hand. iOS tap fix: the tap runs on the JS thread (`runOnJS(true)`) and tolerates up to 22px of finger drift; pan only starts after 14px; the two gestures are combined with `Gesture.Race`. Each card has a flat, explicit hit box (both card faces are `pointerEvents="none"` and have no 3D transform at rest). Native views stay in a stable order, and only x, rotation and zIndex change on shuffle.
- **Audio:** `AudioToggle` sits at the app root on every screen. `AudioContext.playSfx()` / music are stubs with `TODO(audio)` markers, ready for `expo-audio`.
