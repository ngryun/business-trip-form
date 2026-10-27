// 국토교통부 TAGO 시외버스정보 API로 간성·속초 출발 전 구간의 요금을 받아 src/data/tago-fares.json 에 저장한다.
//
//   사용법:  node scripts/fetch-tago-fares.mjs
//   인증키:  .env.local 의 TAGO_API_KEY (또는 환경변수 TAGO_API_KEY). 저장소에는 올리지 않는다.
//
// API는 당일 배차 기준으로 요금을 돌려주므로, 그날 운행이 없는 구간은 빠질 수 있다.
// 결과 파일은 앱에 내장되어 "공식 운임" 참고값으로 쓰이며, 교육지원청 기준표(bus-fares.ts)가 우선이다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(root, 'src/data/tago-fares.json');
const BASE = 'https://apis.data.go.kr/1613000/SuburbsBusInfo';
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

async function call(op, params = {}, attempt = 0) {
  const qs = Object.entries({ _type: 'json', numOfRows: 200, pageNo: 1, ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    const res = await fetch(`${BASE}/${op}?serviceKey=${key}&${qs}`);
    const text = await res.text();
    const json = JSON.parse(text);
    const code = json?.response?.header?.resultCode;
    if (code !== '00') throw new Error(`${op}: ${json?.response?.header?.resultMsg ?? text.slice(0, 120)}`);
    const it = json.response.body?.items?.item;
    return Array.isArray(it) ? it : it ? [it] : [];
  } catch (err) {
    const limited = /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(String(err.message));
    if (attempt < (limited ? 6 : 2)) { await new Promise((r) => setTimeout(r, (limited ? 1500 : 800) * (attempt + 1))); return call(op, params, attempt + 1); }
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
