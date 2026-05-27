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

/** datetime-local 폼 값 (`2026-05-22T14:00`) → 한국식 (`2026. 05. 22. 14:00`) */
export function formatDateTimeKR(value: string): string {
  if (!value) return '';
  const [datePart, timePart = '00:00'] = value.split('T');
  const [y, m, d] = datePart.split('-');
  const [hh, mm] = timePart.split(':');
  return `${y}. ${m}. ${d}. ${hh}:${mm}`;
}

/** date 폼 값 (`2026-05-22`) → 한국식 (`2026. 05. 22.`) */
export function formatDateKR(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return `${y}. ${m}. ${d}.`;
}

/** 한국식 (`2026. 05. 22. 14:00`) → datetime-local 입력값 */
export function parseDateTimeKR(value: string): string {
  const m = value.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})\.\s*(\d{2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
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
  if (cfg.type === 'datetime') return formatDateTimeKR(rawValue);
  if (cfg.type === 'date') return formatDateKR(rawValue);
  return rawValue;
}

/** 누름틀에 들어있는 값을 입력 위젯이 받을 수 있는 형태로 변환 */
export function parseFromHWP(label: string, hwpValue: string): string {
  const cfg = FIELD_CONFIGS[label];
  if (!cfg) return hwpValue;
  if (cfg.type === 'datetime') return parseDateTimeKR(hwpValue);
  if (cfg.type === 'date') return parseDateKR(hwpValue);
  return hwpValue;
}
