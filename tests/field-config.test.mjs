import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDateTimeRange, parseDateTimeRange } from '../src/field-config.ts';

test('출장 일시 범위는 같은 날이면 종료 시간만, 다른 날이면 연도를 뺀 종료 날짜를 쓴다', () => {
  assert.equal(formatDateTimeRange('2026-05-07T14:00', '2026-05-07T18:00'), '2026. 5.7 14:00 ~ 18:00');
  assert.equal(formatDateTimeRange('2026-05-07T14:00', '2026-05-08T18:00'), '2026. 5.7 14:00 ~ 5.8 18:00');
  assert.equal(formatDateTimeRange('2026-05-07T14:00', ''), '2026. 5.7 14:00');
});

test('해를 넘기는 출장은 종료에도 연도를 써서 다시 읽어도 종료 연도가 앞당겨지지 않는다', () => {
  const text = formatDateTimeRange('2026-12-31T09:00', '2027-01-01T18:00');
  assert.equal(text, '2026. 12.31 09:00 ~ 2027. 1.1 18:00');
  assert.deepEqual(parseDateTimeRange(text), { start: '2026-12-31T09:00', end: '2027-01-01T18:00' });
});

test('범위 문자열을 다시 읽으면 원래 시작·종료로 돌아온다', () => {
  for (const [start, end] of [
    ['2026-05-07T14:00', '2026-05-07T18:00'],
    ['2026-05-07T14:00', '2026-05-08T18:00'],
    ['2026-02-28T09:00', '2026-03-01T17:30'],
    ['2026-10-05T09:00', '2026-10-03T18:00'], // 종료가 시작보다 빠른 잘못된 입력도 그대로 돌아와야 경고가 남는다
  ]) {
    assert.deepEqual(parseDateTimeRange(formatDateTimeRange(start, end)), { start, end });
  }
});
