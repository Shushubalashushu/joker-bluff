import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Avatar from '../common/Avatar';
import { AVATARS } from '../../constants/avatars';
import { useI18n } from '../../i18n';
import { colors, fonts, cartoonShadow } from '../../theme';
import { viewport } from '../../theme/layout';

export default function AvatarPickerModal({ visible, selectedId, onSelect, onClose }) {
  const { t, textStyle } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaProvider style={viewport}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safe} pointerEvents="box-none">
        <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.sheet}>
          {/* Inner Pressable swallows taps so they don't close the modal */}
          <Pressable>
            <Text style={[styles.title, textStyle]}>{t('avatar.title')}</Text>
            <View style={styles.grid}>
              {AVATARS.map((a) => {
                const selected = a.id === selectedId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      onSelect(a.id);
                      onClose();
                    }}
                    accessibilityLabel={t('avatar.choice', { emoji: a.emoji })}
                    style={[styles.cell, selected && styles.cellSelected]}
                  >
                    <Avatar avatarId={a.id} size={64} ring={selected ? colors.yellow : colors.night} />
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Animated.View>
        </SafeAreaView>
      </Pressable>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...viewport, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
  safe: { ...viewport, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: colors.night,
    padding: 18,
    ...cartoonShadow,
  },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.night, textAlign: 'center', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  cell: { padding: 4, borderRadius: 40 },
  cellSelected: { backgroundColor: colors.yellow, transform: [{ scale: 1.08 }] },
});
