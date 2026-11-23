export function playerName(player, t, lang, fallback = 'common.aPlayer') {
  return player?.botName?.[lang] ?? player?.nickname ?? t(fallback);
}
