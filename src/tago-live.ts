import terminalsJson from './data/tago-terminals.json';
import expressTerminalsJson from './data/tago-express-terminals.json';
import { summarizeFareRows, type OfficialFare } from './bus-fares';
import { expressTerminalsForRegion, terminalsForRegion, type FareRegion, type TagoTerminal } from './fare-region';

/**
 * 국토교통부 TAGO 시외버스정보 API를 브라우저에서 바로 불러 출발지→도착지 공식 운임을 찾는다.
 *
 * 지역 → 터미널 id 는 내장 목록(src/data/tago-terminals.json, `node scripts/fetch-tago-fares.mjs --terminals` 로 갱신)으로 찾고,
 * 구간 요금만 그때그때 조회한다. 같은 날 같은 구간은 브라우저에 저장해 다시 부르지 않는다.
 * 시외버스에 직행이 없으면 TAGO 고속버스정보(src/data/tago-express-terminals.json, `--express-terminals` 로 갱신)에서 찾는다.
 * 공공데이터포털 인증키(VITE_TAGO_KEY)는 번들에 들어가는 공개 키다. 없으면 기능 전체가 꺼진다.
 */

const TAGO_KEY: string = import.meta.env.VITE_TAGO_KEY ?? '';
const SUBURBS = { base: 'https://apis.data.go.kr/1613000/SuburbsBusInfo', op: 'GetStrtpntAlocFndSuberbsBusInfo', storage: '' };
const EXPRESS = { base: 'https://apis.data.go.kr/1613000/ExpBusInfo', op: 'GetStrtpntAlocFndExpbusInfo', storage: 'exp:' };
type Service = typeof SUBURBS;
const TERMINALS = terminalsJson as TagoTerminal[];
const EXPRESS_TERMINALS = expressTerminalsJson as TagoTerminal[];
/** 한 번 찾을 때 조회할 터미널 수 (출발·도착 각각) — 큰 도시는 터미널이 여럿이라 앞쪽(주 터미널)만 본다.
 *  직행이 없는 구간은 모든 쌍을 다 부르게 되므로, 하루 호출 한도를 생각해 작게 둔다 (최대 2×2 + 반대 방향 1). */
const TERMINALS_PER_END = 2;
/** 고속버스는 같은 이름의 터미널 id 가 여럿이라 쌍이 많다 — 최대 이만큼만 조회하고, 한 번에 이만큼씩 부른다 (초당 호출 제한). */
const EXPRESS_MAX_PAIRS = 24;
const EXPRESS_BATCH = 3;
const TIMEOUT_MS = 5000;
const STORAGE_PREFIX = 'tago-fare:';

const memory = new Map<string, Promise<OfficialFare[]>>();

export function isLiveFareEnabled(): boolean {
  return TAGO_KEY !== '';
}

/** 오늘 날짜 (한국 시간) — YYYYMMDD 와 YYYY-MM-DD */
function kstToday(): { compact: string; dashed: string } {
  const dashed = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return { compact: dashed.replace(/-/g, ''), dashed };
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

/** 터미널 한 쌍의 오늘 배차 요금 (등급별 최저). 운행이 없으면 빈 배열, 네트워크·API 오류는 예외. */
async function fetchPair(service: Service, dep: TagoTerminal, arr: TagoTerminal): Promise<OfficialFare[]> {
  const today = kstToday();
  const key = `${service.storage}${dep.id}:${arr.id}:${today.compact}`;
  const stored = readStored(key);
  if (stored) return stored;

  const serviceKey = TAGO_KEY.includes('%') ? TAGO_KEY : encodeURIComponent(TAGO_KEY);
  const qs = new URLSearchParams({
    _type: 'json', numOfRows: '200', pageNo: '1',
    depTerminalId: dep.id, arrTerminalId: arr.id, depPlandTime: today.compact,
  });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${service.base}/${service.op}?serviceKey=${serviceKey}&${qs}`, { signal: controller.signal });
    const json = await res.json();
    const header = json?.response?.header;
    if (header?.resultCode !== '00') throw new Error(`TAGO: ${header?.resultMsg ?? res.status}`);
    const item = json.response.body?.items?.item;
    const rows = Array.isArray(item) ? item : item ? [item] : [];
    const fares = summarizeFareRows(rows, {
      출발: dep.name, 도착: arr.name, 도착시도: arr.시도, 조회일: today.dashed, 실시간: true, 고속: service === EXPRESS || undefined,
    });
    writeStored(key, fares);
    return fares;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 시외버스: 주 터미널부터 차례로 조회해 요금이 나온 첫 쌍, 그쪽 방향 배차가 없으면 주 터미널끼리 반대 방향(같은 요금)도 본다. */
async function findSuburbsFares(from: FareRegion, to: FareRegion): Promise<OfficialFare[]> {
  const deps = terminalsForRegion(from, TERMINALS).slice(0, TERMINALS_PER_END);
  const arrs = terminalsForRegion(to, TERMINALS).slice(0, TERMINALS_PER_END);
  if (deps.length === 0 || arrs.length === 0) return [];
  const pairs = [...deps.flatMap((dep) => arrs.map((arr) => [dep, arr] as const)), [arrs[0], deps[0]] as const];
  for (const [dep, arr] of pairs) {
    const fares = await fetchPair(SUBURBS, dep, arr);
    if (fares.length) return fares;
  }
  return [];
}

/**
 * 고속버스: 노선마다 터미널 id 가 달라 쌍을 여러 개 불러야 한다. 몇 쌍씩 함께 불러 앞 순서에서 요금이 나온 첫 쌍을 쓴다.
 * 일부 쌍만 실패하고 요금이 없으면 예외 — 다음에 다시 조회하게 한다.
 */
async function findExpressFares(from: FareRegion, to: FareRegion): Promise<OfficialFare[]> {
  const deps = expressTerminalsForRegion(from, EXPRESS_TERMINALS);
  const arrs = expressTerminalsForRegion(to, EXPRESS_TERMINALS);
  const pairs = deps.flatMap((dep) => arrs.map((arr) => [dep, arr] as const)).slice(0, EXPRESS_MAX_PAIRS);
  let failure: unknown = null;
  for (let i = 0; i < pairs.length; i += EXPRESS_BATCH) {
    const results = await Promise.allSettled(pairs.slice(i, i + EXPRESS_BATCH).map(([dep, arr]) => fetchPair(EXPRESS, dep, arr)));
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length) return result.value;
      if (result.status === 'rejected') failure ??= result.reason;
    }
  }
  if (failure) throw failure;
  return [];
}

/**
 * 출발지→도착지 공식 운임 (일반 → 우등 → 프리미엄). 시외버스를 먼저 찾고, 직행이 없으면 고속버스에서 찾는다.
 * 둘 다 없으면 빈 배열, 조회 실패는 예외.
 */
export function fetchLiveFares(from: FareRegion, to: FareRegion): Promise<OfficialFare[]> {
  if (!isLiveFareEnabled()) return Promise.resolve([]);
  const key = `${from.시도} ${from.시군}>${to.시도} ${to.시군}:${kstToday().compact}`;
  let pending = memory.get(key);
  if (!pending) {
    pending = (async () => {
      const suburbs = await findSuburbsFares(from, to);
      return suburbs.length ? suburbs : findExpressFares(from, to);
    })();
    // 실패한 조회는 다음에 다시 시도할 수 있게 기억하지 않는다.
    pending.catch(() => memory.delete(key));
    memory.set(key, pending);
  }
  return pending;
}
