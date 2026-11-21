import React, { useState } from 'react';
import { Keyboard, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import CartoonButton from '../common/CartoonButton';
import { NICKNAME_MAX } from '../../config';
import useKeyboardLift from '../../hooks/useKeyboardLift';
import { useI18n } from '../../i18n';
import { colors, fonts, gradients, cartoonShadow } from '../../theme';
import { viewport } from '../../theme/layout';

export default function LobbyActionModal({ action, online, onClose, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    if (busy) return;
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent>
      <SafeAreaProvider style={viewport}>
        <ActionSheet action={action} online={online} busy={busy} setBusy={setBusy} onCancel={cancel} onClose={onClose} onSubmit={onSubmit} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ActionSheet({ action, online, busy, setBusy, onCancel, onClose, onSubmit }) {
  const { t, tError, textStyle, alignStart } = useI18n();
  const editing = action.kind === 'rename';
  const [nickname, setNickname] = useState(action.player.nickname);
  const [error, setError] = useState(null);
  const { targetRef, liftStyle } = useKeyboardLift({ margin: 100, enabled: editing });
  const cleanName = nickname.trim();
  const canSubmit = online && (!editing || (!!cleanName && cleanName !== action.player.nickname));

  const submit = async () => {
    if (busy || !canSubmit) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const result = await onSubmit(editing ? cleanName : action.player.id);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result);
  };

  return (
    <SafeAreaView style={styles.backdrop}>
      <Animated.View style={[styles.sheet, liftStyle]} accessibilityViewIsModal>
        <Text style={[styles.title, textStyle]} accessibilityRole="header">
          {t(editing ? 'waiting.editNickname' : 'waiting.kick')}
        </Text>
        {editing ? (
          <TextInput
            ref={targetRef}
            value={nickname}
            onChangeText={(value) => {
              setNickname(value);
              setError(null);
            }}
            maxLength={NICKNAME_MAX}
            editable={!busy}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel={t('profile.nickname')}
            style={[styles.input, alignStart]}
          />
        ) : (
          <Text style={[styles.body, textStyle]}>{t('waiting.kickConfirm', { name: action.player.nickname })}</Text>
        )}
        {!!error && <Text style={[styles.error, textStyle]} accessibilityRole="alert">{tError(error)}</Text>}
        <View style={styles.buttons}>
          <CartoonButton
            title={t('common.cancel')}
            size="sm"
            gradient={gradients.blue}
            lipColor={colors.darkBlue}
            style={styles.button}
            disabled={busy}
            onPress={onCancel}
          />
          <CartoonButton
            title={t(editing ? 'common.save' : 'waiting.kick')}
            size="sm"
            gradient={editing ? gradients.success : gradients.danger}
            lipColor={editing ? colors.darkGreen : colors.darkRed}
            style={styles.button}
            disabled={!canSubmit}
            loading={busy}
            onPress={submit}
          />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...viewport, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.cream,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: colors.night,
    padding: 16,
    gap: 12,
    ...cartoonShadow,
  },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.purple, textAlign: 'center' },
  body: { fontFamily: fonts.semibold, fontSize: 16, color: colors.night, textAlign: 'center' },
  input: {
    minHeight: 46,
    borderWidth: 2,
    borderColor: colors.night,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.night,
  },
  error: { fontFamily: fonts.semibold, color: colors.red, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});
