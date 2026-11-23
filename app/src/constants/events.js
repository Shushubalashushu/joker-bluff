/** Keep in sync with server/src/shared/events.js */
export const C2S = Object.freeze({
  TIME_SYNC: 'time_sync',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  KICK_PLAYER: 'kick_player',
  BAN_PLAYER: 'ban_player',
  UNBAN_PLAYER: 'unban_player',
  ADD_BOT: 'add_bot',
  REMOVE_BOT: 'remove_bot',
  SET_TURN_SPEED: 'set_turn_speed',
  UPDATE_PROFILE: 'update_profile',
  START_GAME: 'start_game',
  PLAY_AGAIN: 'play_again',
  END_GAME: 'end_game', // host only: terminate the match, everyone back to the lobby
  REQUEST_CARD: 'request_card',
  OFFER_CARD: 'offer_card', // { cardId, touches?, pressDurationMs?, claimedNoCard? }
  PLAYER_DECISION: 'player_decision',
  USE_LIE_DEYE: 'use_lie_deye', // spend a token during DECISION (fresh review countdown + VAR stats)
  SHUFFLE_HAND: 'shuffle_hand', // reorder my hand (any time)
  // (declare_win removed: victory is automatic after passing your 5th card)
});

export const S2C = Object.freeze({
  SESSION: 'session',
  ROOM_STATE: 'room_state',
  ROOM_KICKED: 'room_kicked',
  GAME_STATE: 'game_state',
  GAME_EVENT: 'game_event',
});

export const PHASES = Object.freeze({
  REQUEST: 'REQUEST',
  OFFER: 'OFFER',
  DECISION: 'DECISION',
  FINISHED: 'FINISHED',
});
