import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUS_FARES, busFareLabel, findBusFares, formatWon, normalizeFareCity } from '../src/bus-fares.ts';

test('요금표 구간 수와 대표 금액 (2026. 1. 13. 기준표)', () => {
  assert.equal(BUS_FARES.filter((f) => f.출발 === '고성').length, 12);
  assert.equal(BUS_FARES.filter((f) => f.출발 === '속초').length, 12);
  assert.equal(findBusFares('고성', '속초')[0].요금, 4000);
  assert.equal(findBusFares('고성', '춘천')[0].요금, 19700);
  assert.equal(findBusFares('고성', '원주')[0].요금, 26800);
  assert.equal(findBusFares('속초', '춘천')[0].요금, 15700);
});

test('도시명 정규화: 공백·시/군, 간성→고성, 동서울→서울', () => {
  assert.equal(normalizeFareCity('고성군'), '고성');
  assert.equal(normalizeFareCity('간성'), '고성');
  assert.equal(normalizeFareCity(' 춘천 시 '), '춘천');
  assert.equal(normalizeFareCity('동서울'), '서울');
  assert.equal(normalizeFareCity('서울특별시'), '서울');
  assert.equal(normalizeFareCity('삼척'), '삼척');
  assert.equal(normalizeFareCity(''), '');
});

test('반대 방향(올 때)도 같은 금액, 서울은 동서울 요금', () => {
  assert.equal(findBusFares('춘천', '고성')[0].요금, 19700);
  assert.equal(findBusFares('서울', '고성')[0].요금, 23400);
  assert.equal(findBusFares('고성', '서울')[0].행선지, '동서울');
  assert.equal(findBusFares('속초', '서울')[0].요금, 16700);
});

test('같은 도시의 다른 정류장은 보조 후보로 뒤에 온다', () => {
  const inje = findBusFares('고성', '인제');
  assert.deepEqual(inje.map((f) => f.행선지), ['인제', '신남']);
  const pyeongchang = findBusFares('평창', '속초');
  assert.deepEqual(pyeongchang.map((f) => f.요금), [14400, 10800]);
  const yangyang = findBusFares('속초', '양양');
  assert.deepEqual(yangyang.map((f) => f.행선지), ['양양', '하조대']);
});

test('표에 없는 구간·같은 도시·빈 값은 후보 없음', () => {
  assert.deepEqual(findBusFares('고성', '태백'), []);
  assert.deepEqual(findBusFares('춘천', '원주'), []);
  assert.deepEqual(findBusFares('고성', '고성'), []);
  assert.deepEqual(findBusFares('', '춘천'), []);
  assert.deepEqual(findBusFares('삼척·동해', '고성'), []);
});

test('칩 문구와 금액 표기', () => {
  assert.equal(formatWon(19700), '19,700');
  assert.equal(busFareLabel(findBusFares('고성', '춘천')[0]), '고성→춘천(속초) 19,700');
});
