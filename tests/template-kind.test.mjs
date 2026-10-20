import assert from 'node:assert/strict';
import { test } from 'node:test';
import { templateKindFor } from '../src/template-kind.ts';

test('소속에 태백교육지원청·태백교육청이 있으면 태백 양식', () => {
  assert.equal(templateKindFor('태백교육지원청'), 'taebaek');
  assert.equal(templateKindFor('강원특별자치도태백교육지원청'), 'taebaek');
  assert.equal(templateKindFor('강원특별자치도태백교육청'), 'taebaek');
  assert.equal(templateKindFor('태백 교육지원청 교육과'), 'taebaek');
});

test('그 밖의 소속은 기본 양식 (태백 관내 학교 포함)', () => {
  assert.equal(templateKindFor(''), 'default');
  assert.equal(templateKindFor('강원특별자치도고성교육지원청'), 'default');
  assert.equal(templateKindFor('태백고등학교'), 'default');
});
