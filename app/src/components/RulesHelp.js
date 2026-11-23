import React, { useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { rich } from '../i18n/rich';
import { cartoonShadow, colors, fonts } from '../theme';
import { verticalScrollProps, viewport } from '../theme/layout';
import { noTranslateProps } from '../utils/webTranslation';

const SECTIONS = [
  { title: 'goal', lines: ['avoid', 'finish'], labels: true },
  { title: 'setup', lines: ['deck', 'deal'] },
  { title: 'flow', lines: ['ask', 'offer', 'choose'], labels: true, numbered: true },
  { title: 'lieDeye', lines: ['review'] },
  { title: 'traits', lines: ['courage', 'psychology', 'strategy', 'teamwork'], labels: true },
];

export default function RulesHelp({ live = false }) {
  const { t, alignStart } = useI18n();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const title = t('rules.title');

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.question}>?</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close} accessibilityLabel={title} statusBarTranslucent>
        <SafeAreaProvider style={viewport}>
          <SafeAreaView style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} accessible={false} tabIndex={-1} onPress={close} />
            <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={close}>
              <View style={styles.header}>
                <Text accessibilityRole="header" style={[styles.title, alignStart]}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={styles.close}>
                  <Ionicons name="close" size={23} color={colors.night} />
                </Pressable>
              </View>
              {live && <Text style={[styles.live, alignStart]}>{t('rules.live')}</Text>}
              <ScrollView {...verticalScrollProps} tabIndex={0} style={styles.scroll} contentContainerStyle={styles.content}>
                {SECTIONS.map(({ title: section, lines, labels, numbered }) => (
                  <View key={section} style={styles.section}>
                    <Text accessibilityRole="header" style={[styles.heading, alignStart]}>{t(`rules.${section}`)}</Text>
                    {lines.map((line, i) => (
                      <Text key={line} style={[styles.body, alignStart]}>
                        {numbered && <Text style={styles.label}>{`\u2066${i + 1}.\u2069 `}</Text>}
                        {labels && <Text style={styles.label}>{t(`rules.${line}.label`)} </Text>}
                        {rich(t(`rules.${line}`), {
                          ranks: <Text {...noTranslateProps} style={styles.ranks}>J, Q, K, A</Text>,
                        })}
                      </Text>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: colors.night, backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center', ...cartoonShadow,
  },
  question: { fontFamily: fonts.bold, fontSize: 25, color: colors.night },
  pressed: { opacity: 0.8 },
  backdrop: { ...viewport, padding: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay },
  sheet: {
    width: '100%', maxWidth: 580, maxHeight: '100%', flexShrink: 1, overflow: 'hidden',
    borderRadius: 26, borderWidth: 3, borderColor: colors.night, backgroundColor: colors.cream,
  },
  header: { paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 25, color: colors.purple },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  live: { paddingHorizontal: 16, paddingBottom: 8, fontFamily: fonts.semibold, fontSize: 14, color: colors.night },
  scroll: { flexGrow: 0, flexShrink: 1, borderTopWidth: 1, borderTopColor: colors.muted },
  content: { padding: 14, gap: 12 },
  section: { padding: 12, gap: 7, borderRadius: 15, backgroundColor: colors.white },
  heading: { fontFamily: fonts.bold, fontSize: 19, color: colors.purple },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.night },
  label: { fontFamily: fonts.bold },
  ranks: { fontFamily: fonts.bold, writingDirection: 'ltr' },
});
