import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STAMP_SETTINGS, normalizeStampSettings } from '../src/stamp-generator.ts';

test('저장된 도장 설정이 없거나 깨졌으면 기본값', () => {
  assert.deepEqual(normalizeStampSettings(null), { ...DEFAULT_STAMP_SETTINGS });
  assert.deepEqual(normalizeStampSettings('x'), { ...DEFAULT_STAMP_SETTINGS });
});

test('도장 설정은 항목마다 검사해 잘못된 값만 기본값으로 메운다', () => {
  const r = normalizeStampSettings({ fontIdx: 1, suffix: '印', style: 'eum', ink: 140, grain: -5, rough: 'a' });
  assert.deepEqual(r, { fontIdx: 1, suffix: '印', style: 'eum', ink: 100, grain: 0, rough: DEFAULT_STAMP_SETTINGS.rough });
  assert.equal(normalizeStampSettings({ fontIdx: 99 }).fontIdx, 0);
  assert.equal(normalizeStampSettings({ suffix: '도장' }).suffix, '인');
  assert.equal(normalizeStampSettings({ suffix: '' }).suffix, '');
});
