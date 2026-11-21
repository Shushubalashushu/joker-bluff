'use strict';

// These terms are distinctive enough to match inside a single nickname word.
const AGGRESSIVE_WORDS = [
  'שרמוט', 'בנזונה', 'בןזונה', 'בתזונה', 'בניזונות', 'כוסאמק', 'כוסעמק',
  'מזדיין', 'תזדיין', 'להזדיין', 'קוקסינל',
  'sharmuta', 'sharmota', 'benzona', 'batzona', 'kusemek', 'kusamak',
  'fuck', 'asshole', 'faggot',
];

const PREFIXED_WORDS = new Set([
  'שרמוטה', 'שרמוטות', 'מזדיינת', 'מזדיינים', 'תזדייני', 'הזדיין',
  'זין', 'זונה', 'זונות', 'זיין', 'זיינת', 'מזיין', 'מזיינת', 'לזיין',
  'מניאק', 'מניאקים', 'מנאייק', 'כוסית',
  'מטומטם', 'מטומטמת', 'מפגר', 'מפגרת', 'דביל', 'דבילית', 'אדיוט', 'אידיוט',
  'חרא', 'מחרבן', 'מחורבן', 'שמוק', 'פוץ', 'זרג', 'פדופיל',
]);
const WHOLE_WORDS = new Set([
  ...PREFIXED_WORDS,
  'בנזונות', 'כוסאמא', 'כוסאחות', 'סקס', 'פורנו', 'נאצי', 'נאצים', 'תתאבד',
  'kosamak', 'kusima', 'mezdayen', 'lezayen', 'tezdayen', 'maniyak', 'maniak',
  'koksinal', 'mefager', 'metumtam', 'zona', 'hara',
  'fck', 'fuk', 'shit', 'bitch', 'btch', 'bastard', 'dick', 'cock', 'pussy', 'whore',
  'slut', 'cunt', 'nigger', 'nigga', 'retard', 'porn', 'rape', 'kys',
  'ass', 'sex', 'cum', 'tit', 'tits', 'fag', 'wtf', 'stfu', 'nazi',
]);
const PHRASES = [
  'בן זונה', 'בת זונה', 'בני זונות', 'כוס אמא', 'כוס אמך', 'כוס אמק',
  'כוס עמק', 'כוס אחותך', 'כוס רבאק', 'סתום את הפה', 'סתמי את הפה',
  'ben zona', 'bat zona', 'kus emak', 'kus ima', 'kus rabbak', 'lech tizdayen',
];

// Common attached Hebrew prefixes are checked only for these offensive words.
const HEBREW_PREFIX = /^(?:[בהוכלמש]|[וש][בהכלמ])$/u;
const WORDS = /[\p{L}\p{M}\p{N}]+/gu;
const WORDS_WITH_LEET_SYMBOLS = /[\p{L}\p{M}\p{N}@$!]+/gu;
const LETTER = /\p{L}/u;
const LOOKALIKES = {
  4: 'a', '@': 'a', 3: 'e', 1: 'i', '!': 'i', 0: 'o', 5: 's', '$': 's', 7: 't',
  ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ',
};

function foldLookalikes(text) {
  return text.replace(/[431057@$!ךםןףץ]/g, (letter) => LOOKALIKES[letter]);
}

function collapseRepeats(text) {
  return text.replace(/(.)\1+/gu, '$1');
}

function elongationPattern(term) {
  // Require at least the original spelling's repeat count so "as" can't match "ass".
  return term.replace(/(.)\1*/gu, (run, letter) => `${letter}{${run.length},}`);
}

const OBFUSCATED_TERMS = new Map();
for (const term of [...AGGRESSIVE_WORDS, ...WHOLE_WORDS, ...PHRASES]) {
  const folded = foldLookalikes(term.replaceAll(' ', ''));
  const key = collapseRepeats(folded);
  const variants = OBFUSCATED_TERMS.get(key) ?? [];
  variants.push(new RegExp(`^${elongationPattern(folded)}$`, 'u'));
  OBFUSCATED_TERMS.set(key, variants);
}
const MAX_TERM_LENGTH = Math.max(...Array.from(OBFUSCATED_TERMS.keys(), (key) => key.length));
const OBFUSCATED_AGGRESSIVE = new RegExp(
  AGGRESSIVE_WORDS.map((word) => elongationPattern(foldLookalikes(word))).join('|'),
  'u'
);

function matchesObfuscation(parts) {
  const folded = parts.map(foldLookalikes);
  for (let start = 0; start < parts.length; start++) {
    if (LETTER.test(parts[start]) && OBFUSCATED_AGGRESSIVE.test(folded[start])) return true;

    let candidate = '';
    let hasLetter = false;
    for (let end = start; end < parts.length; end++) {
      candidate += folded[end];
      hasLetter ||= LETTER.test(parts[end]);
      const key = collapseRepeats(candidate);
      if (key.length > MAX_TERM_LENGTH) break;
      if (hasLetter && OBFUSCATED_TERMS.get(key)?.some((pattern) => pattern.test(candidate))) return true;
    }
  }
  return false;
}

function containsProfanity(nickname) {
  if (typeof nickname !== 'string' || !nickname) return false;
  const text = nickname.normalize('NFKC').toLowerCase()
    .replace(/[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7\p{Default_Ignorable_Code_Point}]/gu, '');
  const words = text.match(WORDS) ?? [];

  for (const word of words) {
    if (WHOLE_WORDS.has(word) || AGGRESSIVE_WORDS.some((term) => word.includes(term))) return true;
    for (const length of [1, 2]) {
      if (HEBREW_PREFIX.test(word.slice(0, length)) && PREFIXED_WORDS.has(word.slice(length))) return true;
    }
  }

  const phraseText = ` ${words.join(' ')} `;
  if (PHRASES.some((phrase) => phraseText.includes(` ${phrase} `))) return true;

  // Obfuscated whole words can contain separators. Substring matching stays inside one
  // word so adjacent clean words can't accidentally form an offensive substring.
  return matchesObfuscation(words)
    || (/[@$!]/.test(text) && matchesObfuscation(text.match(WORDS_WITH_LEET_SYMBOLS) ?? []));
}

module.exports = { containsProfanity };
