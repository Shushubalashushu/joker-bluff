import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import PlayfulBackground from '../components/common/PlayfulBackground';
import CartoonButton from '../components/common/CartoonButton';
import ProfileCard from '../components/lobby/ProfileCard';
import AvatarPickerModal from '../components/lobby/AvatarPickerModal';
import PrivateGameModal from '../components/lobby/PrivateGameModal';
import { useProfile } from '../context/ProfileContext';
import { useGame } from '../context/GameContext';
import { useAudio, SFX } from '../context/AudioContext';
import useResponsive from '../hooks/useResponsive';
import useKeyboardLift from '../hooks/useKeyboardLift';
import LanguageToggle from '../components/LanguageToggle';
import { useI18n } from '../i18n';
import { colors, fonts, gradients } from '../theme';
import { viewport, verticalScrollProps } from '../theme/layout';

function Logo({ scale = 1 }) {
  const { t, textStyle } = useI18n();
  const wobble = useSharedValue(0);
  useEffect(() => {
    wobble.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: 1400, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      true
    );
  }, [wobble]);
  const jokerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wobble.value * 10}deg` }, { translateY: wobble.value * -4 }],
  }));
  const big = { fontSize: 56 * scale, lineHeight: 60 * scale };

  return (
    <View style={styles.logo}>
      <Animated.Text style={[styles.logoEmoji, { fontSize: 64 * scale }, jokerStyle]}>🃏</Animated.Text>
      <Text style={[styles.logoTop, big, textStyle]}>{t('lobby.logoTop')}</Text>
      <Text style={[styles.logoBottom, big, textStyle]}>{t('lobby.logoBottom')}</Text>
      <Text style={[styles.tagline, textStyle]}>{t('lobby.tagline')}</Text>
    </View>
  );
}

export default function LobbyScreen() {
  const { nickname, avatarId, setNickname, setAvatarId } = useProfile();
  const { createRoom, joinRoom } = useGame();
  const { playSfx } = useAudio();
  const { t, textStyle } = useI18n();
  const r = useResponsive();
  const logoScale = r.compact ? 0.78 : r.tall ? 1.08 : 0.95;
  const profileRef = useRef(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const [nameError, setNameError] = useState(null);
  const { targetRef, liftStyle } = useKeyboardLift({ margin: 16, enabled: !privateOpen && !avatarOpen });

  const openPrivate = () => {
    Keyboard.dismiss();
    if (!nickname.trim()) {
      setNameError('lobby.nameRequired');
      profileRef.current?.shake();
      return;
    }
    playSfx(SFX.TAP);
    setPrivateOpen(true);
  };

  return (
    <View style={styles.root}>
      <PlayfulBackground colors={gradients.lobby} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        {/* Keyboard: the whole column slides up (transform only) - nothing is resized/squished */}
        <Animated.View style={[styles.fill, liftStyle]}>
          <ScrollView
            contentContainerStyle={[styles.content, r.compact && { gap: 18, paddingVertical: 12 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets={false}
            {...verticalScrollProps}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.delay(50).springify()}>
              <Logo scale={logoScale} />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.profileWrap}>
              <ProfileCard
                ref={profileRef}
                inputRef={targetRef}
                nickname={nickname}
                avatarId={avatarId}
                error={nameError && t(nameError)}
                onChangeNickname={(t) => {
                  setNickname(t);
                  if (nameError) setNameError(null);
                }}
                onEditAvatar={() => {
                  Keyboard.dismiss();
                  setAvatarOpen(true);
                }}
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(250).springify()} style={styles.actions}>
              <CartoonButton
                title={t('lobby.private')}
                size="lg"
                gradient={gradients.primary}
                lipColor={colors.darkOrange}
                icon={<Text style={styles.btnEmoji}>🔒</Text>}
                onPress={openPrivate}
                textStyle={styles.bigBtnText}
              />
              <Text style={[styles.footnote, textStyle]}>{t('lobby.footnote')}</Text>
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>

      {/* 🌐 EN / עב - top-left, level with the persistent audio toggle (top-right) */}
      <LanguageToggle style={[styles.langToggle, { top: r.insets.top + 12 }]} />

      <AvatarPickerModal
        visible={avatarOpen}
        selectedId={avatarId}
        onSelect={setAvatarId}
        onClose={() => setAvatarOpen(false)}
      />
      <PrivateGameModal
        visible={privateOpen}
        onClose={() => setPrivateOpen(false)}
        onJoin={joinRoom}
        onCreate={createRoom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: viewport,
  safe: viewport,
  fill: viewport,
  langToggle: { position: 'absolute', left: 14, zIndex: 100, elevation: 100 },
  // paddingTop 56: the persistent audio toggle (48px) sits in the top-right corner
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 56, paddingBottom: 24, gap: 28 },
  logo: { alignItems: 'center' },
  logoEmoji: { fontSize: 64, marginBottom: -6 },
  logoTop: {
    fontFamily: fonts.bold,
    fontSize: 56,
    lineHeight: 60,
    color: colors.yellow,
    textShadowColor: colors.night,
    textShadowOffset: { width: 3, height: 4 },
    textShadowRadius: 0,
    letterSpacing: 2,
  },
  logoBottom: {
    fontFamily: fonts.bold,
    fontSize: 56,
    lineHeight: 60,
    color: colors.white,
    textShadowColor: colors.night,
    textShadowOffset: { width: 3, height: 4 },
    textShadowRadius: 0,
    letterSpacing: 2,
    marginTop: -8,
    transform: [{ rotate: '-3deg' }],
  },
  tagline: { fontFamily: fonts.semibold, color: colors.white, fontSize: 15, marginTop: 6, opacity: 0.95 },
  profileWrap: { marginTop: 8 },
  actions: { gap: 10 },
  btnEmoji: { fontSize: 28 },
  bigBtnText: { fontSize: 30 },
  footnote: { fontFamily: fonts.regular, color: colors.white, textAlign: 'center', opacity: 0.9, fontSize: 13 },
});
