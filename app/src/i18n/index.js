import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config';
import common from './locales/common';
import lobby from './locales/lobby';
import game from './locales/game';
import overlays from './locales/overlays';

/**
 * English / Hebrew localization.
 *
 * STRUCTURAL LAYOUT IS ALWAYS LTR. We never call `I18nManager.forceRTL(true)`;
 * in fact we disable RN's automatic RTL mirroring, so even on an iPhone whose
 * system language is Hebrew the game board, the fanned hand and the avatars
 * keep their exact positions. Only TEXT changes direction - via `textStyle`
 * (writingDirection: 'rtl') and `alignStart` (textAlign: 'right') on Text nodes.
 */
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);
I18nManager.swapLeftAndRightInRTL?.(false);

export const LANGS = Object.freeze({ EN: 'en', HE: 'he' });
const RTL_LANGS = new Set([LANGS.HE]);

/** Each locale module exports `{ en: {key: text}, he: {key: text} }`. Keys are namespaced ("lobby.title"). */
function merge(modules) {
  const out = { en: {}, he: {} };
  for (const m of modules) {
    Object.assign(out.en, m.en);
    Object.assign(out.he, m.he);
  }
  return out;
}
export const DICTIONARY = merge([common, lobby, game, overlays]);

/**
 * Pure translate function (usable outside React, e.g. in utils).
 *  - `{name}` placeholders are filled from `params`.
 *  - If `params.count` is given, `key_one` is used when count === 1 (falls back to `key`).
 *  - Missing Hebrew -> English -> the key itself (so a gap is visible, never a crash).
 */
export function translate(lang, key, params) {
  const table = DICTIONARY[lang] || DICTIONARY.en;
  let k = key;
  if (params && params.count === 1 && (table[`${key}_one`] || DICTIONARY.en[`${key}_one`])) k = `${key}_one`;
  let s = table[k] ?? DICTIONARY.en[k] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined && params[p] !== null ? String(params[p]) : m));
  return s;
}

const I18nContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(LANGS.EN);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.language)
      .then((saved) => {
        if (saved === LANGS.EN || saved === LANGS.HE) setLangState(saved);
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((next) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEYS.language, next).catch(() => {});
  }, []);
  const toggleLang = useCallback(() => setLang(lang === LANGS.HE ? LANGS.EN : LANGS.HE), [lang, setLang]);

  const value = useMemo(() => {
    const isRTL = RTL_LANGS.has(lang);
    const t = (key, params) => translate(lang, key, params);
    return {
      lang,
      isRTL,
      setLang,
      toggleLang,
      t,
      /** Translates a server ack error by its `code` (falls back to the server's English message). */
      tError: (res) => {
        if (!res) return t('errors.GENERIC');
        const key = `errors.${res.code}`;
        const s = translate(lang, key, res.params);
        return s === key ? res.error || t('errors.GENERIC') : s;
      },
      /** Spread onto ANY Text: correct bidi direction for the active language (alignment untouched). */
      textStyle: { writingDirection: isRTL ? 'rtl' : 'ltr' },
      /** For left-aligned paragraphs/labels: start-aligned text (right in Hebrew). Never moves views. */
      alignStart: { writingDirection: isRTL ? 'rtl' : 'ltr', textAlign: isRTL ? 'right' : 'left' },
    };
  }, [lang, setLang, toggleLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <LanguageProvider>');
  return ctx;
}
