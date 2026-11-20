import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config';

const AudioContext = createContext(null);

/**
 * Audio preferences + a single entry point for all sounds.
 *
 * Music / SFX playback is intentionally stubbed: when you add `expo-audio`,
 * load the sounds here and implement `playSfx` / `startMusic` / `stopMusic`.
 * Every screen already calls through this context, so nothing else changes.
 */
export const SFX = Object.freeze({
  TAP: 'tap',
  CARD_SLIDE: 'card_slide',
  CARD_FLIP: 'card_flip',
  ACCEPT: 'accept',
  REJECT: 'reject',
  FORCED: 'forced',
  TICK: 'tick',
  WIN: 'win',
  LOSE: 'lose',
});

export function AudioProvider({ children }) {
  const [enabled, setEnabled] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.audio)
      .then((v) => {
        if (v !== null) setEnabled(v === '1');
      })
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(STORAGE_KEYS.audio, enabled ? '1' : '0').catch(() => {});
    // TODO(audio): enabled ? startMusic() : stopMusic();
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((e) => !e), []);

  const playSfx = useCallback(
    (_name) => {
      if (!enabled) return;
      // TODO(audio): look up a preloaded expo-audio player by name and play it.
    },
    [enabled]
  );

  const value = useMemo(() => ({ enabled, toggle, playSfx }), [enabled, toggle, playSfx]);
  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used inside <AudioProvider>');
  return ctx;
}
