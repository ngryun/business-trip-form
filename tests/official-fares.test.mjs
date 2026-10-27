import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOfficialFares } from '../src/bus-fares.ts';

const sample = {
  조회일: '2026-10-27',
  구간: [
    { 출발: '간성', 도착: '동서울', 등급: '일반', 요금: 25500 },
    { 출발: '간성', 도착: '동서울', 등급: '심야일반', 요금: 28000 },
    { 출발: '속초', 도착: '춘천', 등급: '우등', 요금: 16700 },
    { 출발: '속초', 도착: '동서울', 등급: '프리미엄', 요금: 29200 },
    { 출발: '속초', 도착: '동서울', 등급: '우등', 요금: 22500 },
    { 출발: '속초', 도착: '동서울', 등급: '일반', 요금: 17300 },
    { 출발: '속초', 도착: '하조대', 등급: '일반', 요금: 4200 },
  ],
};

test('도시명을 터미널명으로 맞춰 찾고 심야 등급은 뺀다', () => {
  const r = findOfficialFares('고성', '서울', sample);
  assert.deepEqual(r.map((f) => [f.등급, f.요금]), [['일반', 25500]]);
  assert.equal(findOfficialFares('서울', '고성', sample)[0].요금, 25500);
});

test('등급 순서: 일반 → 우등 → 프리미엄', () => {
  const r = findOfficialFares('속초', '동서울', sample);
  assert.deepEqual(r.map((f) => f.등급), ['일반', '우등', '프리미엄']);
  assert.equal(r[0].요금, 17300);
  assert.equal(findOfficialFares('춘천', '속초', sample)[0].등급, '우등');
});

test('양양은 하조대 정류장도 포함, 없는 구간은 빈 배열', () => {
  assert.equal(findOfficialFares('속초', '양양', sample)[0].도착, '하조대');
  assert.deepEqual(findOfficialFares('고성', '태백', sample), []);
  assert.deepEqual(findOfficialFares('', '춘천', sample), []);
});
