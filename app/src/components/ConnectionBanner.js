import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { useGame } from '../context/GameContext';
import { SERVER_URL } from '../config';
import { colors, fonts } from '../theme';

/**
 * Pill shown whenever the socket is not connected.
 * Shows the server address and the last error. Tap to retry immediately.
 */
export default function ConnectionBanner() {
  const { t, tError, textStyle } = useI18n();
  const { connection, connectError, retryConnection } = useGame();
  const insets = useSafeAreaInsets();
  if (connection === 'online') return null;
  const host = SERVER_URL.replace(/^https?:\/\//, '');
  return (
    <Animated.View
      entering={FadeInUp}
      exiting={FadeOutUp}
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 64 }]}
    >
      <Pressable onPress={retryConnection} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.8 }]}>
        <Text style={[styles.text, textStyle]}>{t(connection === 'connecting' ? 'connection.connecting' : 'connection.reconnecting')}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {host}
        </Text>
        {connection === 'offline' && (
          <Text style={[styles.err, textStyle]} numberOfLines={2}>
            {connectError && <Text>{tError(connectError)} · </Text>}{t('connection.retry')}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 90, elevation: 90 },
  pill: {
    backgroundColor: colors.night,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: colors.yellow,
    alignItems: 'center',
    maxWidth: '100%',
  },
  text: { color: colors.yellow, fontFamily: fonts.bold, fontSize: 14 },
  sub: { color: colors.cream, fontFamily: fonts.regular, fontSize: 11, opacity: 0.8, marginTop: 2 },
  err: { color: colors.pink, fontFamily: fonts.regular, fontSize: 11, marginTop: 2, textAlign: 'center' },
});
