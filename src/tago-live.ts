import terminalsJson from './data/tago-terminals.json';
import expressTerminalsJson from './data/tago-express-terminals.json';
import { hasGrade, mergeOfficialFares, reverseOfficialFares, sortOfficialFares, summarizeFareRows, type OfficialFare } from './bus-fares';
import { expressTerminalsForRegion, terminalsForRegion, type FareRegion, type TagoTerminal } from './fare-region';
import { isTagoLimitError, parseTagoResponse } from './tago-response';

/**
 * 국토교통부 TAGO 시외버스정보 API를 브라우저에서 바로 불러 출발지→도착지 공식 운임을 찾는다.
 *
 * 지역 → 터미널 id 는 내장 목록(src/data/tago-terminals.json, `node scripts/fetch-tago-fares.mjs --terminals` 로 갱신)으로 찾고,
 * 구간 요금만 그때그때 조회한다. 같은 날 같은 터미널 쌍은 브라우저에 저장해 다시 부르지 않고, 반대 방향을 이미 조회했으면
 * 그 값을 뒤집어 쓴다 (운임은 양방향이 같다). 시외버스에 일반 등급이 없으면(우등만 있거나 노선이 없으면)
 * TAGO 고속버스정보(src/data/tago-express-terminals.json, `--express-terminals` 로 갱신)도 찾아 함께 보여 준다.
 * 공공데이터포털 인증키(VITE_TAGO_KEY)는 번들에 들어가는 공개 키다. 없으면 기능 전체가 꺼진다.
 *
 * API 는 오늘부터 모레까지의 배차만 있고(출장일 기준 조회는 안 된다), 당일 배차는 이미 출발한 편까지 모두 준다 (2026-11 확인).
 */

const TAGO_KEY: string = import.meta.env.VITE_TAGO_KEY ?? '';
const SUBURBS = { base: 'https://apis.data.go.kr/1613000/SuburbsBusInfo', op: 'GetStrtpntAlocFndSuberbsBusInfo', storage: '' };
const EXPRESS = { base: 'https://apis.data.go.kr/1613000/ExpBusInfo', op: 'GetStrtpntAlocFndExpbusInfo', storage: 'exp:' };
type Service = typeof SUBURBS;
type Pair = readonly [TagoTerminal, TagoTerminal];
const TERMINALS = terminalsJson as TagoTerminal[];
const EXPRESS_TERMINALS = expressTerminalsJson as TagoTerminal[];
/** 시외버스: 한 번 찾을 때 조회할 터미널 수 (출발·도착 각각). 큰 도시는 터미널이 여럿이고 노선마다 서는 터미널이 달라
 *  (대구→춘천은 대구서부에만 있다) 별칭 순서대로 이만큼까지 모두 불러 등급별 최저 요금으로 합친다.
 *  응답은 빠르지만(수십 ms) 하루 호출 한도가 있어 4×4 까지만. */
const SUBURBS_MAX_TERMINALS = 4;
/** 그쪽 방향 자료가 없을 때 보는 반대 방향은 주 터미널끼리 2×2 까지만 (TAGO 는 한쪽 방향만 있는 구간이 많다). */
const SUBURBS_REVERSE_TERMINALS = 2;
/** 고속버스는 같은 이름의 터미널 id 가 여럿이라 쌍이 많다 — 최대 이만큼(모두 조회)만. */
const EXPRESS_MAX_PAIRS = 24;
/** 한 번에 이만큼씩 부른다 (초당 호출 제한). */
const BATCH = 3;
const TIMEOUT_MS = 5000;
/** 초당 호출 제한에 걸리면 이만큼 쉬고 한 번 더 부른다. */
const RATE_LIMIT_RETRY_MS = 1200;
const STORAGE_PREFIX = 'tago-fare:';

const memory = new Map<string, Promise<OfficialFare[]>>();
/** 일부 터미널 쌍 조회가 실패한 채 합친 결과 — 기억하지 않고, 일반 등급이 없으면 금액을 자동으로 넣지 않는다. */
const partialResults = new WeakSet<OfficialFare[]>();
/**
 * TAGO 에 노선 자료가 아예 없는 지역(2026-11 실제 호출로 확인: 경남 서부 착발 노선) — 터미널 쌍마다 불러도 늘 빈 결과라
 * 공용 호출 한도만 쓴다(서울↔진주 한 번에 60여 회). 조회하지 않고 보완 요금표·네이버지도 링크로 넘긴다.
 */
const NO_TAGO_REGIONS = new Set(['경남 진주', '경남 하동', '경남 고성']);

/** 일부 터미널 조회가 실패한 채 합친 실시간 결과인가 */
export function isPartialLiveResult(fares: readonly OfficialFare[]): boolean {
  return partialResults.has(fares as OfficialFare[]);
}

export function isLiveFareEnabled(): boolean {
  return TAGO_KEY !== '';
}

/** 오늘 날짜 (한국 시간) — YYYYMMDD 와 YYYY-MM-DD */
function kstToday(): { compact: string; dashed: string } {
  const dashed = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return { compact: dashed.replace(/-/g, ''), dashed };
}

/** 실시간 조회 결과를 기억하는 키에 넣을 오늘 날짜 (한국 시간, YYYYMMDD) — 창을 하루 넘게 열어 둬도 그날 배차로 다시 조회하게. */
export function liveFareDay(): string {
  return kstToday().compact;
}

function readStored(key: string): OfficialFare[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) ? (value as OfficialFare[]) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, fares: OfficialFare[]): void {
  try {
    // 지난 날짜의 저장값은 버린다 (키에 날짜가 들어 있다).
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX) && !k.endsWith(key.slice(key.lastIndexOf(':')))) localStorage.removeItem(k);
    }
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(fares));
  } catch { /* 저장 못 해도 조회 결과는 쓴다 */ }
}

const pairKey = (service: Service, dep: TagoTerminal, arr: TagoTerminal): string =>
  `${service.storage}${dep.id}:${arr.id}:${kstToday().compact}`;

/** TAGO 한 번 호출. 초당 호출 제한에 걸리면 잠깐 쉬고 한 번 더 부른다. */
async function callTago(service: Service, dep: TagoTerminal, arr: TagoTerminal, retried = false): Promise<unknown[]> {
  const serviceKey = TAGO_KEY.includes('%') ? TAGO_KEY : encodeURIComponent(TAGO_KEY);
  const qs = new URLSearchParams({
    _type: 'json', numOfRows: '200', pageNo: '1',
    depTerminalId: dep.id, arrTerminalId: arr.id, depPlandTime: kstToday().compact,
  });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${service.base}/${service.op}?serviceKey=${serviceKey}&${qs}`, { signal: controller.signal });
    try {
      return parseTagoResponse(await res.text(), res.status);
    } catch (err) {
      if (retried || !isTagoLimitError(err)) throw err;
    }
    await new Promise((resolve) => window.setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    return callTago(service, dep, arr, true);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 터미널 한 쌍의 오늘 배차 요금 (등급별 최저). 운행이 없으면 빈 배열, 네트워크·API 오류는 예외.
 * 오늘 조회한 값은 다시 부르지 않고, 반대 방향 쌍을 이미 조회해 요금이 있으면 그 값을 뒤집어 쓴다 (호출 절약).
 */
async function fetchPair(service: Service, dep: TagoTerminal, arr: TagoTerminal): Promise<OfficialFare[]> {
  const key = pairKey(service, dep, arr);
  const stored = readStored(key);
  if (stored) return stored;
  const reverse = readStored(pairKey(service, arr, dep));
  if (reverse?.length) return reverseOfficialFares(reverse, arr.시도);

  const rows = await callTago(service, dep, arr);
  const fares = summarizeFareRows(rows as { charge?: unknown; gradeNm?: unknown }[], {
    출발: dep.name, 도착: arr.name, 도착시도: arr.시도, 조회일: kstToday().dashed, 실시간: true, 고속: service === EXPRESS || undefined,
  });
  writeStored(key, fares);
  return fares;
}

const pairsOf = (deps: readonly TagoTerminal[], arrs: readonly TagoTerminal[]): Pair[] =>
  deps.flatMap((dep) => arrs.map((arr) => [dep, arr] as const));

/**
 * 고속버스 쌍을 터미널 이름 조합마다 첫 id 끼리 먼저 오게 늘어놓는다 — 출발 터미널 순서대로 자르면 한도(24쌍) 안에
 * 첫 출발 터미널의 id 만 들어가 서울경부·센트럴시티를 아예 안 부르게 된다.
 */
function interleavedPairs(deps: readonly TagoTerminal[], arrs: readonly TagoTerminal[]): Pair[] {
  const rankWithinName = (list: readonly TagoTerminal[]): Map<TagoTerminal, number> => {
    const seen = new Map<string, number>();
    return new Map(list.map((t) => {
      const rank = seen.get(t.name) ?? 0;
      seen.set(t.name, rank + 1);
      return [t, rank] as const;
    }));
  };
  const depRank = rankWithinName(deps);
  const arrRank = rankWithinName(arrs);
  return pairsOf(deps, arrs)
    .map((pair, index) => ({ pair, index, rank: (depRank.get(pair[0]) ?? 0) + (arrRank.get(pair[1]) ?? 0) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ pair }) => pair);
}

/**
 * 터미널 쌍들을 몇 쌍씩 불러 등급별 최저 요금으로 합친다 (같은 구간도 터미널마다 등급·요금이 다르다:
 * 서울경부→양양 고속 16,700, 동서울→양양 우등 20,100). 일부 쌍이 실패해도 나머지로 합치고, 첫 실패는 따로 돌려준다.
 */
async function fetchPairs(service: Service, pairs: readonly Pair[]): Promise<{ fares: OfficialFare[]; failure: unknown }> {
  const found: OfficialFare[][] = [];
  let failure: unknown = null;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const results = await Promise.allSettled(pairs.slice(i, i + BATCH).map(([dep, arr]) => fetchPair(service, dep, arr)));
    for (const result of results) {
      if (result.status === 'fulfilled') found.push(result.value);
      else failure ??= result.reason;
    }
  }
  return { fares: mergeOfficialFares(found), failure };
}

/**
 * 시외버스: 두 지역의 터미널 쌍을 모두 불러 등급별 최저 요금으로 합친다. 그쪽 방향 배차 자료가 없으면
 * 주 터미널끼리 반대 방향(같은 요금)도 본다. 요금이 하나도 없는데 일부 쌍이 실패했으면 예외 — 다음에 다시 조회하게 한다.
 */
async function findSuburbsFares(from: FareRegion, to: FareRegion): Promise<{ fares: OfficialFare[]; partial: boolean }> {
  const deps = terminalsForRegion(from, TERMINALS).slice(0, SUBURBS_MAX_TERMINALS);
  const arrs = terminalsForRegion(to, TERMINALS).slice(0, SUBURBS_MAX_TERMINALS);
  if (deps.length === 0 || arrs.length === 0) return { fares: [], partial: false };
  const forward = await fetchPairs(SUBURBS, pairsOf(deps, arrs));
  if (forward.fares.length) return { fares: forward.fares, partial: forward.failure !== null };
  const reverse = await fetchPairs(SUBURBS, pairsOf(arrs.slice(0, SUBURBS_REVERSE_TERMINALS), deps.slice(0, SUBURBS_REVERSE_TERMINALS)));
  if (reverse.fares.length) return { fares: reverseOfficialFares(reverse.fares, to.시도), partial: (forward.failure ?? reverse.failure) !== null };
  const failure = forward.failure ?? reverse.failure;
  if (failure) throw failure;
  return { fares: [], partial: false };
}

/** 고속버스: 노선마다 터미널 id 가 달라 쌍을 여러 개 불러야 한다. 모든 쌍을 불러 등급별 최저 요금으로 합친다. */
async function findExpressFares(from: FareRegion, to: FareRegion): Promise<{ fares: OfficialFare[]; partial: boolean }> {
  const deps = expressTerminalsForRegion(from, EXPRESS_TERMINALS);
  const arrs = expressTerminalsForRegion(to, EXPRESS_TERMINALS);
  const { fares, failure } = await fetchPairs(EXPRESS, interleavedPairs(deps, arrs).slice(0, EXPRESS_MAX_PAIRS));
  if (fares.length === 0 && failure) throw failure;
  return { fares, partial: failure !== null };
}

function markPartial(fares: OfficialFare[], partial: boolean): OfficialFare[] {
  if (partial) partialResults.add(fares);
  return fares;
}

const routeKey = (from: FareRegion, to: FareRegion): string => `${from.시도} ${from.시군}>${to.시도} ${to.시군}:${kstToday().compact}`;

/**
 * 출발지→도착지 공식 운임 (일반 → 고속 → 우등 → 프리미엄). 반대 방향(갈 때↔올 때)을 이미 조회했으면 그 결과를 뒤집어 쓴다.
 * 시외버스를 먼저 찾고, 일반 등급이 없으면(우등뿐이거나 노선이 없으면) 고속버스도 찾아 함께 보여 준다 — 고속 일반이 더 쌀 수 있다.
 * 시외·고속은 다른 버스라 등급이 같아도 합치지 않고 칩을 따로 둔다 (대구→춘천: 시외 우등 42,300, 고속 우등 34,500).
 * 둘 다 없으면 빈 배열, 조회 실패는 예외.
 */
export function fetchLiveFares(from: FareRegion, to: FareRegion): Promise<OfficialFare[]> {
  if (!isLiveFareEnabled()) return Promise.resolve([]);
  if (NO_TAGO_REGIONS.has(`${from.시도} ${from.시군}`) || NO_TAGO_REGIONS.has(`${to.시도} ${to.시군}`)) return Promise.resolve([]);
  const key = routeKey(from, to);
  let pending = memory.get(key);
  if (!pending) {
    const reverse = memory.get(routeKey(to, from));
    pending = (async () => {
      if (reverse) {
        const fares = await reverse.catch(() => [] as OfficialFare[]);
        if (fares.length && !partialResults.has(fares)) return reverseOfficialFares(fares, to.시도);
      }
      const suburbs = await findSuburbsFares(from, to);
      if (hasGrade(suburbs.fares, '일반')) return markPartial(suburbs.fares, suburbs.partial);
      let expressFailed = false;
      const express = await findExpressFares(from, to).catch((err: unknown) => {
        if (suburbs.fares.length === 0) throw err;
        expressFailed = true;
        return { fares: [] as OfficialFare[], partial: true };
      });
      return markPartial(sortOfficialFares([...suburbs.fares, ...express.fares]), suburbs.partial || express.partial || expressFailed);
    })();
    // 실패했거나 일부만 받은 조회는 다음에 다시 시도할 수 있게 기억하지 않는다 (받은 터미널 쌍은 저장돼 있어 다시 부르지 않는다).
    pending.then((fares) => { if (partialResults.has(fares)) memory.delete(key); }, () => memory.delete(key));
    memory.set(key, pending);
  }
  return pending;
}
