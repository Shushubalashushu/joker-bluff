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
│   │   └── utils/                 # input validation and rate limiting
│   └── test/                       # node:test — engine unit tests + socket e2e test
└── app/                            # Expo app
    ├── App.js                      # providers, fonts, server-state-driven routing
    └── src/
        ├── config.js               # server URL resolution
        ├── constants/              # events, avatars
        ├── theme/                  # cartoon palette, gradients, Fredoka font
        ├── services/socket.js      # socket singleton, ack helper, clock sync
        ├── context/                # Profile, Audio, Game (server mirror)
        ├── hooks/                  # responsive layout, keyboard lift, server countdown
        ├── i18n/                   # English and Hebrew dictionaries and language provider
        ├── utils/describeEvent.js
        ├── screens/                # Lobby, WaitingRoom, Game
        └── components/
            ├── AudioToggle.js, ConnectionBanner.js, LanguageToggle.js
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
Environment overrides include `PORT`, `CORS_ORIGIN`, `MIN_PLAYERS` (4–8), `DEV_TESTING_MODE`, `TIMER_REQUEST_MS`, `TIMER_OFFER_MS`, `TIMER_DECISION_MS`, `TIMER_AFK_MS`, `TIMER_LIE_DEYE_MS`, `LIE_DEYE_STARTING_TOKENS`, `LIE_DEYE_MAX_USES` (0–3), `LIE_DEYE_WIN_BONUS`, `DISCONNECT_GRACE_MS`, `EMPTY_ROOM_TTL_MS`, and `SESSION_TTL_MS`.

> [!WARNING]
> **Developer testing mode is on by default.** Request, offer, decision, and Lie Deye each default to **600 seconds**. Run `DEV_TESTING_MODE=0 npm start` to use the standard durations. The separate defaults are 3 seconds for a disconnected player's turn and 45 seconds for reconnecting to a reserved seat.

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
| Players | **Minimum 4**, maximum 8. The server requires all seated players to be online at the start. The host’s Start button waits for enough seats and for disconnected guests to reconnect or lose their reserved seat. |
| Deck | `N` players → first `N` ranks of `A K Q J 10 9 8 7`, × 4 suits, + 1 Joker = `4N + 1` cards (4–8 players) |
| Deal | One random player gets **5** cards (the *holder*), the others get 4. The deal is redone if anyone starts with a winning hand. |
| Turn | The seat right after the holder is the *active* player. They `request_card` (name a rank). |
| Offers | The holder `offer_card`s **any** card face-down. After the first rejection, the requester may take either of the first two face-down offers or reject the second to force a third. |
| 3rd offer | After 2 rejections the holder has exactly 3 cards in hand. They choose one, and it is **auto-accepted** (there is no decision phase). |
| After a transfer | Every unchosen card returns to the giver. The receiver now has 5 cards and becomes the new holder. The seat after them becomes the new active player. |
| Win / loss | After a successful transfer, the giver wins automatically if passing their fifth card leaves exactly four cards of one rank. Rejected cards return before the win check. Whoever owns the Joker after the transfer loses. |
| Timers | Request 15s · Offer 15s · Decision 10s (60s after a Lie Deye); **600s each while `DEV_TESTING_MODE` is on**. When time runs out the server makes the move: it asks for your most-held rank, offers a **completely random card** from the holder's hand (it may or may not be the requested rank), or accepts. A disconnected player's timer drops to 3s. |
| Leave mid-match | The deck size depends on the player count, so the match is **terminated**. Everyone gets a `game_aborted` event and goes back to the room's waiting room (same code, same group). |
| Disconnect | Your seat is kept for 45s. The server auto-plays for disconnected guests during a match. If you don't come back in time, it's handled the same as leaving. |
| End Game | **Host only.** Terminates the match (or the results screen) and sends everyone back to the waiting room. |

### 👁️ Lie Deye tokens
| | |
|---|---|
| Use | During **DECISION**, the active player spends 1 token on the face-down card in front of them. |
| Effect | The decision clock starts a fresh Lie Deye window (60 seconds in standard mode, 600 seconds in developer mode by default). The VAR overlay shows server-measured decision time, the chosen card's last hold duration, client-reported touches, shuffles, the chosen slot, and a replayable touch heatmap. |
| Privacy | Only the asking player ever receives the telemetry, and only after spending a token on that offer. Everyone else just sees a 👁️ badge and a toast. Touches are sent keyed by card id. The server converts them to slot positions at offer time, so the heatmap still lines up if the giver shuffled, and card ids are never sent back. |
| Economy | **4 tokens** for your first game in a room. **Unused tokens carry over** to later games in that room. The **winner gets +1**. You can use at most **3 per game**, however many you have. The room tracks balances on the server (leaving and rejoining doesn't reset them). |
| Aborted matches | Tokens spent in a match that gets aborted stay spent. |

### Hand tools
- **Anti-spy (👁️ Hide):** flips every card in *your* hand face-down so people nearby can't peek. Only an inner card layer rotates (Y-axis flip), so the cards keep exactly the same positions and order. Your own offered cards on the table are hidden too.
- **Shuffle:** works at any time during a match, even when it isn't your turn and even after the timer runs out. The app picks a new order, **shows it right away** with a little hop animation, and sends it to the server. The server checks that it's an exact permutation of your hand and stores it (if it isn't, the server shuffles randomly instead), so Lie Deye slot positions always match what the giver actually saw.
- **I don't have it:** the giver may attach this player claim to any face-down offer. The claim can be honest or a bluff. The requester sees a speech badge, including when the third offer transfers immediately.

## Socket protocol

Client events acknowledge success as `{ ok: true, ...data }` and failure as `{ ok: false, code, error, params? }`. The app uses error codes and parameters to render translated feedback.
Deploy the app and server together. Host actions use the `lifecycleId` from `room_state`. Gameplay actions use the `matchId` and, for moves, the `step` from `game_state`. An action targeting an earlier lobby, match, or move is rejected as `STALE_ACTION`.

| Client → Server | Payload |
|---|---|
| `create_room` | `{ nickname, avatarId }` → `{ code }` |
| `join_room` | `{ code, nickname, avatarId }` |
| `leave_room` | `{ code }` |
| `start_game`, `play_again`, `end_game` | `{ lifecycleId }` (host only) |
| `request_card` | `{ matchId, step, rank }` |
| `offer_card` | `{ matchId, step, cardId, claimedNoCard?: boolean, pressDurationMs?: number, touches?: [{ c, u, v, x, y, t }] }`. The hold duration applies to the chosen card. `c` is the card under the finger, `u,v` the position inside that card, `x,y` the position on screen (all normalized 0–1), and `t` the ms since OFFER started. |
| `player_decision` | `{ matchId, step, accept: boolean, offerIndex?: number }`. Use `offerIndex: 0` or `1` to take the first or second available offer. Omitting it accepts the latest offer. Rejecting the latest offer uses `accept: false` without an index. |
| `use_lie_deye` | `{ matchId, step }` |
| `shuffle_hand` | `{ matchId, order?: cardId[] }` → `{ order }`. The sender's new `game_state` is emitted before the ack. |
| `update_profile` | `{ nickname?, avatarId? }` |
| `time_sync` | – → `{ serverNow }` |

| Server → Client | Meaning |
|---|---|
| `session` | `{ token, playerId }`. The client stores `token` and sends it back in `auth` on reconnect to get its seat back. |
| `room_state` | Public lobby state, the same for everyone (`players[].tokens` = Lie Deye balance), or `null` |
| `game_state` | **This player's own redacted view**: their own hand, opponents' card counts and tokens, face-down offers, public player claims, and private Lie Deye telemetry when eligible. |
| `game_event` | Public events for toasts and animations. A `card_offered` event includes `claimedNoCard`. The selected offer's claim follows the `card_transferred` event and `lastTransfer`. A `game_aborted` event carries a reason (`player_left`, `player_disconnected`, `host_ended`, or `server_error`). |

## Server authority and safety checks

- The server ties each action to the active socket for a guest session and checks room membership, host permissions, turn ownership, phase, and deadline. It checks destination admission before leaving the current room.
- The server deals the deck and owns all transfers and token balances. Card IDs are opaque. Players receive their own hand and permitted public information. A client shuffle can reorder only the cards in its own current hand.
- The server validates handshake and event payloads, bounds payload size and guest sessions, and rate-limits socket events, connections, and room-code attempts. Touch telemetry is client-reported and capped at 200 retained samples. Hold duration is also client-reported and bounded by the server-measured offer window.

## UI notes

- **Language:** the lobby and game headers include an English/Hebrew toggle. The choice is saved on the device. Hebrew changes text direction and alignment while the board, seats and hand retain their positions.
- **Safe areas:** every screen uses `SafeAreaView` from `react-native-safe-area-context` on all four edges, and each modal has its own `SafeAreaProvider` (RN modals open in a separate native window). `useResponsive()` sorts the usable height into *compact* (SE), *regular* (14 / 14 Pro) or *tall* (14 Plus / Pro Max) and sizes the cards, avatars and gaps to match. Nothing scrolls on the game board, and nothing sits under the Dynamic Island or the home indicator.
- **Isolation Mode:** if `game.isolated` is true, the backdrop and your own hand are dimmed. Players outside the trade get a red **Muted** badge, and the two traders get a pulsing yellow spotlight ring.
- **Synced timer:** on connect the client does an NTP-style clock sync (best of 5 round trips). `TimerBar` then drains from the true remaining fraction on the UI thread (Reanimated), so all devices reach zero together. While a Lie Deye is active it turns icy blue.
- **Hand gestures:** tap a card to select it or drag it upward about 90 points to offer it. A canceled drag or rejected offer returns the card to the hand. Each card has its own native hitbox and the current center slot has the highest unselected stacking order after a shuffle.
- **Keyboard layout:** the nickname and room-code forms slide above the keyboard on iOS. Android uses keyboard pan. The app is locked to portrait and the main scroll views have bounce disabled.

## Regression checks

Run `npm test` from `server/` for the minimum-player rule, token limits, default developer timers, timeout moves, and server-side shuffle behavior. From `app/`, `npx expo export --platform all` checks bundling for iOS, Android, and web. On a device, shuffle several times, tap the new center card, and confirm that the cards visibly change slots. Open and dismiss each lobby keyboard and switch to Hebrew to check that the table and seats retain their positions.
- **Audio:** `AudioToggle` sits at the app root on every screen. `AudioContext.playSfx()` / music are stubs with `TODO(audio)` markers, ready for `expo-audio`.
