import assert from 'node:assert/strict';
import { test } from 'node:test';
import { naverTransitUrl, terminalQueries } from '../src/naver-transit.ts';

test('터미널 검색어: 별칭이 있으면 먼저, 그 다음 일반 후보', () => {
  assert.deepEqual(terminalQueries('고성'), ['간성시외버스터미널', '고성 시외버스터미널', '고성 버스터미널', '고성터미널']);
  assert.deepEqual(terminalQueries('서울')[0], '동서울종합터미널');
  assert.deepEqual(terminalQueries('태백'), ['태백 시외버스터미널', '태백 버스터미널', '태백터미널']);
  assert.deepEqual(terminalQueries(''), []);
});

test('네이버지도 대중교통 길찾기 주소', () => {
  const url = naverTransitUrl(
    { name: '간성시외버스터미널', x: '128.4677', y: '38.3795' },
    { name: '춘천시외버스터미널', x: '127.7231', y: '37.8658' },
  );
  assert.equal(url, 'https://map.naver.com/p/directions/128.4677,38.3795,%EA%B0%84%EC%84%B1%EC%8B%9C%EC%99%B8%EB%B2%84%EC%8A%A4%ED%84%B0%EB%AF%B8%EB%84%90/127.7231,37.8658,%EC%B6%98%EC%B2%9C%EC%8B%9C%EC%99%B8%EB%B2%84%EC%8A%A4%ED%84%B0%EB%AF%B8%EB%84%90/-/transit');
  assert.equal(decodeURIComponent(url).includes(',간성시외버스터미널/127.7231'), true);
});

test('동명 지역은 시도를 붙여 찾고, 강원 고성 별칭(간성)은 다른 시도에 쓰지 않는다', () => {
  assert.deepEqual(terminalQueries('고성', '경남'), ['경남 고성 시외버스터미널', '경남 고성 버스터미널', '경남 고성터미널']);
  assert.equal(terminalQueries('고성', '강원')[0], '간성시외버스터미널');
  assert.equal(terminalQueries('고성')[0], '간성시외버스터미널');
});
