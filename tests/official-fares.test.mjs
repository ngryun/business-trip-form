import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOfficialFares, mergeOfficialFares, summarizeFareRows } from '../src/bus-fares.ts';

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

test('내장 자료도 시도를 가린다: 경남 고성은 간성 자료를 쓰지 않는다', () => {
  assert.deepEqual(findOfficialFares({ 시도: '경남', 시군: '고성' }, { 시도: '서울', 시군: '서울' }, sample), []);
  assert.equal(findOfficialFares({ 시도: '강원', 시군: '고성' }, { 시도: '서울', 시군: '서울' }, sample)[0].요금, 25500);
});

test('TAGO 배차 목록을 등급별 최저 요금으로 묶는다', () => {
  const rows = [
    { charge: 25500, gradeNm: '일반' }, { charge: 24000, gradeNm: '일반' },
    { charge: 30000, gradeNm: '우등' }, { charge: 33000, gradeNm: '심야우등' }, { charge: 0, gradeNm: '일반' },
  ];
  const r = summarizeFareRows(rows, { 출발: '간성', 도착: '동서울', 실시간: true });
  assert.deepEqual(r.map((f) => [f.등급, f.요금]), [['일반', 24000], ['우등', 30000]]);
  assert.equal(r[0].실시간, true);
});

test('고속버스 등급: 고속(일반) → 우등 → 프리미엄, 심야는 뺀다', () => {
  const rows = [
    { charge: 32700, gradeNm: '우등' }, { charge: 39200, gradeNm: '심야우등' },
    { charge: 22100, gradeNm: '고속' }, { charge: 34000, gradeNm: '프리미엄' },
  ];
  const r = summarizeFareRows(rows, { 출발: '서울경부', 도착: '동대구', 실시간: true, 고속: true });
  assert.deepEqual(r.map((f) => [f.등급, f.요금]), [['고속', 22100], ['우등', 32700], ['프리미엄', 34000]]);
  assert.equal(r[0].고속, true);
});

test('여러 터미널 쌍의 요금은 등급별 최저로 합치고, 그 요금의 터미널을 남긴다', () => {
  const r = mergeOfficialFares([
    [{ 출발: '동서울', 도착: '양양', 등급: '우등', 요금: 20100 }, { 출발: '동서울', 도착: '양양', 등급: '프리미엄', 요금: 26100 }],
    [],
    [{ 출발: '서울경부', 도착: '양양', 등급: '고속', 요금: 16700 }, { 출발: '서울경부', 도착: '양양', 등급: '우등', 요금: 21700 }],
  ]);
  assert.deepEqual(r.map((f) => [f.출발, f.등급, f.요금]), [['서울경부', '고속', 16700], ['동서울', '우등', 20100], ['동서울', '프리미엄', 26100]]);
  assert.deepEqual(mergeOfficialFares([[], []]), []);
});
