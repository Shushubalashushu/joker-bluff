import React from 'react';
import { Text } from 'react-native';
import { useI18n } from '../../i18n';
import { rich } from '../../i18n/rich';
import { noTranslateProps } from '../../utils/webTranslation';

export default function OfferDeclaration({ declaration, number, style }) {
  const { t, textStyle } = useI18n();
  if (!declaration) return null;
  const { requestedRank, substituteRank } = declaration;
  const rankText = (rank) => rank === 'JOKER' ? t('hand.joker') : <Text {...noTranslateProps}>{rank}</Text>;
  return (
    <Text style={[style, textStyle]}>
      {number != null && `${t('table.offerN', { n: number })} · `}
      {rich(t(substituteRank ? 'declaration.substitute' : 'declaration.standard'), {
        requested: rankText(requestedRank),
        substitute: substituteRank && rankText(substituteRank),
      })}
    </Text>
  );
}
