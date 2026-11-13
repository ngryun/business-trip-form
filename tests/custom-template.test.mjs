import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CUSTOM_TEMPLATE_MAX_BYTES, base64ToBytes, bytesToBase64, clearCustomTemplate, customTemplateProblem, loadCustomTemplate, saveCustomTemplate } from '../src/custom-template.ts';

const template = new Uint8Array(readFileSync(new URL('../public/templates/business-trip.hwp', import.meta.url)));

/** 테스트용 localStorage — 용량 한도를 넘으면 브라우저처럼 예외 */
function fakeStorage(limit = Infinity) {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { if (value.length > limit) throw new Error('QuotaExceededError'); map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('base64 변환은 큰 파일도 그대로 되돌린다', () => {
  assert.deepEqual(base64ToBytes(bytesToBase64(template)), template);
  const big = Uint8Array.from({ length: 200_000 }, (_, i) => i % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(big)), big);
  assert.equal(bytesToBase64(new Uint8Array()), '');
});

test('HWP 파일만 양식으로 받는다', () => {
  assert.equal(customTemplateProblem(template), null);
  assert.match(customTemplateProblem(new Uint8Array()), /빈 파일/);
  assert.match(customTemplateProblem(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), /HWPX/);
  assert.match(customTemplateProblem(new TextEncoder().encode('<!doctype html>')), /HWP\) 파일이 아닙니다/);
  const huge = new Uint8Array(CUSTOM_TEMPLATE_MAX_BYTES + 1);
  huge.set(template.subarray(0, 8));
  assert.match(customTemplateProblem(huge), /너무 큽니다/);
});

test('올린 양식을 저장하고 다시 읽고 지운다', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(loadCustomTemplate(), null);
  assert.equal(saveCustomTemplate({ name: '우리 기관.hwp', bytes: template }), true);
  const loaded = loadCustomTemplate();
  assert.equal(loaded.name, '우리 기관.hwp');
  assert.deepEqual(loaded.bytes, template);
  clearCustomTemplate();
  assert.equal(loadCustomTemplate(), null);
});

test('저장소가 꽉 찼거나 저장본이 깨졌으면 조용히 넘어간다', () => {
  globalThis.localStorage = fakeStorage(100);
  assert.equal(saveCustomTemplate({ name: 'a.hwp', bytes: template }), false);
  assert.equal(loadCustomTemplate(), null);

  const storage = fakeStorage();
  globalThis.localStorage = storage;
  for (const broken of ['{', '[]', '{"name":"a.hwp"}', '{"name":"a.hwp","data":"!!!"}', JSON.stringify({ name: 'a.hwp', data: bytesToBase64(new TextEncoder().encode('not hwp')) })]) {
    storage.setItem('business-trip-form:custom-template:v1', broken);
    assert.equal(loadCustomTemplate(), null, broken);
  }
});
