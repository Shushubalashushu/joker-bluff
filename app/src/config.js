import Constants from 'expo-constants';
import { Platform } from 'react-native';

const SERVER_PORT = 3001;

function resolveServerUrl() {
  // Expo inlines this public URL at build time.
  const configuredUrl = process.env.EXPO_PUBLIC_SERVER_URL?.trim().replace(/\/+$/, '');
  if (configuredUrl) return configuredUrl;

  // A phone running Expo Go can reach the development server on Metro's LAN host.
  const host = Platform.OS === 'web' ? null : Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${SERVER_PORT}`;
}

export const SERVER_URL = resolveServerUrl();

export const STORAGE_KEYS = {
  profile: '@jokerbluff/profile',
  audio: '@jokerbluff/audio',
  antiSpy: '@jokerbluff/antiSpy',
  language: '@jokerbluff/language',
};

export const ROOM_CODE_LENGTH = 5;
export const NICKNAME_MAX = 16;

/** Lie Deye economy (mirrors server/src/config.js - the server is authoritative). */
export const LIE_DEYE = Object.freeze({ STARTING_TOKENS: 4, MAX_USES_PER_GAME: 3, WIN_BONUS: 1 });

/** A match needs at least this many players (mirrors server HARD_MIN_PLAYERS; server enforces it). */
export const MIN_PLAYERS = 4;

/** Touch telemetry recorded while YOU choose which card to offer (Lie Deye heatmap). */
export const TOUCH_TELEMETRY = Object.freeze({ THROTTLE_MS: 40, MAX_SAMPLES: 300 });
