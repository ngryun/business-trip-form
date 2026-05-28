import type { WasmBridge } from '@/core/wasm-bridge';

const PX_PER_INCH = 96;
const PT_PER_INCH = 72;
const RENDER_SCALE = 2;
const JPEG_QUALITY = 0.92;

export type PdfSaveResult = 'shared' | 'downloaded' | 'opened' | 'printed' | 'cancelled';

interface PrintPage {
  dataUrl: string;
  widthMm: number;
  heightMm: number;
}

interface PdfImagePage {
  jpegBytes: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  widthPt: number;
  heightPt: number;
}

/**
 * 미리보기 캔버스를 그대로 인쇄하면 모바일(특히 iOS Safari)에서 absolute 로 띄운 캔버스와
 * 가상 스크롤로 인해 일부 페이지가 잘리거나 빈 페이지로 출력되는 경우가 잦다.
 *
 * 데스크톱에서는 현재 문서의 모든 페이지를 BehindText/InFrontOfText 이미지 포함('all' 레이어)으로
 * 캔버스에 다시 렌더링한 뒤, 인쇄 전용 HTML 을 숨김 iframe 에 주입해 인쇄/PDF 저장을 트리거한다.
 *
 * iOS Safari 는 iframe print() 에서 PDF 저장 흐름이 불안정해서, 모바일에서는 실제 PDF Blob 을
 * 브라우저에서 생성한 다음 Web Share 또는 다운로드로 넘긴다.
 *
 * 동작 방식:
 *  - iframe 안 HTML 은 페이지당 한 장의 <img> 만 가지며 @page 크기를 페이지 실제 크기에 맞춘다
 *  - 모바일은 popup blocker 와 화면 가시성 이슈가 있어 새 창 대신 iframe 으로 처리한다
 *  - 인쇄 다이얼로그가 닫히고 일정 시간 후 iframe 을 제거한다
 */
export async function printPdf(wasm: WasmBridge, fileName = '출장신청서.pdf'): Promise<PdfSaveResult> {
  const pageCount = wasm.pageCount;
  if (pageCount === 0) throw new Error('인쇄할 페이지가 없습니다.');

  if (shouldUseFilePdfSave()) {
    const pdfBlob = await createPdfBlob(wasm);
    return savePdfBlob(pdfBlob, ensurePdfExtension(fileName));
  }

  const pages: PrintPage[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const info = wasm.getPageInfo(i);
    const canvas = renderPageCanvas(wasm, i);
    pages.push({
      dataUrl: canvas.toDataURL('image/png'),
      widthMm: pxToMm(info.width),
      heightMm: pxToMm(info.height),
    });
  }

  const html = buildPrintHtml(pages);
  await printInIframe(html);
  return 'printed';
}

function pxToMm(px: number): number {
  // 미리보기 좌표는 96dpi CSS px. 이를 mm 로 환산해서 @page 에 넘긴다.
  return (px / PX_PER_INCH) * 25.4;
}

function pxToPt(px: number): number {
  return (px / PX_PER_INCH) * PT_PER_INCH;
}

function renderPageCanvas(wasm: WasmBridge, pageIndex: number): HTMLCanvasElement {
  const info = wasm.getPageInfo(pageIndex);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(info.width * RENDER_SCALE));
  canvas.height = Math.max(1, Math.round(info.height * RENDER_SCALE));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  wasm.renderPageToCanvasFiltered(pageIndex, canvas, RENDER_SCALE, 'all');
  return canvas;
}

async function createPdfBlob(wasm: WasmBridge): Promise<Blob> {
  const pages: PdfImagePage[] = [];
  for (let i = 0; i < wasm.pageCount; i += 1) {
    const info = wasm.getPageInfo(i);
    const canvas = renderPageCanvas(wasm, i);
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    pages.push({
      jpegBytes: new Uint8Array(await jpegBlob.arrayBuffer()),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      widthPt: pxToPt(info.width),
      heightPt: pxToPt(info.height),
    });
  }
  return new Blob([buildPdfBytes(pages) as BlobPart], { type: 'application/pdf' });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PDF 이미지를 생성하지 못했습니다.'));
    }, type, quality);
  });
}

function buildPdfBytes(pages: PdfImagePage[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let byteLength = 0;

  const append = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  };
  const appendText = (text: string): void => append(encoder.encode(text));
  const appendObject = (objectNumber: number, body: string): void => {
    offsets[objectNumber] = byteLength;
    appendText(`${objectNumber} 0 obj\n${body}\nendobj\n`);
  };

  appendText('%PDF-1.4\n');
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  const objectCount = 2 + pages.length * 3;

  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  appendObject(2, `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    const pageObj = 3 + index * 3;
    const imageObj = pageObj + 1;
    const contentObj = pageObj + 2;
    const imageName = `Im${index}`;
    const width = pdfNumber(page.widthPt);
    const height = pdfNumber(page.heightPt);
    const content = `q\n${width} 0 0 ${height} 0 0 cm\n/${imageName} Do\nQ\n`;

    appendObject(
      pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /${imageName} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`,
    );

    offsets[imageObj] = byteLength;
    appendText(`${imageObj} 0 obj\n`);
    appendText(`<< /Type /XObject /Subtype /Image /Width ${page.imageWidth} /Height ${page.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.byteLength} >>\nstream\n`);
    append(page.jpegBytes);
    appendText('\nendstream\nendobj\n');

    appendObject(contentObj, `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream`);
  });

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objectCount; i += 1) {
    appendText(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function pdfNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function shouldUseFilePdfSave(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  return isIOS || isAndroid;
}

async function savePdfBlob(blob: Blob, fileName: string): Promise<PdfSaveResult> {
  const shareNavigator = navigator as Navigator & {
    canShare?: (data: { files?: File[]; title?: string }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  const file = typeof File === 'undefined'
    ? null
    : new File([blob], fileName, { type: 'application/pdf' });

  if (file && shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
    try {
      await shareNavigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      console.warn('[print-pdf] PDF 공유 실패, 다운로드로 대체:', err);
    }
  }

  return downloadPdfBlob(blob, fileName);
}

function downloadPdfBlob(blob: Blob, fileName: string): PdfSaveResult {
  const url = URL.createObjectURL(blob);
  const revokeLater = (): void => {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const supportsDownload = 'download' in HTMLAnchorElement.prototype;
  if (supportsDownload) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    revokeLater();
    return 'downloaded';
  }

  const opened = window.open(url, '_blank', 'noopener');
  if (opened) {
    revokeLater();
    return 'opened';
  }

  window.location.assign(url);
  revokeLater();
  return 'opened';
}

function ensurePdfExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName.replace(/\.[^.]+$/, '')}.pdf`;
}

function buildPrintHtml(pages: PrintPage[]): string {
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
