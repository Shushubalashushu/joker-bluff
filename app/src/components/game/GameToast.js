import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { colors, fonts } from '../../theme';

/** Shows each new message for a couple of seconds. Keyed by the event timestamp. */
export default function GameToast({ message, eventKey }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(t);
  }, [eventKey, message]);

  if (!visible || !message) return null;
  return (
    <Animated.View key={eventKey} entering={FadeInDown.springify()} exiting={FadeOutUp} pointerEvents="none" style={styles.toast}>
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: 0,
    maxWidth: '90%',
    backgroundColor: colors.night,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.yellow,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 60,
    elevation: 60,
  },
  text: { fontFamily: fonts.bold, fontSize: 14, color: colors.white, textAlign: 'center' },
});
