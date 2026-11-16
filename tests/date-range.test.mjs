import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSubmitDate, resolveYearlessDate, shiftDate, suggestEnd, summarizeRange } from '../src/date-range.ts';
test('연도를 비운 날짜는 오늘 기준 9개월 전~3개월 뒤에 드는 해로 본다 (정산은 대개 지난 출장)', () => {
  assert.equal(resolveYearlessDate('12', '28', '2027-01-05'), '2026-12-28', '1월 초에 적는 지난 12월 출장');
  assert.equal(resolveYearlessDate('1', '15', '2026-11-14'), '2027-01-15', '11월에 미리 적는 다음 1월 연수');
  assert.equal(resolveYearlessDate('4', '10', '2026-11-14'), '2026-04-10', '7개월 늦은 정산도 지난 출장으로');
  assert.equal(resolveYearlessDate('01', '02', '2026-12-20'), '2027-01-02');
  assert.equal(resolveYearlessDate('7', '20', '2027-02-10'), '2026-07-20');
  assert.equal(resolveYearlessDate('11', '14', '2026-11-14'), '2026-11-14');
});
test('요약에는 올해가 아닌 시작일과 시작과 해가 다른 종료일에만 연도를 붙인다', () => {
  assert.match(summarizeRange('2026-12-28T09:00', '2026-12-29T18:00', '2026-12-30'), /^12\.28\(월\) → 12\.29\(화\)/);
  assert.match(summarizeRange('2026-12-28T09:00', '2026-12-29T18:00', '2027-01-05'), /^2026\.12\.28\(월\) → 12\.29\(화\)/);
  assert.match(summarizeRange('2026-12-30T09:00', '2027-01-02T18:00', '2026-12-20'), /^12\.30\(수\) → 2027\.1\.2\(토\)/);
});
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
test('제출날짜 기본값은 오늘, 출장이 오늘 이후에 끝나면 종료 다음날', () => {
  assert.equal(defaultSubmitDate('', '2026-09-29'), '2026-09-29');
  assert.equal(defaultSubmitDate('2026-09-19', '2026-09-29'), '2026-09-29');
  assert.equal(defaultSubmitDate('2026-09-29', '2026-09-29'), '2026-09-29');
  assert.equal(defaultSubmitDate('2026-09-30', '2026-09-29'), '2026-10-01');
  assert.equal(defaultSubmitDate('2026-12-31', '2026-09-29'), '2027-01-01');
});