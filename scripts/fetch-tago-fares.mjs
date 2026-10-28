// 국토교통부 TAGO 시외버스정보 API로 간성·속초 출발 전 구간의 요금을 받아 src/data/tago-fares.json 에 저장한다.
//
//   사용법:  node scripts/fetch-tago-fares.mjs
//            node scripts/fetch-tago-fares.mjs --terminals   (전국 터미널 목록만 src/data/tago-terminals.json 에 저장)
//            node scripts/fetch-tago-fares.mjs --express-terminals   (고속버스 터미널 목록만 src/data/tago-express-terminals.json 에 저장)
//   인증키:  .env.local 의 TAGO_API_KEY (또는 환경변수 TAGO_API_KEY). 저장소에는 올리지 않는다.
//            고속버스 목록은 같은 키에 "국토교통부_(TAGO)_고속버스정보" 활용신청이 되어 있어야 한다.
//
// API는 당일 배차 기준으로 요금을 돌려주므로, 그날 운행이 없는 구간은 빠질 수 있다.
// 결과 파일은 앱에 내장되어 "공식 운임" 참고값으로 쓰이며, 교육지원청 기준표(bus-fares.ts)가 우선이다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provinceShort, resolveFareRegion } from '../src/fare-region.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(root, 'src/data/tago-fares.json');
const TERMINALS_OUTPUT = resolve(root, 'src/data/tago-terminals.json');
const EXPRESS_TERMINALS_OUTPUT = resolve(root, 'src/data/tago-express-terminals.json');
const BASE = 'https://apis.data.go.kr/1613000/SuburbsBusInfo';
const EXPRESS_BASE = 'https://apis.data.go.kr/1613000/ExpBusInfo';
const DEPARTURES = ['간성', '속초'];
const CONCURRENCY = 2;
const PAUSE_MS = 150; // 초당 호출 제한(LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND) 회피
let failures = 0;

function loadKey() {
  if (process.env.TAGO_API_KEY) return process.env.TAGO_API_KEY.trim();
  try {
    const env = readFileSync(resolve(root, '.env.local'), 'utf8');
    const m = env.match(/^TAGO_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* 파일 없음 */ }
  throw new Error('.env.local 에 TAGO_API_KEY=... 를 넣어 주세요.');
}
const rawKey = loadKey();
const key = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey);

async function call(op, params = {}, base = BASE, attempt = 0) {
  const qs = Object.entries({ _type: 'json', numOfRows: 200, pageNo: 1, ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    const res = await fetch(`${base}/${op}?serviceKey=${key}&${qs}`);
    const text = await res.text();
    const json = JSON.parse(text);
    const code = json?.response?.header?.resultCode;
    if (code !== '00') throw new Error(`${op}: ${json?.response?.header?.resultMsg ?? text.slice(0, 120)}`);
    const it = json.response.body?.items?.item;
    return Array.isArray(it) ? it : it ? [it] : [];
  } catch (err) {
    const limited = /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(String(err.message));
    if (attempt < (limited ? 6 : 2)) { await new Promise((r) => setTimeout(r, (limited ? 1500 : 800) * (attempt + 1))); return call(op, params, base, attempt + 1); }
    throw err;
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
  }));
  return out;
}

const kstDate = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const today = kstDate.replace(/-/g, '');

const cities = await call('GetCtyCodeList');
const terminalLists = await mapLimit(cities, CONCURRENCY, (c) => call('GetSuberbsBusTrminlList', { cityCode: c.cityCode }));
const terminals = terminalLists.flat().map((t) => ({ id: t.terminalId, name: t.terminalNm, city: t.cityName }));
console.log(`시도 ${cities.length}곳, 터미널 ${terminals.length}곳`);

if (process.argv.includes('--terminals')) {
  // 브라우저 실시간 조회가 지역 → 터미널 id 를 찾는 데 쓰는 목록. 시도는 조회한 시도 코드 기준(줄인 이름).
  const list = cities.flatMap((c, i) => terminalLists[i].map((t) => ({ id: t.terminalId, name: t.terminalNm, 시도: provinceShort(c.cityName) })));
  const unknown = cities.filter((c) => !provinceShort(c.cityName));
  if (unknown.length) throw new Error(`시도 이름을 줄이지 못했습니다: ${unknown.map((c) => c.cityName).join(', ')}`);
  list.sort((a, b) => a.시도.localeCompare(b.시도, 'ko') || a.name.localeCompare(b.name, 'ko'));
  mkdirSync(dirname(TERMINALS_OUTPUT), { recursive: true });
  writeFileSync(TERMINALS_OUTPUT, JSON.stringify(list, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  console.log(`저장: ${TERMINALS_OUTPUT} (${list.length}곳)`);
  process.exit(0);
}

if (process.argv.includes('--express-terminals')) {
  // 고속버스 터미널 목록에는 시도가 없다 (도시코드로 걸러지지도 않는다). 시도는 아래 순서로 정한다:
  //   직접 정한 이름 → 시외버스 목록의 같은 이름(시도가 하나일 때) → 이름 앞부분·괄호 속 시군 → 터미널 id 대역.
  // id 대역은 이름으로 못 정한 정류장(경포해변 등)에만 쓰이고, 이런 곳은 지역 이름으로 찾히지 않으므로 대략이면 된다.
  const OVERRIDES = { 동대구: '대구', 서대구: '대구', 대구용계: '대구', 대구혁신: '대구', 대구공항: '대구', 유성복합: '대전', 신탄진역: '대전', 상봉: '서울', 동래: '부산', 조치원: '세종', 광주비아: '광주', 광주운암: '광주', '광주(유·스퀘어)': '광주', 김포공항: '서울', 신철원: '강원', 청평: '경기' };
  const ID_BANDS = ['서울', '경기', '강원', '충남', '충북', '전남', '전북', '경남', '경북'];
  const JUNK = /통합단말|모바일|수수료|구간$|공항왕복|라쿠카라차/;
  const suburbsProvinces = new Map();
  cities.forEach((c, i) => terminalLists[i].forEach((t) => {
    suburbsProvinces.set(t.terminalNm, new Set([...(suburbsProvinces.get(t.terminalNm) ?? []), provinceShort(c.cityName)]));
  }));
  const byName = (name) => {
    const candidates = [name.match(/[(（]([^)）]+)[)）]/)?.[1], ...Array.from({ length: name.length - 1 }, (_, i) => name.slice(0, name.length - i))];
    for (const part of candidates) {
      const region = part ? resolveFareRegion(part) : null;
      if (region?.시도 && !region.추정) return region.시도;
    }
    return '';
  };
  const items = await call('GetExpBusTrminlList', { numOfRows: 1000 }, EXPRESS_BASE);
  const guessed = [];
  const list = items.filter((t) => !JUNK.test(t.terminalNm)).map((t) => {
    const name = t.terminalNm;
    const suburbs = suburbsProvinces.get(name);
    let 시도 = OVERRIDES[name] ?? (suburbs?.size === 1 ? [...suburbs][0] : '') ?? '';
    if (!시도) 시도 = byName(name);
    if (!시도) { 시도 = ID_BANDS[Number(t.terminalId.slice(4, 5))] ?? ''; guessed.push(`${name}(${시도})`); }
    return { id: t.terminalId, name, 시도 };
  });
  list.sort((a, b) => a.시도.localeCompare(b.시도, 'ko') || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
  mkdirSync(dirname(EXPRESS_TERMINALS_OUTPUT), { recursive: true });
  writeFileSync(EXPRESS_TERMINALS_OUTPUT, JSON.stringify(list, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  console.log(`저장: ${EXPRESS_TERMINALS_OUTPUT} (${list.length}곳, 전체 ${items.length}곳 중 단말·수수료 항목 제외)`);
  console.log(`id 대역으로 시도를 정한 곳 ${guessed.length}곳: ${guessed.join(', ')}`);
  process.exit(0);
}

const departures = DEPARTURES.map((name) => {
  const t = terminals.find((x) => x.name === name);
  if (!t) throw new Error(`출발 터미널을 찾지 못했습니다: ${name}`);
  return t;
});

const fares = [];
let done = 0;
for (const dep of departures) {
  const targets = terminals.filter((t) => t.id !== dep.id);
  await mapLimit(targets, CONCURRENCY, async (arr) => {
    let rows = [];
    try { rows = await call('GetStrtpntAlocFndSuberbsBusInfo', { depTerminalId: dep.id, arrTerminalId: arr.id, depPlandTime: today }); }
    catch (err) { failures += 1; console.warn(`조회 실패 ${dep.name}→${arr.name}: ${String(err.message).replace(/s+/g, ' ').slice(0, 120)}`); }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const byGrade = new Map();
    for (const row of rows) {
      const charge = Number(row.charge);
      if (!Number.isFinite(charge) || charge <= 0) continue;
      const grade = row.gradeNm ?? '일반';
      byGrade.set(grade, Math.min(byGrade.get(grade) ?? Infinity, charge));
    }
    for (const [grade, charge] of byGrade) fares.push({ 출발: dep.name, 도착: arr.name, 도착시도: arr.city, 등급: grade, 요금: charge });
    done += 1;
    if (done % 100 === 0) console.log(`${done}/${departures.length * (terminals.length - 1)} 조회`);
  });
}
fares.sort((a, b) => a.출발.localeCompare(b.출발, 'ko') || a.도착.localeCompare(b.도착, 'ko') || a.등급.localeCompare(b.등급, 'ko'));

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify({
  _설명: '국토교통부 TAGO 시외버스정보 API에서 받은 간성·속초 출발 요금(당일 배차 기준, 등급별 최저). 교육지원청 기준표가 우선이며 이 값은 공식 운임 참고용. scripts/fetch-tago-fares.mjs 로 갱신.',
  조회일: kstDate,
  구간: fares,
}, null, 2) + '\n');
console.log(`저장: ${OUTPUT} (${fares.length}건, 조회 실패 ${failures}건)`);
for (const dep of departures) {
  const n = fares.filter((f) => f.출발 === dep.name);
  console.log(`${dep.name} 출발 ${n.length}건: ${[...new Set(n.map((f) => f.도착))].join(', ')}`);
}
