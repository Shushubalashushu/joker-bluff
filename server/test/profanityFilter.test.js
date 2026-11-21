'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { containsProfanity } = require('../src/utils/profanityFilter');

test('nickname filter allows ordinary words, names and phrases', () => {
  for (const name of [
    'סקסופון', 'התחתנתי', 'grape', 'as', 'this hits', 'Cockburn', 'Pass the Joker',
    'שמן', 'שמן זית', 'כוס', 'כוס מים', 'Zain', 'zain', 'לסבית', 'אוטיסט', '455', 'עדי 🃏',
    '', null, undefined, 123,
  ]) {
    assert.equal(containsProfanity(name), false, String(name));
  }
});

test('nickname filter matches whole words and phrases in Hebrew, transliteration and English', () => {
  for (const name of [
    'Ass!', 'RAPE', 'bad bitch', 'בן זונה', 'כוס אמא', 'סתום את הפה', 'שהזונה',
    'ben zona', 'kus emak', 'XשרמוטהX', 'XBENZONAX', 'xFuckx',
  ]) {
    assert.equal(containsProfanity(name), true, name);
  }
});

test('nickname filter recognizes obfuscation and preserves meaningful repeated letters', () => {
  for (const name of [
    'ב.ן ז.ו.נ.ה', 'ש ר מ ו ט ה', 'שַׁרְמוּטָה', 'זוווונה', 'ש\u2067רמוטה',
    'sh!t', '4ss', 'a$$', 'aasss', 'f.u.u.u.c.k', 'ｆｕｃｋ', 'xxfuuuuck99',
  ]) {
    assert.equal(containsProfanity(name), true, name);
  }
  for (const name of ['as!', 'aaas', 'a s', '4s', 'this.hits']) {
    assert.equal(containsProfanity(name), false, name);
  }
});
