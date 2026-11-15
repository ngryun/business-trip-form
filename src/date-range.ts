/** 날짜 이동은 UTC의 달력 날짜로 계산하여 월말·윤년·일광절약시간 경계를 처리한다. */
export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function suggestEnd(start: string, previousStart: string, end: string): string {
  if (!start) return end;
  if (!end) return `${start.slice(0, 10)}T${start.slice(11) > '18:00' ? start.slice(11) : '18:00'}`;
  if (!previousStart || end < previousStart || start.slice(0, 10) === previousStart.slice(0, 10)) return end;
  const days = (Date.parse(`${start.slice(0, 10)}T00:00:00Z`) - Date.parse(`${previousStart.slice(0, 10)}T00:00:00Z`)) / 86400000;
  return `${shiftDate(end.slice(0, 10), days)}${end.slice(10)}`;
}
export function summarizeRange(start: string, end: string, today = todayDateValue()): string {
  if (!start) return '시작 날짜를 고르면 종료일과 운임 일자를 함께 채웁니다.';
  if (!end) return '종료 일시를 입력해 주세요.';
  if (end < start) return '종료 일시가 시작보다 빠릅니다. 종료일 또는 시간을 확인해 주세요.';
  const minutes = Math.round((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remaining = minutes % 60;
  const duration = [days ? `${days}일` : '', hours ? `${hours}시간` : '', remaining ? `${remaining}분` : ''].filter(Boolean).join(' ') || '0분';
  const weekday = (value: string): string => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${value.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  // 올해가 아닌 시작일, 시작과 해가 다른 종료일에는 연도를 붙인다 — 연도를 비우고 적었을 때 어느 해로 들어갔는지 보이게.
  const label = (value: string, withYear: boolean): string =>
    `${withYear ? `${Number(value.slice(0, 4))}.` : ''}${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}(${weekday(value)})`;
  const startLabel = label(start, start.slice(0, 4) !== today.slice(0, 4));
  const endLabel = label(end, end.slice(0, 4) !== start.slice(0, 4));
  return `${startLabel} → ${endLabel} · ${duration}`;
}
/**
 * 연도를 비우고 월·일만 적었을 때의 날짜. 정산은 대개 지난 출장이라 오늘 기준 9개월 전부터 3개월 뒤까지에서 해를 고른다
 * (1월 초에 12.28 을 적으면 지난해, 11월에 1.15 를 적으면 다음 해). 있는 날짜인지는 부른 쪽이 따로 본다.
 */
export function resolveYearlessDate(month: string, day: string, today = todayDateValue()): string {
  const monthDay = `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const year = Number(today.slice(0, 4));
  const from = shiftDate(today, -273);
  const to = shiftDate(today, 92);
  const candidates = [year, year - 1, year + 1].map((y) => `${String(y).padStart(4, '0')}-${monthDay}`);
  return candidates.find((value) => value >= from && value < to) ?? candidates[0];
}
/** 제출날짜 기본값 — 오늘, 단 출장이 아직 끝나지 않았으면(종료일이 오늘 이후) 종료 다음날. */
export function defaultSubmitDate(endDate: string, today = todayDateValue()): string {
  return endDate && endDate > today ? shiftDate(endDate, 1) : today;
}
/** 오늘 날짜를 기기 시간대 기준 `YYYY-MM-DD` 로 */
export function todayDateValue(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
