/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 카카오맵 JavaScript 키 — 소속·출장지로 운임 출발지·도착지 도시명을 찾는 데 쓴다. 없으면 기능이 꺼진다. */
  readonly VITE_KAKAO_JS_KEY?: string;
}
