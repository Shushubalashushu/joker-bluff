import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config';
import { AVATARS, randomNickname } from '../constants/avatars';

const ProfileContext = createContext(null);

/**
 * Guest profile persisted on-device: nickname, avatar and the opaque
 * session token issued by the server (used to resume a seat after reconnect).
 */
export function ProfileProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState({ nickname: '', avatarId: 0, token: null });

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.profile);
        const saved = raw ? JSON.parse(raw) : null;
        setProfile({
          nickname: typeof saved?.nickname === 'string' ? saved.nickname.slice(0, 128) : randomNickname(),
          avatarId: Number.isInteger(saved?.avatarId) && AVATARS[saved.avatarId] ? saved.avatarId : Math.floor(Math.random() * AVATARS.length),
          token: typeof saved?.token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(saved.token) ? saved.token : null,
        });
      } catch {
        setProfile((p) => ({ ...p, nickname: randomNickname() }));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile)).catch(() => {});
  }, [profile, ready]);

  const setNickname = useCallback((nickname) => setProfile((p) => ({ ...p, nickname })), []);
  const setAvatarId = useCallback((avatarId) => setProfile((p) => ({ ...p, avatarId })), []);
  const setToken = useCallback((token) => setProfile((p) => (p.token === token ? p : { ...p, token })), []);

  const value = useMemo(
    () => ({ ready, ...profile, setNickname, setAvatarId, setToken }),
    [ready, profile, setNickname, setAvatarId, setToken]
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
