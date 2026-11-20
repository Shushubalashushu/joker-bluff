'use strict';

/**
 * Socket event names. Keep in sync with app/src/constants/events.js
 * (duplicated on purpose: Metro does not resolve files outside the Expo root
 * without extra config).
 */
const C2S = Object.freeze({
  TIME_SYNC: 'time_sync',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  UPDATE_PROFILE: 'update_profile',
  START_GAME: 'start_game',
  PLAY_AGAIN: 'play_again',
  END_GAME: 'end_game', // host only: terminate the match, everyone back to the lobby
  // Core game loop
  REQUEST_CARD: 'request_card',
  OFFER_CARD: 'offer_card', // { cardId, touches?: [{c,u,v,x,y,t}], noCard?: true }  (noCard = "I don't have it", server-verified)
  PLAYER_DECISION: 'player_decision',
  USE_LIE_DEYE: 'use_lie_deye',
  SHUFFLE_HAND: 'shuffle_hand', // reorder my own hand (any time)
  // (declare_win was removed: victory is automatic after passing your 5th card)
});

const S2C = Object.freeze({
  SESSION: 'session',
  ROOM_STATE: 'room_state',
  GAME_STATE: 'game_state',
  GAME_EVENT: 'game_event',
});

const PHASES = Object.freeze({
  REQUEST: 'REQUEST', // active player must ask the holder for a rank
  OFFER: 'OFFER', // holder must place a card face-down
  DECISION: 'DECISION', // active player accepts / rejects the face-down card
  FINISHED: 'FINISHED',
});

module.exports = { C2S, S2C, PHASES };
