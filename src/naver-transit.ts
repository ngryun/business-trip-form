/**
 * 요금표에 없는 구간은 네이버지도 대중교통 길찾기에서 시외버스 최소요금을 확인해 입력한다.
 * 출발·도착 터미널 좌표를 넣은 길찾기 주소를 만들어 한 번에 열 수 있게 한다.
 * 주소 형식(좌표,이름/좌표,이름/-/transit)은 2026-10 실제 브라우저에서 확인했다.
 */

export interface PlacePoint {
  name: string;
  /** 경도 (카카오 x) */
  x: string;
  /** 위도 (카카오 y) */
  y: string;
}

/** 도시명 → 터미널 검색어 후보. 앞에서부터 찾아 처음 나오는 결과를 쓴다. */
const TERMINAL_ALIASES: Record<string, string[]> = {
  고성: ['간성시외버스터미널'],
  간성: ['간성시외버스터미널'],
  서울: ['동서울종합터미널'],
  동서울: ['동서울종합터미널'],
  속초: ['속초시외버스터미널'],
  춘천: ['춘천시외버스터미널'],
  원주: ['원주시외버스터미널'],
  강릉: ['강릉시외버스터미널'],
};

export function terminalQueries(city: string): string[] {
  const name = (city ?? '').trim();
  if (!name) return [];
  const own = TERMINAL_ALIASES[name] ?? [];
  const generic = [`${name} 시외버스터미널`, `${name} 버스터미널`, `${name}터미널`];
  return [...new Set([...own, ...generic])];
}

export function naverTransitUrl(start: PlacePoint, goal: PlacePoint): string {
  const point = (p: PlacePoint): string => `${p.x},${p.y},${encodeURIComponent(p.name)}`;
  return `https://map.naver.com/p/directions/${point(start)}/${point(goal)}/-/transit`;
}
