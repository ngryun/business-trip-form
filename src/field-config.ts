/**
 * 누름틀 라벨 → 입력 위젯 매핑 + 한국식 포맷 변환 유틸.
 *
 * 한 곳에서 정의해서 사이드패널 폼과 인라인 팝오버가 같은 규칙을 따르게 한다.
 */

export type WidgetConfig =
  | { type: 'text' }
  | { type: 'textarea'; rows?: number }
  | { type: 'datetime' }
  | { type: 'date' }
  | { type: 'select'; options: string[] };

const TRANSPORT_OPTIONS = ['자가용', '버스', '기차/KTX', '항공', '지하철', '택시'];
export const DATETIME_MINUTE_STEP = 10;
export const DATETIME_STEP_SECONDS = DATETIME_MINUTE_STEP * 60;
export const DATETIME_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i));
export const DATETIME_MINUTE_OPTIONS = Array.from({ length: 60 / DATETIME_MINUTE_STEP }, (_, i) => pad2(i * DATETIME_MINUTE_STEP));

export const FIELD_CONFIGS: Record<string, WidgetConfig> = {
  소속: { type: 'text' },
  직급: { type: 'text' },
  성명: { type: 'text' },
  // 같은 사람을 다른 라벨로 표기한 양식 대응 — discoverFields 에서 두 라벨이 같은 fieldId 목록을 가리키게 됨
  이름: { type: 'text' },
  시작일시: { type: 'datetime' },
  종료일시: { type: 'datetime' },
  출장지: { type: 'text' },
  갈때일자: { type: 'date' },
  갈때교통편: { type: 'select', options: TRANSPORT_OPTIONS },
  갈때출발지: { type: 'text' },
  갈때도착지: { type: 'text' },
  올때일자: { type: 'date' },
  올때교통편: { type: 'select', options: TRANSPORT_OPTIONS },
  올때출발지: { type: 'text' },
  올때도착지: { type: 'text' },
  제출날짜: { type: 'date' },
  첨부서류: { type: 'textarea', rows: 2 },
};

/** datetime-local 입력값을 가장 가까운 10분 단위로 정규화 */
export function normalizeDateTimeLocalStep(value: string): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return value;

  const [, y, m, d, hh, mm] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return value;

  const totalMinutes = Number(hh) * 60 + Number(mm);
  const snappedMinutes = Math.round(totalMinutes / DATETIME_MINUTE_STEP) * DATETIME_MINUTE_STEP;
  date.setMinutes(snappedMinutes);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function composeDateTimeLocalValue(date: string, hour: string, minute: string): string {
  if (!date || !hour || !minute) return '';
  return normalizeDateTimeLocalStep(`${date}T${hour}:${minute}`);
}

export function splitDateTimeLocal(value: string): { date: string; hour: string; minute: string } {
  const normalized = normalizeDateTimeLocalStep(value);
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { date: '', hour: '', minute: '' };
  return { date: match[1], hour: match[2], minute: match[3] };
}

/** datetime-local 폼 값 (`2026-05-22T14:00`) → 한국식 (`2026. 05. 22. 14:00`) */
export function formatDateTimeKR(value: string): string {
  if (!value) return '';
  const normalized = normalizeDateTimeLocalStep(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return value;
  return `${match[1]}. ${match[2]}. ${match[3]}. ${match[4]}:${match[5]}`;
}

/** 좁은 HWP 누름틀용 datetime 표시 (`5.22 14:00`) */
export function formatDateTimeCompactKR(value: string): string {
  const parts = getDateTimeParts(value);
  if (!parts) return value;
  return `${Number(parts.month)}.${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

/** `시작일시 ~ 종료일시` 한 줄에서 종료일시가 같은 날짜면 시간만 표시 */
export function formatDateTimeRangeEndKR(value: string, startValue: string): string {
  const end = getDateTimeParts(value);
  if (!end) return value;

  const start = getDateTimeParts(startValue);
  if (
    start &&
    start.year === end.year &&
    start.month === end.month &&
    start.day === end.day
  ) {
    return `${end.hour}:${end.minute}`;
  }
  return formatDateTimeCompactKR(value);
}

/** date 폼 값 (`2026-05-22`) → 한국식 (`2026. 05. 22.`) */
export function formatDateKR(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return `${y}. ${m}. ${d}.`;
}

/** 한국식 (`2026. 05. 22. 14:00`, `5.22 14:00`, `14:00`) → datetime-local 입력값 */
export function parseDateTimeKR(value: string, fallbackDateTime = ''): string {
  const full = value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2})/);
  if (full) return normalizeDateTimeLocalStep(`${full[1]}-${pad2(Number(full[2]))}-${pad2(Number(full[3]))}T${pad2(Number(full[4]))}:${full[5]}`);

  const compact = value.match(/(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2})/);
  if (compact) {
    const year = getDateTimeParts(fallbackDateTime)?.year ?? String(new Date().getFullYear());
    return normalizeDateTimeLocalStep(`${year}-${pad2(Number(compact[1]))}-${pad2(Number(compact[2]))}T${pad2(Number(compact[3]))}:${compact[4]}`);
  }

  const timeOnly = value.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  const fallback = getDateTimeParts(fallbackDateTime);
  if (!timeOnly || !fallback) return '';
  return normalizeDateTimeLocalStep(`${fallback.year}-${fallback.month}-${fallback.day}T${pad2(Number(timeOnly[1]))}:${timeOnly[2]}`);
}

/** 한국식 (`2026. 05. 22.`) → date 입력값 */
export function parseDateKR(value: string): string {
  const m = value.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})\./);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 폼 입력값을 누름틀에 넣을 형태로 변환 */
export function formatForLabel(label: string, rawValue: string): string {
  const cfg = FIELD_CONFIGS[label];
  if (!cfg) return rawValue;
  if (cfg.type === 'datetime') return formatDateTimeCompactKR(rawValue);
  if (cfg.type === 'date') return formatDateKR(rawValue);
  return rawValue;
}

/** 누름틀에 들어있는 값을 입력 위젯이 받을 수 있는 형태로 변환 */
export function parseFromHWP(label: string, hwpValue: string, fallbackDateTime = ''): string {
  const cfg = FIELD_CONFIGS[label];
  if (!cfg) return hwpValue;
  if (cfg.type === 'datetime') return parseDateTimeKR(hwpValue, fallbackDateTime);
  if (cfg.type === 'date') return parseDateKR(hwpValue);
  return hwpValue;
}

function getDateTimeParts(value: string): { year: string; month: string; day: string; hour: string; minute: string } | null {
  if (!value) return null;
  const normalized = normalizeDateTimeLocalStep(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
