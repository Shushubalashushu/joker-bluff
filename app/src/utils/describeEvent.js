import { translate } from '../i18n';

const fallbackT = (key, params) => translate('en', key, params);

/**
 * Turns a public server event into a short, friendly line for the toast.
 * Events never contain card identities (the server guarantees that).
 * `t` = the active-language translate function from useI18n() (English if omitted).
 */
export function describeEvent(e, nameOf, myId, t = fallbackT) {
  if (!e) return null;
  const who = (id) => (id === myId ? t('common.you') : nameOf(id));
  switch (e.type) {
    case 'game_started':
      return t('event.gameStarted', { who: who(e.holderId) });
    case 'card_requested':
      return t('event.cardRequested', { who: who(e.playerId), target: who(e.targetId), rank: e.rank });
    case 'card_offered':
      if (e.claimedNoCard) return t('event.cardOfferedClaim', { who: who(e.playerId), rank: e.rank, n: e.offerNumber });
      return e.forced ? t('event.cardOfferedForced') : t('event.cardOffered', { n: e.offerNumber });
    case 'offer_rejected':
      return e.nextIsForced ? t('event.offerRejectedNextForced') : t('event.offerRejected', { who: who(e.playerId), n: e.offerNumber });
    case 'card_transferred':
      if (e.claimedNoCard) return t(e.forced ? 'event.transferForcedClaim' : 'event.transferClaim', { who: who(e.toId), giver: who(e.fromId), rank: e.claimedRank });
      return e.forced ? t('event.transferForced', { who: who(e.toId) }) : t('event.transfer', { who: who(e.toId), n: e.offerNumber });
    case 'timeout':
      return t('event.timeout', { who: who(e.playerId) });
    case 'game_over':
      return t('event.gameOver', { who: who(e.winnerId), rank: e.winningRank });
    case 'lie_deye_used':
      return e.targetId === myId ? t('event.lieDeyeOnYou', { who: who(e.playerId) }) : t('event.lieDeyeUsed', { who: who(e.playerId), seconds: Math.ceil(e.durationMs / 1000) });
    case 'lie_deye_bonus':
      return t('event.lieDeyeBonus', { who: who(e.playerId), amount: e.amount, balance: e.balance });
    case 'game_aborted':
      return describeAbort(e, nameOf, myId, t);
    default:
      return null;
  }
}

/** Why a match was terminated (used by the toast and the waiting-room banner). */
export function describeAbort(e, nameOf, myId, t = fallbackT) {
  if (!e) return null;
  const name = e.playerId === myId ? t('common.you') : e.nickname || (nameOf ? nameOf(e.playerId) : t('common.aPlayer'));
  switch (e.reason) {
    case 'server_error':
      return t('abort.serverError');
    case 'host_ended':
      return t('abort.hostEnded', { name });
    case 'player_disconnected':
      return t('abort.disconnected', { name });
    case 'player_left':
    default:
      return t('abort.left', { name });
  }
}
