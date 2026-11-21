import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../i18n';
import { colors, fonts } from '../../theme';

/** Shows each new message for a couple of seconds. Keyed by the event timestamp. */
export default function GameToast({ message, eventKey }) {
  const { textStyle } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(t);
  }, [eventKey, message]);

  return (
    <View pointerEvents="none" style={styles.slot}>
      {visible && !!message && (
        <Text style={[styles.toast, textStyle]} numberOfLines={1} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: 24, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  toast: {
    maxWidth: '100%',
    backgroundColor: colors.night,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.yellow,
    paddingHorizontal: 8,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.white,
    textAlign: 'center',
  },
});
