import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../i18n';
import { cartoonShadow, colors, fonts } from '../../theme';

const MODES = ['fast', 'standard'];

export default function TurnSpeedSelector({ speed, onChange, disabled }) {
  const { t, textStyle } = useI18n();
  const title = t('speed.title');

  return (
    <View style={styles.panel}>
      <Text style={[styles.title, textStyle]}>{title}</Text>
      {onChange ? (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={title}>
          {MODES.map((mode) => {
            const checked = speed === mode;
            const name = t(`speed.${mode}`);
            const duration = t(`speed.${mode}Duration`);
            return (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityLabel={t('speed.option', { name, duration })}
                aria-checked={checked}
                disabled={disabled}
                onPress={() => !checked && onChange(mode)}
                style={({ pressed }) => [styles.option, checked && styles.selected, pressed && styles.pressed]}
              >
                <View style={styles.optionHeader}>
                  <Text style={[styles.name, textStyle]} numberOfLines={1}>{name}</Text>
                  <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={checked ? colors.darkGreen : colors.muted} />
                </View>
                <Text style={[styles.duration, textStyle]} numberOfLines={1}>{duration}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.current, textStyle]} accessibilityLiveRegion="polite">
          {t('speed.option', { name: t(`speed.${speed}`), duration: t(`speed.${speed}Duration`) })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.white,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: colors.night,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...cartoonShadow,
  },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.night, textAlign: 'center' },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: colors.cream,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.night,
  },
  selected: { backgroundColor: '#C8F7C5', borderColor: colors.darkGreen },
  pressed: { opacity: 0.75 },
  optionHeader: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.night },
  duration: { fontFamily: fonts.semibold, fontSize: 12, color: colors.night, textAlign: 'center' },
  current: { fontFamily: fonts.bold, fontSize: 16, color: colors.darkGreen, textAlign: 'center' },
});
