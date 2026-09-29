/**
 * 지도 검색 결과 주소에서 운임 출발지·도착지에 쓸 도시명을 뽑는다.
 *
 *  - 특별시·광역시·특별자치시는 시·도 이름: "서울 강남구 …" → "서울", "세종특별자치시 …" → "세종"
 *  - 그 밖은 시·군 이름에서 "시/군" 을 뗀다: "강원특별자치도 삼척시 …" → "삼척", "경기 수원시 영통구 …" → "수원"
 *
 * 카카오 주소는 시·도를 줄여 쓰기도("경북", "서울") 하고 온전히 쓰기도("강원특별자치도") 해서 둘 다 받는다.
 */

/** "삼척다목적체육관, 삼척종합운동장" 처럼 여러 장소를 한 칸에 쓴 경우 — 장소별로 나눠야 검색된다. */
export function splitPlaces(text: string): string[] {
  return text.split(/[,，、;/]/).map((part) => part.trim()).filter(Boolean);
}

/** 장소별 도시를 한 칸 값으로 — 같은 도시는 한 번만, 다른 도시는 "삼척·동해" 처럼 잇는다. */
export function joinCities(cities: string[]): string {
  return [...new Set(cities.filter(Boolean))].join('·');
}

const METRO_CITIES = new Set(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종']);

export function cityFromAddress(address: string): string {
  const [province = '', district = ''] = address.trim().split(/\s+/);
  const metro = province.replace(/(특별시|광역시|특별자치시)$/, '');
  if (METRO_CITIES.has(metro)) return metro;
  if (!district) return '';
  // "고성군" → "고성". 한 글자만 남는 경우는 없지만, 혹시 몰라 원래 이름을 그대로 둔다.
  const city = district.replace(/[시군]$/, '');
  return city.length >= 2 ? city : district;
}
