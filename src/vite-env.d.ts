/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 카카오맵 JavaScript 키 — 소속·출장지로 운임 출발지·도착지 도시명을 찾는 데 쓴다. 없으면 기능이 꺼진다. */
  readonly VITE_KAKAO_JS_KEY?: string;
  /** 공공데이터포털 TAGO 시외버스정보 인증키 — 운임 공식 요금을 실시간으로 조회한다. 없으면 내장 자료만 쓴다. */
  readonly VITE_TAGO_KEY?: string;
}
