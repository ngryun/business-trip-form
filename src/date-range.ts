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
export function summarizeRange(start: string, end: string): string {
  if (!start) return '시작 날짜를 고르면 종료일과 운임 일자를 함께 채웁니다.';
  if (!end) return '종료 일시를 입력해 주세요.';
  if (end < start) return '종료 일시가 시작보다 빠릅니다. 종료일 또는 시간을 확인해 주세요.';
  const minutes = Math.round((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remaining = minutes % 60;
  const duration = [days ? `${days}일` : '', hours ? `${hours}시간` : '', remaining ? `${remaining}분` : ''].filter(Boolean).join(' ') || '0분';
  const weekday = (value: string): string => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${value.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  return `${Number(start.slice(5, 7))}.${Number(start.slice(8, 10))}(${weekday(start)}) → ${Number(end.slice(5, 7))}.${Number(end.slice(8, 10))}(${weekday(end)}) · ${duration}`;
}
