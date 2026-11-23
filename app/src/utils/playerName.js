export function playerName(player, t, fallback = 'common.aPlayer') {
  if (!player?.botPersonality) return player?.nickname ?? t(fallback);
  const name = t(`bots.${player.botPersonality}`);
  return player.botNumber > 1 ? t('bots.numbered', { name, number: player.botNumber }) : name;
}
