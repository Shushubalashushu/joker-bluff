import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n, LANGS } from '../i18n';
import { colors, fonts, cartoonShadow } from '../theme';

/**
 * 🌐 EN / עב pill. The active language is highlighted. The pill itself always
 * stays in LTR order (EN on the left) - only text direction is localized.
 * `compact` = smaller variant for the in-game header.
 */
export default function LanguageToggle({ compact = false, style }) {
  const { lang, toggleLang, t } = useI18n();
  const he = lang === LANGS.HE;
  const h = compact ? 34 : 40;

  return (
    <Pressable
      onPress={toggleLang}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('lang.toggleA11y')}
      style={({ pressed }) => [styles.pill, { height: h, borderRadius: h / 2 }, pressed && styles.pressed, style]}
    >
      <Text style={[styles.globe, compact && styles.segTextSm]}>🌐</Text>
      <View style={[styles.seg, compact && styles.segCompact, !he && styles.segOn]}>
        <Text style={[styles.segText, compact && styles.segTextSm, !he && styles.segTextOn]}>EN</Text>
      </View>
      <Text style={styles.separator}>/</Text>
      <View style={[styles.seg, compact && styles.segCompact, he && styles.segOn]}>
        <Text style={[styles.segText, compact && styles.segTextSm, he && styles.segTextOn]}>עב</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', // stays LTR on purpose
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.white,
    ...cartoonShadow,
  },
  pressed: { transform: [{ translateY: 2 }], shadowOpacity: 0 },
  globe: { fontSize: 16, marginHorizontal: 2 },
  separator: { fontFamily: fonts.bold, fontSize: 11, color: colors.night },
  seg: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12 },
  segCompact: { paddingHorizontal: 3 },
  segOn: { backgroundColor: colors.purple },
  segText: { fontFamily: fonts.bold, fontSize: 14, color: colors.night },
  segTextSm: { fontSize: 12 },
  segTextOn: { color: colors.white },
});
