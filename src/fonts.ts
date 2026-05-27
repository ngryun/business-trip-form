/**
 * HWP 문서에 쓰이는 한글 폰트들을 웹 폰트로 매핑한다.
 *
 * studio-host 의 font-loader.ts 에서 매핑 테이블만 발췌. local font 감지 같은
 * 데스크톱 전용 로직은 제외하고, 항상 웹폰트로 등록한다.
 *
 * woff2 파일은 vite.config.ts 의 미들웨어가 `/fonts/*` 경로로 서빙한다.
 */
interface FontEntry {
  name: string;
  file: string;
}

const FONT_LIST: FontEntry[] = [
  { name: '함초롬돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '함초롬바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '함초롱돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '함초롱바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '한컴돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '한컴바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '새돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '새바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'HY헤드라인M', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYHeadLine M', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYHeadLine Medium', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HY견고딕', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYGothic-Extra', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HY그래픽', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HYGraphic-Medium', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HY그래픽M', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HY견명조', file: '/fonts/NotoSerifKR-Bold.woff2' },
  { name: 'HYMyeongJo-Extra', file: '/fonts/NotoSerifKR-Bold.woff2' },
  { name: 'HY신명조', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'HY중고딕', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '양재튼튼체B', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'Malgun Gothic', file: '/fonts/Pretendard-Regular.woff2' },
  { name: '맑은 고딕', file: '/fonts/Pretendard-Regular.woff2' },
  { name: '돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '돋움체', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '굴림', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '굴림체', file: '/fonts/D2Coding-Regular.woff2' },
  { name: '새굴림', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '바탕체', file: '/fonts/D2Coding-Regular.woff2' },
  { name: '궁서', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '궁서체', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '새궁서', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '나눔고딕', file: '/fonts/NanumGothic-Regular.woff2' },
  { name: '나눔명조', file: '/fonts/NanumMyeongjo-Regular.woff2' },
  { name: '나눔고딕코딩', file: '/fonts/NanumGothicCoding-Regular.woff2' },
  { name: 'Palatino Linotype', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'Noto Sans KR', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'Noto Serif KR', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'Pretendard', file: '/fonts/Pretendard-Regular.woff2' },
  { name: 'Pretendard Thin', file: '/fonts/Pretendard-Thin.woff2' },
  { name: 'Pretendard ExtraLight', file: '/fonts/Pretendard-ExtraLight.woff2' },
  { name: 'Pretendard Light', file: '/fonts/Pretendard-Light.woff2' },
  { name: 'Pretendard Medium', file: '/fonts/Pretendard-Medium.woff2' },
  { name: 'Pretendard SemiBold', file: '/fonts/Pretendard-SemiBold.woff2' },
  { name: 'Pretendard Bold', file: '/fonts/Pretendard-Bold.woff2' },
  { name: 'Pretendard ExtraBold', file: '/fonts/Pretendard-ExtraBold.woff2' },
  { name: 'Pretendard Black', file: '/fonts/Pretendard-Black.woff2' },
  { name: 'D2Coding', file: '/fonts/D2Coding-Regular.woff2' },
  { name: 'SpoqaHanSans', file: '/fonts/SpoqaHanSans-Regular.woff2' },
  { name: '고운바탕', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '고운돋움', file: '/fonts/GowunDodum-Regular.woff2' },
];

const CRITICAL_FONTS = new Set(['함초롬바탕', '함초롬돋움', 'Noto Sans KR', 'Noto Serif KR']);

let registered = false;
const loadedFiles = new Set<string>();

/**
 * FONT_LIST 의 `/fonts/x.woff2` 경로를 배포 베이스(BASE_URL) 기준으로 변환한다.
 * - dev: BASE_URL='/' → '/fonts/x.woff2'
 * - GitHub Pages(base './'): BASE_URL='./' → './fonts/x.woff2' (페이지 하위 경로로 해석)
 */
function fontUrl(file: string): string {
  return import.meta.env.BASE_URL + file.replace(/^\//, '');
}

/**
 * 페이지 로드 직후 호출. 매핑 테이블의 모든 폰트 패밀리를 @font-face 로 등록만 한다.
 * 실제 다운로드는 브라우저가 텍스트 렌더링 시점에 알아서 한다 (font-display: swap).
 */
export function registerFontFaces(): void {
  if (registered) return;
  const style = document.createElement('style');
  style.id = 'web-form-font-faces';
  style.textContent = FONT_LIST.map((f) =>
    `@font-face { font-family: "${f.name}"; src: url("${fontUrl(f.file)}") format("woff2"); font-display: swap; }`,
  ).join('\n');
  document.head.appendChild(style);
  registered = true;
}

/**
 * 문서가 실제로 쓰는 폰트들 + critical 폰트를 적극적으로 미리 로드.
 * 매칭되지 않는 폰트는 조용히 건너뛴다.
 */
export async function preloadFonts(docFonts: string[] = []): Promise<void> {
  registerFontFaces();
  const wanted = new Set<string>([...docFonts, ...CRITICAL_FONTS]);
  const targets = FONT_LIST.filter((f) => wanted.has(f.name) && !loadedFiles.has(f.file));
  if (targets.length === 0) return;
  // 같은 woff2 파일을 여러 별칭에 매핑하므로 파일 단위로 중복 제거
  const byFile = new Map<string, FontEntry[]>();
  for (const t of targets) {
    const list = byFile.get(t.file);
    if (list) list.push(t);
    else byFile.set(t.file, [t]);
  }
  await Promise.all(
    [...byFile.entries()].map(async ([file, entries]) => {
      try {
        const sample = entries[0];
        const url = fontUrl(file);
        const face = new FontFace(sample.name, `url("${url}") format("woff2")`);
        await face.load();
        for (const e of entries) {
          const aliasFace = new FontFace(e.name, `url("${url}") format("woff2")`);
          document.fonts.add(await aliasFace.load());
        }
        loadedFiles.add(file);
      } catch {
        // missing → CSS @font-face fallback 으로 자동 처리
      }
    }),
  );
}
