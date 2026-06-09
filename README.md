# 출장신청서 자동작성 (business-trip-form)

HWP 출장신청서 양식의 **누름틀(ClickHere)** 필드를 웹에서 자동으로 채워
**HWP 다운로드 · PDF/인쇄 · 미리보기**까지 할 수 있는 정적 웹앱입니다.

서버가 없어 입력한 개인정보가 외부로 전송되지 않습니다 (전부 브라우저에서 처리).

## 사용 방법 (두 가지 입력 경로)

1. **사이드패널 폼** — 왼쪽 폼에서 소속·성명·일시·교통편 등을 입력하면 미리보기에 바로 반영
2. **인라인 편집** — 미리보기에서 누름틀을 직접 클릭하면 항목에 맞는 입력창(달력/드롭다운/텍스트)이 떠서 한 칸씩 수정

작성이 끝나면 "HWP 다운로드" 또는 "PDF로 저장 / 인쇄".
"URL 공유"는 입력값을 해시 프래그먼트(#)에 담으므로 서버(접근 로그 포함)로 전송되지 않습니다.

## 로컬 실행

```bash
pnpm install
pnpm dev      # http://127.0.0.1:7710
```

## 빌드 / 배포

```bash
pnpm build    # dist/ 생성
```

`dist/` 를 Cloudflare Pages · Vercel · Netlify · GitHub Pages 등 정적 호스팅에 올리면 됩니다.

## 양식 교체 방법

`public/templates/business-trip.hwp` 를 원하는 HWP 양식으로 교체합니다.
한글에서 누름틀(Ctrl+K, E) 의 **이름** 또는 **안내문구**를 아래 라벨로 맞추면 자동 매칭됩니다:

`소속`, `직급`, `성명`, `시작일시`, `종료일시`, `출장지`,
`갈때일자`, `갈때교통편`, `갈때출발지`, `갈때도착지`,
`올때일자`, `올때교통편`, `올때출발지`, `올때도착지`, `제출날짜`, `첨부서류`

입력 위젯 타입은 `src/field-config.ts` 에서 라벨별로 조정할 수 있습니다.

## 구조

```
src/
├── main.ts             엔트리 · 폼 핸들링 · 사이드패널 토글
├── field-config.ts     누름틀 라벨 → 입력 위젯 매핑 + 한국식 날짜 포맷
├── field-filler.ts     누름틀 스캔 + 값 주입 (검정 글자색 강제, 안내문 제거)
├── field-popover.ts    인라인 편집 팝오버
├── field-interaction.ts 캔버스 클릭 → 누름틀 hit-test → 팝오버
├── preview.ts          미리보기 캔버스 (CanvasView 래핑)
├── template-loader.ts  HWP 양식 fetch + 로드
├── download.ts         exportHwp → Blob 다운로드
├── fonts.ts            한글 폰트 @font-face 등록 + 프리로드
├── styles.css
└── upstream/           rhwp-studio 의 렌더링 엔진 코어 (vendored)
```

## 엔진 / 라이선스

HWP 파싱·렌더링·저장은 WASM 엔진 [`@rhwp/core`](https://www.npmjs.com/package/@rhwp/core) 가 담당합니다.
`src/upstream/` 의 TypeScript 코어는 [rhwp-studio](https://github.com/edwardkim/rhwp) 에서 가져온 것입니다.

폰트는 모두 오픈소스(Noto, Pretendard, 나눔, 고운, D2Coding 등)입니다. `assets/fonts/FONTS.md` 참고.
