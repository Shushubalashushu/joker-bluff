import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../common/Avatar';
import { randomNickname } from '../../constants/avatars';
import { useI18n } from '../../i18n';
import { NICKNAME_MAX } from '../../config';
import { colors, fonts, cartoonShadow } from '../../theme';

/**
 * Guest profile card: cartoon avatar with an Edit badge + nickname input.
 * Exposes `shake()` via ref so the parent can nudge the user (e.g. empty name).
 */
const ProfileCard = forwardRef(function ProfileCard({ nickname, avatarId, onChangeNickname, onEditAvatar, inputRef, error }, ref) {
  const { t, isRTL, textStyle, alignStart } = useI18n();
  const [focused, setFocused] = useState(false);
  const showNickname = !focused && !!nickname;
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  useImperativeHandle(ref, () => ({
    shake: () => {
      shakeX.value = withSequence(
        withTiming(-12, { duration: 50 }),
        withTiming(12, { duration: 60 }),
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(0, { duration: 50 })
      );
    },
  }));

  return (
    <Animated.View style={[styles.card, shakeStyle]}>
      <View style={styles.ribbon}>
        <Text style={[styles.ribbonText, textStyle]}>{t('profile.title')}</Text>
      </View>

      <View style={styles.row}>
        <Pressable onPress={onEditAvatar} accessibilityLabel={t('profile.avatar')} style={styles.avatarWrap}>
          <Avatar avatarId={avatarId} size={92} />
          <View style={styles.editBadge}>
            <Ionicons name="pencil" size={16} color={colors.night} />
          </View>
        </Pressable>

        <View style={styles.fields}>
          <Text style={[styles.label, alignStart]}>{t('profile.nickname')}</Text>
          <View style={[styles.inputRow, error && styles.inputError]}>
            <View style={styles.inputFrame}>
              {/* Keep the full name readable at rest, including names wider than one line. */}
              {!!nickname && (
                <Text
                  aria-hidden
                  pointerEvents="none"
                  style={[styles.inputText, alignStart, !showNickname && styles.invisible]}
                >
                  {nickname}
                </Text>
              )}
              <TextInput
                ref={inputRef}
                value={nickname}
                onChangeText={onChangeNickname}
                placeholder={t('profile.placeholder')}
                placeholderTextColor={colors.muted}
                maxLength={NICKNAME_MAX}
                autoCorrect={false}
                autoCapitalize="words"
                multiline={false}
                returnKeyType="done"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={[styles.input, styles.inputText, { textAlign: isRTL ? 'right' : 'left' }, showNickname && styles.invisible]}
                accessibilityLabel={t('profile.nickname')}
              />
            </View>
            <Pressable
              onPress={() => onChangeNickname(randomNickname())}
              hitSlop={8}
              accessibilityLabel={t('profile.random')}
              style={styles.dice}
            >
              <Text style={styles.diceText}>🎲</Text>
            </Pressable>
          </View>
          <Text style={[styles.hint, alignStart, error && { color: colors.red }]}>
            {error || t('profile.hint')}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
});

export default ProfileCard;

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: '100%',
    backgroundColor: colors.white,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: colors.night,
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 16,
    ...cartoonShadow,
    shadowOffset: { width: 0, height: 8 },
  },
  ribbon: {
    position: 'absolute',
    top: -16,
    alignSelf: 'center',
    backgroundColor: colors.teal,
    borderWidth: 3,
    borderColor: colors.night,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  ribbonText: { fontFamily: fonts.bold, color: colors.white, fontSize: 14, letterSpacing: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { position: 'relative' },
  editBadge: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.yellow,
    borderWidth: 3,
    borderColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.bold, color: colors.night, fontSize: 15, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderWidth: 3,
    borderColor: colors.night,
    borderRadius: 16,
    paddingLeft: 12,
    minHeight: 50,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  inputError: { borderColor: colors.red },
  inputFrame: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingVertical: 5 },
  input: { ...StyleSheet.absoluteFillObject, padding: 0 },
  inputText: { fontFamily: fonts.semibold, fontSize: 18, color: colors.night },
  invisible: { opacity: 0 },
  dice: { flexShrink: 0, paddingHorizontal: 10, alignSelf: 'stretch', justifyContent: 'center' },
  diceText: { fontSize: 22 },
  hint: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12, marginTop: 6 },
});
