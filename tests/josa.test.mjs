import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withEuro } from '../src/josa.ts';

test('받침이 없거나 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로"', () => {
  assert.equal(withEuro('광주광역시'), '광주광역시로');
  assert.equal(withEuro('서울'), '서울로');
  assert.equal(withEuro('경남 고성'), '경남 고성으로');
  assert.equal(withEuro('강원 속초'), '강원 속초로');
});

test('한글로 끝나지 않으면 받침을 알 수 없어 "(으)로"', () => {
  assert.equal(withEuro('KTX'), 'KTX(으)로');
  assert.equal(withEuro('3'), '3(으)로');
});
