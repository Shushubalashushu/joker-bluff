import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CartoonButton from '../common/CartoonButton';
import useKeyboardLift from '../../hooks/useKeyboardLift';
import { ROOM_CODE_LENGTH } from '../../config';
import { colors, fonts, gradients, cartoonShadow } from '../../theme';

/**
 * Private Game flow:
 *   1. "Enter Room Code" + Join   (friends)
 *   2. "Create Private Lobby"     (host)
 * `onJoin(code)` / `onCreate()` must resolve to the server ack `{ ok, error }`.
 */
export default function PrivateGameModal({ visible, onClose, onJoin, onCreate }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'join' | 'create' | null
  const [error, setError] = useState(null);
  const { targetRef, liftStyle } = useKeyboardLift({ margin: 0 });

  useEffect(() => {
    if (visible) {
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  const run = async (kind, fn) => {
    setBusy(kind);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res?.ok) setError(res?.error || 'Something went wrong');
    // On success the server pushes room_state and the app navigates automatically.
  };

  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const canJoin = cleanCode.length === ROOM_CODE_LENGTH && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Modals render in their own native window -> they need their own SafeAreaProvider */}
      <SafeAreaProvider>
      {/* No KeyboardAvoidingView: it re-lays out (squishes) the sheet. The sheet is
          lifted as one rigid block with a transform that follows the keyboard. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View ref={targetRef} collapsable={false} style={liftStyle}>
        <Animated.View entering={SlideInDown.springify().damping(16)} style={styles.sheet}>
          <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheetInner}>
          <View style={styles.header}>
            <Text style={styles.title}>Private Game</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.night} />
            </Pressable>
          </View>

          {/* ---- Option 1: join with a code */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🤝 Join a friend</Text>
            <View style={styles.joinRow}>
              <TextInput
                value={cleanCode}
                onChangeText={(t) => setCode(t)}
                placeholder="CODE"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={ROOM_CODE_LENGTH}
                returnKeyType="go"
                onSubmitEditing={() => canJoin && run('join', () => onJoin(cleanCode))}
                style={styles.codeInput}
                accessibilityLabel="Enter Room Code"
              />
              <CartoonButton
                title="Join"
                size="md"
                gradient={gradients.success}
                lipColor={colors.darkGreen}
                disabled={!canJoin}
                loading={busy === 'join'}
                onPress={() => run('join', () => onJoin(cleanCode))}
                style={styles.joinBtn}
              />
            </View>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ---- Option 2: host a new lobby */}
          <CartoonButton
            title="Create Private Lobby"
            size="lg"
            gradient={gradients.primary}
            lipColor={colors.darkOrange}
            icon={<Text style={styles.crown}>👑</Text>}
            disabled={!!busy && busy !== 'create'}
            loading={busy === 'create'}
            onPress={() => run('create', onCreate)}
          />

          {!!error && <Text style={styles.error}>⚠️ {error}</Text>}
          </SafeAreaView>
        </Animated.View>
        </Animated.View>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 4,
    borderBottomWidth: 0,
    borderColor: colors.night,
    padding: 20,
    paddingBottom: 20,
    ...cartoonShadow,
  },
  sheetInner: { gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 28, color: colors.purple },
  close: {
    position: 'absolute',
    right: 0,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.night,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.night },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: {
    flex: 1,
    height: 62,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.night,
    backgroundColor: colors.cream,
    textAlign: 'center',
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: 6,
    color: colors.purple,
  },
  joinBtn: { width: 110 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.night, opacity: 0.15 },
  dividerText: { fontFamily: fonts.bold, color: colors.muted, fontSize: 16 },
  crown: { fontSize: 26 },
  error: { fontFamily: fonts.semibold, color: colors.red, textAlign: 'center', fontSize: 15 },
});
