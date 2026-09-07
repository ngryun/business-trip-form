import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shiftDate, suggestEnd, summarizeRange } from '../src/date-range.ts';
test('시작일 이동 시 기존 숙박 일수와 종료 시간을 유지한다', () => {
  assert.equal(suggestEnd('2026-12-31T09:00', '2026-09-08T09:00', '2026-09-09T17:30'), '2027-01-01T17:30');
  assert.equal(suggestEnd('2026-09-08T13:00', '2026-09-08T09:00', '2026-09-08T17:30'), '2026-09-08T17:30');
});
test('종료 기본값은 야간 시작보다 빠르지 않고 기존 입력은 보존한다', () => {
  assert.equal(suggestEnd('2026-09-08T09:00', '', ''), '2026-09-08T18:00');
  assert.equal(suggestEnd('2026-09-08T20:00', '', ''), '2026-09-08T20:00');
  assert.equal(suggestEnd('', '2026-09-08T09:00', '2026-09-08T18:00'), '2026-09-08T18:00');
});
test('윤년과 월말 이동 및 출장 요약', () => {
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDate('2028-02-29', 1), '2028-03-01');
  assert.match(summarizeRange('2026-09-08T09:00', '2026-09-09T18:30'), /1일 9시간 30분/);
  assert.match(summarizeRange('2026-09-08T09:00', '2026-09-07T18:00'), /시작보다 빠릅니다/);
});
