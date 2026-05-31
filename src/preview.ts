import type { WasmBridge } from '@/core/wasm-bridge';
import { EventBus } from '@/core/event-bus';
import { CanvasView } from '@/view/canvas-view';

/**
 * 미리보기 캔버스. rhwp-studio 의 CanvasView 를 재사용한다.
 *
 * - 인자 container 는 `#scroll-content` 자식 노드를 가져야 한다 (index.html 에 이미 있음).
 * - 인라인 편집을 위해 CanvasView 인스턴스를 외부에 노출한다.
 */
let canvasView: CanvasView | null = null;
let eventBus: EventBus | null = null;

export function mountPreview(container: HTMLElement, wasm: WasmBridge): CanvasView {
  if (canvasView) {
    canvasView.loadDocument();
    return canvasView;
  }
  eventBus = new EventBus();
  canvasView = new CanvasView(container, wasm, eventBus);
  canvasView.loadDocument();
  return canvasView;
}

export function getCanvasView(): CanvasView | null {
  return canvasView;
}

/**
 * refreshPreview 의 문서 재파싱 직후(렌더 전) 호출되는 훅.
 * 재파싱하면 도장 그림의 본문배치가 rhwp exporter 버그로 '어울림' 으로 풀리므로,
 * 여기서 도장 위치/배치를 다시 적용한다. main.ts 에서 등록한다.
 */
let onAfterReload: (() => void) | null = null;
export function setPreviewReloadHook(fn: (() => void) | null): void {
  onAfterReload = fn;
}

/**
 * 필드 값을 setFieldValue 로 갱신한 뒤 호출해 미리보기를 다시 그린다.
 *
 * rhwp 0.7.11 은 setFieldValue 로 셀 안 누름틀에 긴 텍스트를 넣으면 그 셀의 line_segs 를
 * 충분히 재계산하지 못해 ~12자 이후가 잘려 보인다(병합 셀 가용폭 계산 한계). 반면 문서를
 * 직렬화 후 다시 파싱하면 전체 레이아웃이 올바르게 계산된다. 그래서 export→reload 로
 * 깨끗한 레이아웃을 만든 뒤 렌더한다. (다운로드 결과 hwp 자체는 원래도 정상이었다.)
 */
export function refreshPreview(wasm: WasmBridge): void {
  if (!canvasView) return;
  // 누름틀이 active 상태로 잔존하면 안내문이 화면에 남을 수 있어 명시적으로 해제
  try { (wasm as any).clearActiveField?.(); } catch { /* ignore */ }

  let reloaded = false;
  try {
    const bytes = wasm.exportHwp();
    if (bytes && bytes.length > 0) {
      wasm.loadDocument(bytes);
      reloaded = true;
    }
  } catch (e) {
    console.warn('[preview] 재파싱 실패, in-memory 레이아웃으로 렌더:', e);
  }

  if (reloaded) {
    // 재파싱으로 풀린 도장 배치(글 뒤로) 등을 다시 적용
    try { onAfterReload?.(); } catch (e) { console.warn('[preview] reload 훅 실패:', e); }
  } else {
    try { wasm.refreshLayout(); } catch { /* ignore */ }
  }

  canvasView.loadDocument();
}
