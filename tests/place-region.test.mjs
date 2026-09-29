import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityFromAddress } from '../src/place-region.ts';

test('도 지역은 시·군 이름에서 시/군을 뗀다', () => {
  assert.equal(cityFromAddress('강원특별자치도 고성군 간성읍 신안리 123'), '고성');
  assert.equal(cityFromAddress('강원특별자치도 삼척시 교동 100'), '삼척');
  assert.equal(cityFromAddress('경기 수원시 영통구 이의동 1'), '수원');
  assert.equal(cityFromAddress('경남 고성군 고성읍'), '고성');
});

test('특별시·광역시·특별자치시는 시·도 이름을 쓴다', () => {
  assert.equal(cityFromAddress('서울 강남구 역삼동 1'), '서울');
  assert.equal(cityFromAddress('부산광역시 해운대구 우동'), '부산');
  assert.equal(cityFromAddress('세종특별자치시 어진동 1'), '세종');
});

test('주소가 비었거나 시·군이 없으면 빈 문자열', () => {
  assert.equal(cityFromAddress(''), '');
  assert.equal(cityFromAddress('강원특별자치도'), '');
});
