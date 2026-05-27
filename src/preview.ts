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
 * 필드 값을 setFieldValue 로 갱신한 뒤 호출해 미리보기를 다시 그린다.
 *
 * CanvasView.loadDocument() 가 페이지 캐시·캔버스 풀을 완전 초기화 후 재렌더링한다.
 * 단순 이벤트 emit 만으로는 같은 셀 안의 두 번째 필드가 갱신 안 되는 케이스가 있어서
 * 전체 reload 가 가장 확실한 방법.
 */
export function refreshPreview(wasm: WasmBridge): void {
  if (!canvasView) return;
  // 누름틀이 active 상태로 잔존하면 안내문이 화면에 남을 수 있어 명시적으로 해제
  try { (wasm as any).clearActiveField?.(); } catch { /* ignore */ }
  try { wasm.refreshLayout(); } catch { /* ignore */ }
  canvasView.loadDocument();
}
