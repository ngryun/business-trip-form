/**
 * 한국어 조사 붙이기.
 */

/** "경남 고성" → "경남 고성으로", "광주광역시" → "광주광역시로" (받침 없거나 ㄹ 받침이면 "로"). */
export function withEuro(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}(으)로`;
  const final = code % 28;
  return `${word}${final === 0 || final === 8 ? '로' : '으로'}`;
}
