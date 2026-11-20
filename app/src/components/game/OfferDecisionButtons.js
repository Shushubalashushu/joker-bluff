import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import CartoonButton from '../common/CartoonButton';
import { useI18n } from '../../i18n';
import { colors, gradients } from '../../theme';

export default function OfferDecisionButtons({ offerCount, onDecide, busy, compact = false }) {
  const { t } = useI18n();
  const choosing = offerCount === 2;
  const size = compact || choosing ? 'sm' : 'md';
  const reject = (
    <CartoonButton title={t(choosing ? 'action.rejectSecond' : 'action.reject')} size={size} gradient={gradients.danger}
      lipColor={colors.darkRed} icon={choosing ? null : <Text style={styles.icon}>✋</Text>}
      disabled={busy} onPress={() => onDecide(false)} style={styles.button} />
  );

  return (
    <View style={styles.row}>
      {!choosing && reject}
      {choosing && (
        <CartoonButton title={t('action.takeFirst')} size={size} gradient={gradients.blue} lipColor={colors.darkBlue}
          disabled={busy} onPress={() => onDecide(true, 0)} style={styles.button} />
      )}
      <CartoonButton title={t(choosing ? 'action.takeSecond' : 'action.take')} size={size} gradient={gradients.success}
        lipColor={colors.darkGreen} icon={choosing ? null : <Text style={styles.icon}>🤲</Text>}
        disabled={busy} onPress={() => onDecide(true, offerCount - 1)} style={styles.button} />
      {choosing && reject}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  button: { flex: 1, minWidth: 0 },
  icon: { fontSize: 20 },
});
