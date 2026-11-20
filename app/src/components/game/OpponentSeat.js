import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../common/Avatar';
import { useI18n } from '../../i18n';
import { colors, fonts } from '../../theme';

/**
 * Opponent avatar on the table rim.
 *  - spotlight: one of the 2 players in the current transaction (glowing, pulsing ring)
 *  - muted:     everyone else during a transaction (dimmed + "Muted" badge)
 *  - acting:    whose move it is right now (thinking bubble)
 *  - 👁️ chip:   their Lie Deye token balance
 */
export default function OpponentSeat({ player, seat, spotlight, muted, acting, role, compact = false, size: sizeProp }) {
  const { t, textStyle } = useI18n();
  const playerName = player?.nickname ?? t('common.aPlayer');
  const size = sizeProp || (compact ? 46 : 54);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (spotlight) {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 650 }), withTiming(0, { duration: 650 })), -1);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0);
    }
  }, [spotlight, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.65,
    transform: [{ scale: 1 + pulse.value * 0.12 }],
  }));

  const connected = player?.connected !== false;

  return (
    <View style={[styles.wrap, muted && styles.mutedWrap]} accessibilityLabel={muted ? t('seat.a11yMuted', { name: playerName }) : playerName}>
      <View style={{ width: size + 14, height: size + 14, alignItems: 'center', justifyContent: 'center' }}>
        {spotlight && (
          <Animated.View
            style={[styles.ring, { width: size + 14, height: size + 14, borderRadius: (size + 14) / 2 }, ringStyle]}
          />
        )}
        <Avatar
          avatarId={player?.avatarId ?? 0}
          size={size}
          ring={spotlight ? colors.yellow : colors.night}
          style={!connected && { opacity: 0.45 }}
        />

        {muted && (
          <View style={styles.mutedBadge}>
            <Ionicons name="volume-mute" size={13} color={colors.white} />
          </View>
        )}
        {!connected && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline" size={12} color={colors.white} />
          </View>
        )}
        {acting && (
          <View style={styles.thinking}>
            <Text style={styles.thinkingText}>💭</Text>
          </View>
        )}

        {/* card count + Lie Deye balance */}
        <View style={styles.chipRow}>
          <View style={styles.countChip}>
            <Text style={styles.countText}>🂠 {seat.cardCount}</Text>
          </View>
          {typeof seat.tokens === 'number' && (
            <View style={[styles.countChip, styles.tokenChip]}>
              <Text style={styles.countText}>👁️{seat.tokens}</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={[styles.name, spotlight && styles.nameSpot, textStyle]} numberOfLines={1}>
        {playerName}
      </Text>
      {!!role && (
        <View style={[styles.role, role === 'GIVER' ? styles.roleGiver : styles.roleAsker]}>
          <Text style={[styles.roleText, textStyle]}>{t(`role.${role}`)}</Text>
        </View>
      )}
      {muted && <Text style={[styles.mutedText, textStyle]}>{t('role.muted')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: 78 },
  mutedWrap: { opacity: 0.45 },
  ring: { position: 'absolute', borderWidth: 4, borderColor: colors.yellow, backgroundColor: 'rgba(255,210,63,0.25)' },
  mutedBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.muted,
    borderWidth: 2,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinking: { position: 'absolute', top: -12, left: -6 },
  thinkingText: { fontSize: 20 },
  chipRow: { position: 'absolute', bottom: -4, flexDirection: 'row', gap: 2 },
  countChip: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.night,
    paddingHorizontal: 5,
  },
  tokenChip: { backgroundColor: colors.yellow, paddingHorizontal: 3 },
  countText: { fontFamily: fonts.bold, fontSize: 11, color: colors.night },
  name: { fontFamily: fonts.bold, fontSize: 13, color: colors.white, marginTop: 6, maxWidth: 78 },
  nameSpot: { color: colors.yellow },
  role: { marginTop: 2, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 2, borderColor: colors.night },
  roleGiver: { backgroundColor: colors.pink },
  roleAsker: { backgroundColor: colors.teal },
  roleText: { fontFamily: fonts.bold, fontSize: 10, color: colors.white, letterSpacing: 0.5 },
  mutedText: { fontFamily: fonts.bold, fontSize: 10, color: colors.red, letterSpacing: 1, marginTop: 2 },
});
