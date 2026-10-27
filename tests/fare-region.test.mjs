import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alternativeRegions,
  parseFareRegion,
  provinceShort,
  regionLabel,
  resolveFareRegion,
  resolveFareRoute,
  sameRegion,
  terminalsForRegion,
} from '../src/fare-region.ts';
import { findBusFares } from '../src/bus-fares.ts';
import terminals from '../src/data/tago-terminals.json' with { type: 'json' };

test('시도 이름 줄이기: 정식·옛 이름 모두', () => {
  assert.equal(provinceShort('강원특별자치도'), '강원');
  assert.equal(provinceShort('강원도'), '강원');
  assert.equal(provinceShort('경상남도'), '경남');
  assert.equal(provinceShort('경남'), '경남');
  assert.equal(provinceShort('세종특별시'), '세종');
  assert.equal(provinceShort('광주광역시'), '광주');
  assert.equal(provinceShort('고성'), '');
});

test('칸에 시도를 함께 쓰면 그대로 읽는다', () => {
  assert.deepEqual(parseFareRegion('경남 고성'), { 시도: '경남', 시군: '고성' });
  assert.deepEqual(parseFareRegion('고성(경남)'), { 시도: '경남', 시군: '고성' });
  assert.deepEqual(parseFareRegion('경상남도 고성군'), { 시도: '경남', 시군: '고성' });
  assert.deepEqual(parseFareRegion('경기도 광주시'), { 시도: '경기', 시군: '광주' });
  assert.deepEqual(parseFareRegion('경기광주'), { 시도: '경기', 시군: '광주' });
  assert.deepEqual(parseFareRegion('간성'), { 시도: '강원', 시군: '고성' });
  assert.deepEqual(parseFareRegion('춘천'), { 시도: '', 시군: '춘천' });
  assert.deepEqual(parseFareRegion('경주'), { 시도: '', 시군: '경주' });
});

test('이름이 하나뿐인 시군은 시도가 정해진다', () => {
  assert.deepEqual(resolveFareRegion('춘천'), { 시도: '강원', 시군: '춘천' });
  assert.deepEqual(resolveFareRegion('수원시'), { 시도: '경기', 시군: '수원' });
  assert.deepEqual(resolveFareRegion('동서울'), { 시도: '서울', 시군: '서울' });
  assert.deepEqual(resolveFareRegion('삼척·동해'), { 시도: '', 시군: '삼척·동해' });
  assert.equal(resolveFareRegion(''), null);
});

test('동명 지역은 반대쪽 끝점과 같은 시도, 없으면 첫 후보로 짐작한다', () => {
  assert.deepEqual(resolveFareRegion('고성', { 시도: '강원', 시군: '속초' }), { 시도: '강원', 시군: '고성', 추정: true });
  assert.deepEqual(resolveFareRegion('고성', { 시도: '경남', 시군: '창원' }), { 시도: '경남', 시군: '고성', 추정: true });
  assert.deepEqual(resolveFareRegion('고성'), { 시도: '강원', 시군: '고성', 추정: true });
  assert.deepEqual(resolveFareRegion('광주', { 시도: '경기', 시군: '성남' }), { 시도: '경기', 시군: '광주', 추정: true });
  assert.deepEqual(resolveFareRegion('광주', { 시도: '서울', 시군: '서울' }), { 시도: '광주', 시군: '광주', 추정: true });
  assert.deepEqual(resolveFareRoute('창원', '고성').to, { 시도: '경남', 시군: '고성', 추정: true });
  assert.deepEqual(resolveFareRoute('고성', '창원').from, { 시도: '경남', 시군: '고성', 추정: true });
});

test('지도 검색으로 안 시도(hint)가 짐작보다 앞선다', () => {
  const route = resolveFareRoute('고성', '고성', { from: { 시도: '강원', 시군: '고성' }, to: { 시도: '경남', 시군: '고성' } });
  assert.deepEqual(route.from, { 시도: '강원', 시군: '고성' });
  assert.deepEqual(route.to, { 시도: '경남', 시군: '고성' });
  assert.equal(sameRegion(route.from, route.to), false);
});

test('칩 이름과 바꾸기 후보', () => {
  assert.equal(regionLabel({ 시도: '경남', 시군: '고성' }), '경남 고성');
  assert.equal(regionLabel({ 시도: '광주', 시군: '광주' }), '광주광역시');
  assert.equal(regionLabel({ 시도: '경기', 시군: '광주' }), '경기 광주');
  assert.equal(regionLabel({ 시도: '강원', 시군: '춘천' }), '춘천');
  assert.deepEqual(alternativeRegions({ 시도: '강원', 시군: '고성' }), [{ 시도: '경남', 시군: '고성' }]);
  assert.deepEqual(alternativeRegions({ 시도: '강원', 시군: '춘천' }), []);
});

test('요금표(강원 고성 기준)는 경남 고성에 쓰지 않고, 강원 고성↔경남 고성은 같은 곳이 아니다', () => {
  assert.deepEqual(findBusFares({ 시도: '경남', 시군: '고성' }, { 시도: '강원', 시군: '속초' }), []);
  assert.deepEqual(findBusFares('경남 고성', '속초'), []);
  assert.equal(findBusFares({ 시도: '강원', 시군: '고성' }, { 시도: '강원', 시군: '속초' })[0].요금, 4000);
  assert.deepEqual(findBusFares({ 시도: '강원', 시군: '고성' }, { 시도: '강원', 시군: '고성' }), []);
});

test('지역 → TAGO 터미널: 별칭, 같은 이름, 이름 앞부분, 시도 안에서만', () => {
  const names = (region) => terminalsForRegion(region, terminals).map((t) => t.name);
  assert.deepEqual(names({ 시도: '강원', 시군: '고성' }), ['간성', '거진', '대진']);
  assert.deepEqual(names({ 시도: '경남', 시군: '고성' }), ['고성', '배둔']);
  assert.deepEqual(names({ 시도: '경기', 시군: '광주' }), ['광주(경기)']);
  assert.deepEqual(names({ 시도: '광주', 시군: '광주' }), ['광주(유·스퀘어)']);
  assert.equal(names({ 시도: '서울', 시군: '서울' })[0], '동서울');
  assert.equal(names({ 시도: '경기', 시군: '수원' })[0], '수원터미널');
  assert.equal(names({ 시도: '충북', 시군: '청주' })[0], '청주');
  assert.equal(names({ 시도: '강원', 시군: '춘천' })[0], '춘천');
  assert.deepEqual(names({ 시도: '강원', 시군: '없는곳' }), []);
});
