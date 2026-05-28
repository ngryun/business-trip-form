import type { WasmBridge } from '@/core/wasm-bridge';

const PX_PER_INCH = 96;
const RENDER_SCALE = 2;

/**
 * 미리보기 캔버스를 그대로 인쇄하면 모바일(특히 iOS Safari)에서 absolute 로 띄운 캔버스와
 * 가상 스크롤로 인해 일부 페이지가 잘리거나 빈 페이지로 출력되는 경우가 잦다.
 *
 * 이 함수는 현재 문서의 모든 페이지를 BehindText/InFrontOfText 이미지 포함('all' 레이어)으로
 * 캔버스에 다시 렌더링한 뒤, 인쇄 전용 HTML 을 숨김 iframe 에 주입해 인쇄/PDF 저장을 트리거한다.
 *
 * 동작 방식:
 *  - iframe 안 HTML 은 페이지당 한 장의 <img> 만 가지며 @page 크기를 페이지 실제 크기에 맞춘다
 *  - 모바일은 popup blocker 와 화면 가시성 이슈가 있어 새 창 대신 iframe 으로 처리한다
 *  - 인쇄 다이얼로그가 닫히고 일정 시간 후 iframe 을 제거한다
 */
export async function printPdf(wasm: WasmBridge): Promise<void> {
  const pageCount = wasm.pageCount;
  if (pageCount === 0) throw new Error('인쇄할 페이지가 없습니다.');

  const pages: { dataUrl: string; widthMm: number; heightMm: number }[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const info = wasm.getPageInfo(i);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(info.width * RENDER_SCALE));
    canvas.height = Math.max(1, Math.round(info.height * RENDER_SCALE));
    wasm.renderPageToCanvasFiltered(i, canvas, RENDER_SCALE, 'all');
    pages.push({
      dataUrl: canvas.toDataURL('image/png'),
      widthMm: pxToMm(info.width),
      heightMm: pxToMm(info.height),
    });
  }

  const html = buildPrintHtml(pages);
  await printInIframe(html);
}

function pxToMm(px: number): number {
  // 미리보기 좌표는 96dpi CSS px. 이를 mm 로 환산해서 @page 에 넘긴다.
  return (px / PX_PER_INCH) * 25.4;
}

function buildPrintHtml(pages: { dataUrl: string; widthMm: number; heightMm: number }[]): string {
  // 모든 페이지가 같은 크기라고 가정하고 첫 페이지 크기로 @page 를 지정한다.
  const { widthMm, heightMm } = pages[0];
  const widthStr = widthMm.toFixed(2);
  const heightStr = heightMm.toFixed(2);

  const body = pages
    .map((p, idx) => {
      const breakAfter = idx < pages.length - 1 ? 'page-break-after: always;' : '';
      return `<img src="${p.dataUrl}" style="${breakAfter}" alt="페이지 ${idx + 1}" />`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>출장신청서 인쇄</title>
<style>
  @page {
    size: ${widthStr}mm ${heightStr}mm;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  img {
    display: block;
    width: ${widthStr}mm;
    height: ${heightStr}mm;
    /* 화면에서 살짝 보일 때를 위해 그림자 */
    box-shadow: 0 0 1px rgba(0,0,0,0.05);
  }
  @media print {
    img {
      box-shadow: none;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function printInIframe(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      // 인쇄 다이얼로그가 화면에서 사라진 뒤에도 iOS 일부 버전이 iframe 을 참조하므로 여유를 둔다.
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch { /* ignore */ }
      }, 1000);
      resolve();
    };

    iframe.onload = (): void => {
      const win = iframe.contentWindow;
      if (!win) {
        finish();
        return;
      }
      // afterprint 이벤트는 데스크톱 Chrome/Firefox 에서 잘 동작한다. 모바일 미지원 환경을 위해
      // 강제 타이머도 함께 둔다.
      const onAfter = (): void => {
        win.removeEventListener('afterprint', onAfter);
        finish();
      };
      win.addEventListener('afterprint', onAfter);
      setTimeout(finish, 60_000);

      // 이미지가 모두 로드된 뒤에 인쇄 시작
      const imgs = Array.from(win.document.images);
      const waitImgs = imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((res) => {
          img.addEventListener('load', () => res(), { once: true });
          img.addEventListener('error', () => res(), { once: true });
        });
      });
      Promise.all(waitImgs).then(() => {
        try {
          win.focus();
          win.print();
        } catch (err) {
          console.error('[print-pdf] iframe print 실패:', err);
          finish();
        }
      });
    };

    // srcdoc 은 iOS Safari 와 데스크톱 모두에서 동기적으로 잘 동작한다.
    iframe.srcdoc = html;
  });
}
