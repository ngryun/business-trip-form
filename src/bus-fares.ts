/**
 * 고성교육지원청 버스요금표 (2026. 1. 13. 기준) — 운임 금액 자동 제안.
 *
 * 출발지·도착지 칸의 도시명(고성, 속초, 춘천 …)이 표의 구간과 맞으면 금액을 채운다.
 * 표는 고성 출발·속초 출발만 있으므로 반대 방향(춘천→고성)은 같은 금액으로 본다.
 * 표에 없는 지역은 네이버지도 대중교통(시외버스) 최소요금 등을 확인해 직접 입력한다.
 * 표의 고성은 강원 고성이므로 경남 고성처럼 강원 밖의 같은 이름에는 쓰지 않는다.
 */

import {
  normalizeFareCity,
  resolveFareRegion,
  resolveFareRoute,
  sameNameProvinces,
  sameRegion,
  terminalMatches,
  type FareRegion,
} from './fare-region.ts';

export { normalizeFareCity };

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

type FareEnd = string | FareRegion | null;

/** 칸 값(글자)이면 시도를 정하고, 이미 정한 지역이면 그대로 쓴다. */
function routeOf(from: FareEnd, to: FareEnd): [FareRegion | null, FareRegion | null] {
  if (typeof from === 'string' && typeof to === 'string') {
    const route = resolveFareRoute(from, to);
    return [route.from, route.to];
  }
  return [typeof from === 'string' ? resolveFareRegion(from) : from, typeof to === 'string' ? resolveFareRegion(to) : to];
}

/** 동명 지역은 강원 쪽일 때만 요금표 지역이다 (표의 고성 = 강원 고성). */
const isTableRegion = (region: FareRegion): boolean =>
  sameNameProvinces(region.시군).length === 0 || region.시도 === '강원';

/**
 * 출발지→도착지 구간에 맞는 요금을 찾는다. 표는 고성·속초 출발만 있으므로 반대 방향도 같은 요금으로 본다.
 * 첫 항목이 기본 후보, 뒤는 같은 도시의 다른 정류장(보조) 후보. 고성 출발이 표에 없으면 속초 경유 합산.
 */
export function findBusFares(from: FareEnd, to: FareEnd): BusFare[] {
  const [ra, rb] = routeOf(from, to);
  if (!ra || !rb || sameRegion(ra, rb) || !isTableRegion(ra) || !isTableRegion(rb)) return [];
  const a = ra.시군;
  const b = rb.시군;
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

/* ── 공식 운임 (국토교통부 TAGO 시외버스정보 API, src/data/tago-fares.json) ──
 * 교육지원청 기준표가 우선이고 이 값은 비교·참고용이다. 기준표와 다르면 둘 다 보여 주고,
 * 기준표에 없는 구간이면 공식 운임을 제안한다. 갱신: node scripts/fetch-tago-fares.mjs */

export interface OfficialFare {
  /** 출발 터미널명 (간성·속초) */
  출발: string;
  /** 도착 터미널명 (API 표기: 춘천, 동서울, 강릉 …) */
  도착: string;
  도착시도?: string;
  등급: string;
  요금: number;
  /** 조회한 날 (YYYY-MM-DD). 없으면 자료 전체의 조회일 */
  조회일?: string;
  /** 브라우저에서 방금 TAGO 로 조회한 값이면 true */
  실시간?: boolean;
  /** 시외버스에 없어 TAGO 고속버스정보에서 찾은 값이면 true (등급 "고속" 은 일반 고속버스) */
  고속?: boolean;
}

export interface OfficialFareData {
  조회일: string;
  구간: OfficialFare[];
}

const GRADE_ORDER = ['일반', '고속', '우등', '프리미엄'];
const gradeRank = (grade: string): number => {
  const i = GRADE_ORDER.findIndex((g) => grade.startsWith(g));
  return i < 0 ? GRADE_ORDER.length : i;
};

/** 심야·주말 등급을 빼고 일반 → 우등 → 프리미엄 순, 같은 등급이면 싼 것부터. */
export function sortOfficialFares(fares: readonly OfficialFare[]): OfficialFare[] {
  return fares.filter((f) => !/심야|주말/.test(f.등급)).sort((x, y) => gradeRank(x.등급) - gradeRank(y.등급) || x.요금 - y.요금);
}

/** 여러 터미널 쌍에서 받은 요금을 등급별 최저 요금 하나씩으로 합친다 (그 요금의 출발·도착 터미널을 그대로 둔다). */
export function mergeOfficialFares(lists: readonly (readonly OfficialFare[])[]): OfficialFare[] {
  const byGrade = new Map<string, OfficialFare>();
  for (const fare of lists.flat()) {
    const best = byGrade.get(fare.등급);
    if (!best || fare.요금 < best.요금) byGrade.set(fare.등급, fare);
  }
  return sortOfficialFares([...byGrade.values()]);
}

/** TAGO 배차 목록(charge·gradeNm)을 등급별 최저 요금으로 묶는다. */
export function summarizeFareRows(
  rows: readonly { charge?: unknown; gradeNm?: unknown }[],
  route: Pick<OfficialFare, '출발' | '도착' | '도착시도' | '조회일' | '실시간' | '고속'>,
): OfficialFare[] {
  const byGrade = new Map<string, number>();
  for (const row of rows) {
    const charge = Number(row.charge);
    if (!Number.isFinite(charge) || charge <= 0) continue;
    const grade = String(row.gradeNm ?? '일반');
    byGrade.set(grade, Math.min(byGrade.get(grade) ?? Infinity, charge));
  }
  return sortOfficialFares([...byGrade].map(([등급, 요금]) => ({ ...route, 등급, 요금 })));
}

/**
 * 출발지→도착지의 공식 운임 후보(내장 자료). 자료는 간성·속초 출발만 있으므로 반대 방향은 같은 요금으로 본다.
 * 일반 → 우등 → 프리미엄 순, 같은 등급이면 싼 것부터. 심야·주말 등급은 제외한다.
 */
export function findOfficialFares(from: FareEnd, to: FareEnd, source: OfficialFareData): OfficialFare[] {
  const [a, b] = routeOf(from, to);
  if (!a || !b || sameRegion(a, b)) return [];
  const match = (dep: FareRegion, arr: FareRegion): OfficialFare[] =>
    source.구간.filter((f) => terminalMatches(dep, f.출발) && terminalMatches(arr, f.도착, f.도착시도));
  const forward = match(a, b);
  return sortOfficialFares(forward.length ? forward : match(b, a));
}
