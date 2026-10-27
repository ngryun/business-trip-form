/**
 * 고성교육지원청 버스요금표 (2026. 1. 13. 기준) — 운임 금액 자동 제안.
 *
 * 출발지·도착지 칸의 도시명(고성, 속초, 춘천 …)이 표의 구간과 맞으면 금액을 채운다.
 * 표는 고성 출발·속초 출발만 있으므로 반대 방향(춘천→고성)은 같은 금액으로 본다.
 * 표에 없는 지역은 네이버지도 대중교통(시외버스) 최소요금 등을 확인해 직접 입력한다.
 */

export const BUS_FARE_TABLE_DATE = '2026. 1. 13.';

export interface BusFare {
  /** 표의 출발 터미널 (고성 = 간성) */
  출발: '고성' | '속초';
  /** 표에 적힌 행선지(경유지) 표기 그대로 — 칩에 표시 */
  행선지: string;
  /** 출발지·도착지 칸의 도시명과 맞출 이름 */
  도착: string;
  요금: number;
  /** 같은 도시의 다른 정류장(신남·하조대·횡계)처럼 두 번째 후보일 때 true */
  보조?: boolean;
  /** 표에 없어 합산한 구간이면 계산식 (예: "고성→속초 4,000 + 속초→삼척 13,800") */
  환승?: string;
}

export const BUS_FARES: readonly BusFare[] = [
  { 출발: '고성', 행선지: '속초', 도착: '속초', 요금: 4000 },
  { 출발: '고성', 행선지: '강릉', 도착: '강릉', 요금: 11900 },
  { 출발: '고성', 행선지: '춘천(속초)', 도착: '춘천', 요금: 19700 },
  { 출발: '고성', 행선지: '원주(속초)', 도착: '원주', 요금: 26800 },
  { 출발: '고성', 행선지: '양양(속초)', 도착: '양양', 요금: 6600 },
  { 출발: '고성', 행선지: '인제', 도착: '인제', 요금: 9400 },
  { 출발: '고성', 행선지: '신남', 도착: '인제', 요금: 11600, 보조: true },
  { 출발: '고성', 행선지: '홍천', 도착: '홍천', 요금: 17400 },
  { 출발: '고성', 행선지: '동서울', 도착: '서울', 요금: 23400 },
  { 출발: '고성', 행선지: '동해', 도착: '동해', 요금: 16400 },
  { 출발: '고성', 행선지: '양구', 도착: '양구', 요금: 11400 },
  { 출발: '고성', 행선지: '부산', 도착: '부산', 요금: 53800 },
  { 출발: '속초', 행선지: '강릉', 도착: '강릉', 요금: 7200 },
  { 출발: '속초', 행선지: '춘천', 도착: '춘천', 요금: 15700 },
  { 출발: '속초', 행선지: '원주', 도착: '원주', 요금: 22800 },
  { 출발: '속초', 행선지: '양양', 도착: '양양', 요금: 2600 },
  { 출발: '속초', 행선지: '하조대', 도착: '양양', 요금: 4200, 보조: true },
  { 출발: '속초', 행선지: '횡성', 도착: '횡성', 요금: 20600 },
  { 출발: '속초', 행선지: '홍천', 도착: '홍천', 요금: 15700 },
  { 출발: '속초', 행선지: '동해', 도착: '동해', 요금: 11800 },
  { 출발: '속초', 행선지: '삼척', 도착: '삼척', 요금: 13800 },
  { 출발: '속초', 행선지: '동서울', 도착: '서울', 요금: 16700 },
  { 출발: '속초', 행선지: '횡계', 도착: '평창', 요금: 10800, 보조: true },
  { 출발: '속초', 행선지: '평창', 도착: '평창', 요금: 14400 },
];

/** 출발지·도착지 칸의 값을 표의 도시명으로 맞춘다: 공백·시/군 제거, 간성→고성, 동서울→서울. */
export function normalizeFareCity(text: string): string {
  let city = (text ?? '').replace(/\s+/g, '');
  if (!city) return '';
  city = city.replace(/(특별자치도|특별시|광역시|특별자치시)$/, '');
  if (city.length >= 3) city = city.replace(/[시군]$/, '');
  if (city === '간성' || city === '간성읍') return '고성';
  if (city === '동서울' || city === '서울시') return '서울';
  return city;
}

/**
 * 고성 출발 구간이 표에 없으면 표의 규칙대로 "고성→속초 + 속초→목적지" 로 합산한다.
 * (표의 춘천(속초)·원주(속초)·양양(속초)이 모두 이 합산값이다.)
 */
function derivedViaSokcho(city: string): BusFare[] {
  const gosungToSokcho = BUS_FARES.find((f) => f.출발 === '고성' && f.도착 === '속초');
  if (!gosungToSokcho || city === '속초') return [];
  return BUS_FARES.filter((f) => f.출발 === '속초' && f.도착 === city).map((leg) => ({
    출발: '고성',
    행선지: `${leg.행선지}(속초)`,
    도착: leg.도착,
    요금: gosungToSokcho.요금 + leg.요금,
    보조: leg.보조,
    환승: `고성→속초 ${formatWon(gosungToSokcho.요금)} + 속초→${leg.행선지} ${formatWon(leg.요금)}`,
  }));
}

/**
 * 출발지→도착지 구간에 맞는 요금을 찾는다. 표는 고성·속초 출발만 있으므로 반대 방향도 같은 요금으로 본다.
 * 첫 항목이 기본 후보, 뒤는 같은 도시의 다른 정류장(보조) 후보. 고성 출발이 표에 없으면 속초 경유 합산.
 */
export function findBusFares(from: string, to: string): BusFare[] {
  const a = normalizeFareCity(from);
  const b = normalizeFareCity(to);
  if (!a || !b || a === b) return [];
  let matches = BUS_FARES.filter((fare) =>
    (fare.출발 === a && fare.도착 === b) || (fare.출발 === b && fare.도착 === a));
  if (matches.length === 0) {
    if (a === '고성') matches = derivedViaSokcho(b);
    else if (b === '고성') matches = derivedViaSokcho(a);
  }
  return [...matches].sort((x, y) => Number(x.보조 ?? false) - Number(y.보조 ?? false));
}

export function formatWon(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

/** 칩 문구: "고성→춘천(속초) 19,700" */
export function busFareLabel(fare: BusFare): string {
  return `${fare.출발}→${fare.행선지} ${formatWon(fare.요금)}`;
}
