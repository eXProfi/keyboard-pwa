/*
  Korean input without an IME: each key is one jamo (letter), and the text
  owner joins it with the previous character into a Hangul syllable, the way
  the standard two-set (dubeolsik) keyboard does. The function is stateless:
  it looks only at the last character, so backspace, clear, MCP commands and
  reloads can never leave a hidden half-typed syllable behind.

  Syllable code = 0xAC00 + (initial * 21 + vowel) * 28 + final.
*/

const SYLLABLE_BASE = 0xAC00;
const SYLLABLE_LAST = 0xD7A3;
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
// Index 0 means "no final consonant".
const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const COMPOUND_VOWELS = Object.freeze({
  'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ'
});
const COMPOUND_FINALS = Object.freeze({
  'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ',
  'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ'
});
const SPLIT_FINALS = Object.freeze(Object.fromEntries(
  Object.entries(COMPOUND_FINALS).map(([pair, joined]) => [joined, [pair[0], pair[1]]])
));

function syllable(initial, vowel, final) {
  return String.fromCharCode(SYLLABLE_BASE + (initial * 21 + vowel) * 28 + final);
}

function decode(character) {
  const code = character.charCodeAt(0);
  if (character.length !== 1 || code < SYLLABLE_BASE || code > SYLLABLE_LAST) return null;
  const offset = code - SYLLABLE_BASE;
  return {initial: Math.floor(offset / 588), vowel: Math.floor((offset % 588) / 28), final: offset % 28};
}

/** Return `text` with one jamo typed after it. Non-jamo input is appended. */
export function composeHangul(text, jamo) {
  const previous = text.slice(-1);
  const head = text.slice(0, -1);
  const block = previous ? decode(previous) : null;
  const vowelIndex = VOWELS.indexOf(jamo);

  if (vowelIndex === -1) {
    // A consonant becomes the final of an open syllable or joins its final.
    if (INITIALS.indexOf(jamo) === -1 || !block) return text + jamo;
    if (block.final === 0) {
      const finalIndex = FINALS.indexOf(jamo);
      return finalIndex > 0 ? head + syllable(block.initial, block.vowel, finalIndex) : text + jamo;
    }
    const joined = COMPOUND_FINALS[FINALS[block.final] + jamo];
    return joined ? head + syllable(block.initial, block.vowel, FINALS.indexOf(joined)) : text + jamo;
  }

  const initialIndex = INITIALS.indexOf(previous);
  if (previous && initialIndex !== -1) return head + syllable(initialIndex, vowelIndex, 0);
  if (previous && VOWELS.indexOf(previous) !== -1) {
    const joined = COMPOUND_VOWELS[previous + jamo];
    return joined ? head + joined : text + jamo;
  }
  if (!block) return text + jamo;
  if (block.final === 0) {
    const joined = COMPOUND_VOWELS[VOWELS[block.vowel] + jamo];
    return joined ? head + syllable(block.initial, VOWELS.indexOf(joined), 0) : text + jamo;
  }
  // A vowel after a closed syllable takes its last consonant: 각 + ㅏ → 가가.
  const final = FINALS[block.final];
  const split = SPLIT_FINALS[final];
  if (split) {
    return head + syllable(block.initial, block.vowel, FINALS.indexOf(split[0])) +
      syllable(INITIALS.indexOf(split[1]), vowelIndex, 0);
  }
  return head + syllable(block.initial, block.vowel, 0) + syllable(INITIALS.indexOf(final), vowelIndex, 0);
}
