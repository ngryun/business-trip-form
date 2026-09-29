import { cityFromAddress } from './place-region';

/**
 * 카카오맵 JavaScript SDK 장소 검색으로 소속·출장지가 있는 도시를 찾는다.
 *
 * JavaScript 키는 Kakao Developers 에 등록한 도메인에서만 동작하므로 번들에 들어가도 된다.
 * 키(VITE_KAKAO_JS_KEY)가 없으면 기능 전체가 꺼진다.
 */

const KAKAO_JS_KEY: string = import.meta.env.VITE_KAKAO_JS_KEY ?? '';

export interface PlaceCity {
  city: string;
  placeName: string;
  address: string;
}

interface KakaoPlace {
  place_name: string;
  address_name: string;
  road_address_name: string;
}

interface KakaoServices {
  Places: new () => {
    keywordSearch(query: string, callback: (data: KakaoPlace[], status: string) => void, options?: { size?: number }): void;
  };
  Status: { OK: string; ZERO_RESULT: string; ERROR: string };
}

declare global {
  interface Window {
    kakao?: { maps: { load(callback: () => void): void; services: KakaoServices } };
  }
}

let sdkPromise: Promise<KakaoServices> | null = null;
const cache = new Map<string, Promise<PlaceCity | null>>();

export function isPlaceLookupEnabled(): boolean {
  return KAKAO_JS_KEY !== '';
}

function loadSdk(): Promise<KakaoServices> {
  sdkPromise ??= new Promise<KakaoServices>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao) {
        reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao!.maps.services));
    };
    script.onerror = () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  }).catch((err) => {
    // 네트워크 오류 뒤에는 다음 검색에서 다시 시도할 수 있게 한다.
    sdkPromise = null;
    throw err;
  });
  return sdkPromise;
}

/** 장소 이름으로 검색해 첫 결과의 도시명을 돌려준다. 결과가 없으면 null. */
export function lookupPlaceCity(query: string): Promise<PlaceCity | null> {
  const key = query.trim();
  if (!key || !isPlaceLookupEnabled()) return Promise.resolve(null);
  let pending = cache.get(key);
  if (!pending) {
    pending = loadSdk().then((services) => new Promise<PlaceCity | null>((resolve, reject) => {
      new services.Places().keywordSearch(key, (data, status) => {
        if (status === services.Status.ZERO_RESULT) {
          resolve(null);
          return;
        }
        if (status !== services.Status.OK) {
          reject(new Error('장소 검색에 실패했습니다.'));
          return;
        }
        for (const place of data) {
          const address = place.address_name || place.road_address_name;
          const city = cityFromAddress(address);
          if (city) {
            resolve({ city, placeName: place.place_name, address });
            return;
          }
        }
        resolve(null);
      }, { size: 5 });
    }));
    // 실패한 검색은 캐시하지 않는다.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
