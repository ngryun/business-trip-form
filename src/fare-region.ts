/**
 * 운임 출발지·도착지의 "시도 + 시군".
 *
 * 양식 칸에는 "고성", "광주" 처럼 짧게 쓰지만, 같은 이름의 지역(강원 고성·경남 고성, 광주광역시·경기 광주)이
 * 있어 요금을 찾을 때는 시도를 함께 다룬다. 시도는 지도 검색 주소, 칸에 직접 쓴 시도("경남 고성", "고성(경남)"),
 * 반대쪽 끝점의 시도 순으로 정한다.
 */

export interface FareRegion {
  /** 줄인 시도 이름 (서울·경기·강원·경남 …). 모르면 빈 문자열 */
  시도: string;
  /** 시군 이름에서 시/군을 뗀 것 (고성·춘천·수원). 특별시·광역시는 시도와 같다 */
  시군: string;
}

export interface ResolvedRegion extends FareRegion {
  /** 같은 이름의 지역이 여럿이라 반대쪽 끝점 등으로 골라 정했으면 true — 바꾸기 칩을 보여 준다 */
  추정?: boolean;
}

/** 줄인 시도 이름 → 정식·옛 이름. 카카오 주소는 둘 다 쓰고, TAGO 는 "강원도"·"세종특별시" 처럼 옛 이름을 쓴다. */
const PROVINCES: Record<string, string[]> = {
  서울: ['서울특별시', '서울시'],
  부산: ['부산광역시', '부산시'],
  대구: ['대구광역시', '대구시'],
  인천: ['인천광역시', '인천시'],
  광주: ['광주광역시'],
  대전: ['대전광역시', '대전시'],
  울산: ['울산광역시', '울산시'],
  세종: ['세종특별자치시', '세종특별시'],
  경기: ['경기도'],
  강원: ['강원특별자치도', '강원도'],
  충북: ['충청북도'],
  충남: ['충청남도'],
  전북: ['전북특별자치도', '전라북도'],
  전남: ['전라남도'],
  경북: ['경상북도'],
  경남: ['경상남도'],
  제주: ['제주특별자치도', '제주도'],
};

const METRO_CITIES = new Set(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종']);

/** 도의 시군 (시/군을 뗀 이름). 특별시·광역시는 시도 이름이 곧 도시 이름이다. */
const SIGUN: Record<string, string[]> = {
  경기: ['수원', '성남', '의정부', '안양', '부천', '광명', '평택', '동두천', '안산', '고양', '과천', '구리', '남양주', '오산', '시흥', '군포', '의왕', '하남', '용인', '파주', '이천', '안성', '김포', '화성', '광주', '양주', '포천', '여주', '연천', '가평', '양평'],
  강원: ['춘천', '원주', '강릉', '동해', '태백', '속초', '삼척', '홍천', '횡성', '영월', '평창', '정선', '철원', '화천', '양구', '인제', '고성', '양양'],
  충북: ['청주', '충주', '제천', '보은', '옥천', '영동', '증평', '진천', '괴산', '음성', '단양'],
  충남: ['천안', '공주', '보령', '아산', '서산', '논산', '계룡', '당진', '금산', '부여', '서천', '청양', '홍성', '예산', '태안'],
  전북: ['전주', '군산', '익산', '정읍', '남원', '김제', '완주', '진안', '무주', '장수', '임실', '순창', '고창', '부안'],
  전남: ['목포', '여수', '순천', '나주', '광양', '담양', '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진', '해남', '영암', '무안', '함평', '영광', '장성', '완도', '진도', '신안'],
  경북: ['포항', '경주', '김천', '안동', '구미', '영주', '영천', '상주', '문경', '경산', '의성', '청송', '영양', '영덕', '청도', '고령', '성주', '칠곡', '예천', '울진', '울릉'],
  경남: ['창원', '진주', '통영', '사천', '김해', '밀양', '거제', '양산', '의령', '함안', '창녕', '고성', '남해', '하동', '산청', '함양', '거창', '합천'],
  제주: ['제주', '서귀포'],
};

/** 시군 이름 → 그 이름이 있는 시도들. 둘 이상이면 동명 지역 (고성: 강원·경남, 광주: 광주·경기). */
const SIGUN_PROVINCES = new Map<string, string[]>();
for (const metro of METRO_CITIES) SIGUN_PROVINCES.set(metro, [metro]);
for (const [province, names] of Object.entries(SIGUN)) {
  for (const name of names) SIGUN_PROVINCES.set(name, [...(SIGUN_PROVINCES.get(name) ?? []), province]);
}

/** "강원특별자치도"·"강원도"·"강원" → "강원". 시도가 아니면 빈 문자열. */
export function provinceShort(text: string): string {
  const name = (text ?? '').replace(/\s+/g, '');
  if (!name) return '';
  if (PROVINCES[name]) return name;
  for (const [short, names] of Object.entries(PROVINCES)) if (names.includes(name)) return short;
  return '';
}

/** 출발지·도착지 칸의 값을 도시명으로 맞춘다: 공백·시/군 제거, 간성→고성, 동서울→서울. */
export function normalizeFareCity(text: string): string {
  let city = (text ?? '').replace(/\s+/g, '');
  if (!city) return '';
  city = city.replace(/(특별자치도|특별시|광역시|특별자치시)$/, '');
  if (city.length >= 3) city = city.replace(/[시군]$/, '');
  if (city === '간성' || city === '간성읍') return '고성';
  if (city === '동서울' || city === '서울시') return '서울';
  return city;
}

/** 같은 이름의 시군이 여러 시도에 있으면 그 시도들 (없으면 빈 배열). */
export function sameNameProvinces(sigun: string): string[] {
  const provinces = SIGUN_PROVINCES.get(sigun) ?? [];
  return provinces.length > 1 ? provinces : [];
}

function withProvince(province: string, rest: string): FareRegion {
  if (METRO_CITIES.has(province)) return { 시도: province, 시군: province };
  return { 시도: province, 시군: normalizeFareCity(rest) };
}

/**
 * 칸에 쓴 글자만으로 시도·시군을 읽는다. 시도를 함께 쓴 경우("경남 고성", "고성(경남)", "경기도 광주시", "경기광주")와
 * 간성(=강원 고성)은 시도까지, 나머지는 시도를 비워 둔다.
 */
export function parseFareRegion(text: string): FareRegion {
  const raw = (text ?? '').trim();
  if (!raw) return { 시도: '', 시군: '' };
  const paren = raw.match(/^(.+?)\s*[(（]\s*([^)）]+?)\s*[)）]$/);
  if (paren) {
    const province = provinceShort(paren[2]);
    if (province) return withProvince(province, paren[1]);
  }
  const words = raw.split(/\s+/);
  if (words.length >= 2) {
    const province = provinceShort(words[0]);
    if (province) return withProvince(province, words.slice(1).join(''));
  } else {
    // 띄어 쓰지 않은 "경기광주"·"경상남도고성군" — 뒷부분이 그 시도의 시군일 때만 시도로 본다.
    for (const [short, names] of Object.entries(PROVINCES)) {
      for (const prefix of [...names, short]) {
        if (!raw.startsWith(prefix)) continue;
        const city = normalizeFareCity(raw.slice(prefix.length));
        if (city && SIGUN[short]?.includes(city)) return { 시도: short, 시군: city };
      }
    }
  }
  if (/^간성(읍)?$/.test(raw)) return { 시도: '강원', 시군: '고성' };
  return { 시도: '', 시군: normalizeFareCity(raw) };
}

/**
 * 칸 값의 시도를 정한다. 시도를 썼으면 그대로, 시군 이름이 하나뿐이면 그 시도,
 * 동명 지역이면 반대쪽 끝점과 같은 시도(없으면 첫 후보)로 정하고 추정 표시를 붙인다.
 * 목록에 없는 이름(여러 도시 "삼척·동해" 등)은 시도를 비워 둔다.
 */
export function resolveFareRegion(text: string, other: FareRegion | null = null): ResolvedRegion | null {
  const parsed = parseFareRegion(text);
  if (!parsed.시군) return null;
  if (parsed.시도) return parsed;
  const provinces = SIGUN_PROVINCES.get(parsed.시군) ?? [];
  if (provinces.length === 1) return { 시도: provinces[0], 시군: parsed.시군 };
  if (provinces.length > 1) {
    const 시도 = other && provinces.includes(other.시도) ? other.시도 : provinces[0];
    return { 시도, 시군: parsed.시군, 추정: true };
  }
  return parsed;
}

/**
 * 출발지·도착지를 함께 정한다. hints 는 지도 검색이나 바꾸기 칩으로 이미 알고 있는 시도 (그 칸 값일 때만 넘긴다).
 * 반대쪽 끝점을 보고 정하므로, 출발지를 먼저 한 번 정한 뒤 도착지, 다시 출발지 순으로 맞춘다.
 */
export function resolveFareRoute(
  from: string,
  to: string,
  hints: { from?: FareRegion | null; to?: FareRegion | null } = {},
): { from: ResolvedRegion | null; to: ResolvedRegion | null } {
  const first = hints.from ?? resolveFareRegion(from, hints.to ?? null);
  const toRegion = hints.to ?? resolveFareRegion(to, first);
  const fromRegion = hints.from ?? resolveFareRegion(from, toRegion);
  return { from: fromRegion, to: toRegion };
}

/** 시도가 둘 다 있으면 시도까지 같아야 같은 곳이다 (강원 고성 ≠ 경남 고성). */
export function sameRegion(a: FareRegion, b: FareRegion): boolean {
  return a.시군 === b.시군 && (!a.시도 || !b.시도 || a.시도 === b.시도);
}

/** 칩에 쓸 이름: 동명 지역만 시도를 붙인다 ("강원 고성", "경기 광주", "광주광역시"). */
export function regionLabel(region: FareRegion): string {
  if (sameNameProvinces(region.시군).length === 0 || !region.시도) return region.시군;
  if (METRO_CITIES.has(region.시도) && region.시도 === region.시군) return `${region.시군}${region.시도 === '세종' ? '특별자치시' : '광역시'}`;
  return `${region.시도} ${region.시군}`;
}

/** 같은 이름의 다른 시도 후보 — 바꾸기 칩에 쓴다. */
export function alternativeRegions(region: FareRegion): FareRegion[] {
  return sameNameProvinces(region.시군).filter((p) => p !== region.시도).map((시도) => ({ 시도, 시군: region.시군 }));
}

/* ── 지역 → TAGO 시외버스 터미널 ── */

export interface TagoTerminal {
  id: string;
  name: string;
  /** 줄인 시도 이름 */
  시도: string;
}

/**
 * 터미널 이름이 시군 이름과 달라 이름만으로 못 찾는 곳, 큰 도시라 터미널이 여럿인 곳의 터미널 목록 (앞이 우선).
 * 키는 동명 지역이면 "시도 시군", 아니면 시군. 이 목록이 있으면 이 터미널만 쓴다.
 */
const TERMINAL_ALIASES: Record<string, string[]> = {
  '강원 고성': ['간성', '거진', '대진'],
  '경남 고성': ['고성', '배둔'],
  '광주 광주': ['광주(유·스퀘어)'],
  '경기 광주': ['광주(경기)'],
  서울: ['동서울', '서울고속버스터미널(경부)', '서울남부', '상봉'],
  부산: ['부산동부', '노포', '부산서부(사상)', '부산해운대'],
  대구: ['대구동부', '대구북부', '대구서부'],
  대전: ['대전복합', '유성복합', '대전서남부'],
  세종: ['세종시', '조치원', '세종청사'],
  인천: ['인천', '인천공항2터미널'],
  양양: ['양양', '하조대'],
  평창: ['평창', '횡계'],
  인제: ['인제', '원통', '신남', '백담사입구'],
  강릉: ['강릉', '주문진'],
  삼척: ['삼척', '임원', '호산'],
  철원: ['동송', '와수리'],
  화천: ['화천', '사창리', '산양리', '다목리'],
  정선: ['정선', '고한사북공영'],
  창원: ['창원', '마산', '진해', '마산남부', '창원남산'],
  경주: ['경주시외', '경주고속'],
  홍성: ['홍성', '내포'],
  파주: ['문산공용', '금촌역'],
  양평: ['용문'],
  포천: ['일동'],
};

function terminalAliases(region: FareRegion): string[] | undefined {
  return TERMINAL_ALIASES[`${region.시도} ${region.시군}`] ?? TERMINAL_ALIASES[region.시군];
}

/** 터미널 이름이 그 지역의 것인가 — 별칭 목록, 같은 이름, 시군 이름으로 시작("수원터미널"), "(시군)" 표기 순. */
export function terminalMatches(region: FareRegion, name: string, province = ''): boolean {
  const terminalProvince = provinceShort(province);
  if (region.시도 && terminalProvince && region.시도 !== terminalProvince) return false;
  const aliases = terminalAliases(region);
  if (aliases) return aliases.includes(name);
  return name === region.시군 || name.startsWith(region.시군) || name.includes(`(${region.시군})`);
}

/** 지역의 터미널 후보 — 별칭 순서, 같은 이름, 시군 이름으로 시작, "(시군)" 표기 순. 시도가 있으면 그 시도 안에서만. */
export function terminalsForRegion(region: FareRegion, terminals: readonly TagoTerminal[]): TagoTerminal[] {
  const pool = region.시도 ? terminals.filter((t) => t.시도 === region.시도) : terminals;
  const aliases = terminalAliases(region);
  if (aliases) return aliases.flatMap((name) => pool.filter((t) => t.name === name));
  const ranked = [
    ...pool.filter((t) => t.name === region.시군),
    ...pool.filter((t) => t.name !== region.시군 && t.name.startsWith(region.시군)),
    ...pool.filter((t) => t.name.includes(`(${region.시군})`)),
  ];
  return [...new Set(ranked)];
}
