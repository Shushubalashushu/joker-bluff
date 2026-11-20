import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getAvatar } from '../../constants/avatars';
import { colors } from '../../theme';

/** Round cartoon avatar: big emoji on a bright blob with a thick outline. */
export default function Avatar({ avatarId, size = 64, ring = colors.night, style }) {
  const a = getAvatar(avatarId);
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: a.bg,
          borderColor: ring,
          borderWidth: Math.max(2, Math.round(size / 22)),
        },
        style,
      ]}
    >
      <View style={[styles.highlight, { width: size * 0.36, height: size * 0.18, borderRadius: size }]} />
      <Text style={{ fontSize: size * 0.56 }} allowFontScaling={false}>
        {a.emoji}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: '10%',
    left: '18%',
    backgroundColor: 'rgba(255,255,255,0.45)',
    transform: [{ rotate: '-20deg' }],
  },
});
