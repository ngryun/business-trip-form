/**
 * 미리보기 캔버스에서의 누름틀 클릭 → 입력 팝오버 흐름.
 *
 * 1) 클릭 좌표를 페이지 좌표로 변환 (CanvasView 의 virtualScroll/viewportManager 활용)
 * 2) wasm.hitTest 로 DocumentPosition 산출
 * 3) wasm.getFieldInfoAt 로 누름틀 여부 확인
 * 4) 매칭되는 라벨이 FIELD_CONFIGS 에 있으면 팝오버를 띄움
 * 5) 확정 시 setFieldValues 로 같은 라벨의 모든 누름틀에 동일 값 반영
 *
 * 호버 시 커서를 pointer 로 바꿔 클릭 가능 여부를 시각화한다.
 */

import type { WasmBridge } from '@/core/wasm-bridge';
import type { CanvasView } from '@/view/canvas-view';
import { FIELD_CONFIGS, formatForLabel, parseFromHWP } from './field-config';
import { setFieldValues, type FieldMap } from './field-filler';
import { closeFieldPopover, isPopoverOpen, showFieldPopover } from './field-popover';

export interface InlineEditDeps {
  wasm: WasmBridge;
  canvasView: CanvasView;
  /** scroll-container 요소 (이벤트를 붙일 대상) */
  container: HTMLElement;
  /** 현재 누름틀 매핑을 반환 (편집 후 재스캔된 최신 값) */
  getFields: () => FieldMap;
  /** 편집 적용 직후 호출 — 미리보기 갱신·필드 재스캔·폼 동기화 등 */
  onAfterEdit: (label: string, value: string) => void;
}

export function attachInlineEditing(deps: InlineEditDeps): () => void {
  const { wasm, canvasView, container, getFields, onAfterEdit } = deps;
  const scrollContent = container.querySelector<HTMLElement>('#scroll-content');
  if (!scrollContent) return () => undefined;

  // mousemove 는 자주 발생하므로 rAF 로 throttle
  let pendingMove: MouseEvent | null = null;
  let rafId = 0;

  const onClick = (e: MouseEvent): void => {
    // 팝오버 영역 클릭은 외부 핸들러가 처리
    if (isPopoverOpen()) return;
    const hit = clickToFieldId(e);
    if (hit === null) return;
    e.preventDefault();
    e.stopPropagation();
    openPopoverFor(hit, e);
  };

  const onMove = (e: MouseEvent): void => {
    pendingMove = e;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const ev = pendingMove;
      pendingMove = null;
      if (!ev) return;
      const hit = clickToFieldId(ev);
      scrollContent.style.cursor = hit !== null ? 'pointer' : '';
    });
  };

  const onScroll = (): void => {
    // 스크롤 중에는 좌표가 흔들리므로 팝오버를 닫는다
    if (isPopoverOpen()) closeFieldPopover();
  };

  function clickToFieldId(e: MouseEvent): number | null {
    const virtualScroll = canvasView.getVirtualScroll();
    const viewportManager = canvasView.getViewportManager();
    const zoom = viewportManager.getZoom();

    const contentRect = scrollContent!.getBoundingClientRect();
    const contentX = e.clientX - contentRect.left;
    const contentY = e.clientY - contentRect.top;

    let pageIdx: number;
    try {
      pageIdx = virtualScroll.getPageAtPoint(contentX, contentY);
    } catch {
      return null;
    }
    if (pageIdx < 0) return null;

    const pageOffset = virtualScroll.getPageOffset(pageIdx);
    const pageLeft = virtualScroll.getPageLeftResolved(pageIdx, scrollContent!.clientWidth);
    const pageX = (contentX - pageLeft) / zoom;
    const pageY = (contentY - pageOffset) / zoom;

    let pos;
    try {
      pos = wasm.hitTest(pageIdx, pageX, pageY);
    } catch {
      return null;
    }

    let fi;
    try {
      fi = wasm.getFieldInfoAt(pos);
    } catch {
      return null;
    }
    if (!fi.inField || fi.fieldId === undefined) return null;

    // FIELD_CONFIGS 에 등록된 라벨에 해당하는지 확인
    const label = findLabelForFieldId(getFields(), fi.fieldId);
    if (!label || !FIELD_CONFIGS[label]) return null;
    return fi.fieldId;
  }

  function openPopoverFor(fieldId: number, e: MouseEvent): void {
    const fields = getFields();
    const label = findLabelForFieldId(fields, fieldId);
    if (!label) return;
    const entry = fields.get(label)?.find((en) => en.fieldId === fieldId);
    const initial = parseFromHWP(label, entry?.value ?? '');
    showFieldPopover({
      label,
      initialValue: initial,
      anchor: { x: e.clientX, y: e.clientY },
      onConfirm: (raw) => {
        const value = formatForLabel(label, raw);
        // 빈 값이면 아무것도 하지 않음 (취소처럼 동작)
        if (!value) return;
        // setFieldValues 가 forceBlackOnFields + clearGuide 까지 처리한다
        try {
          setFieldValues(wasm, getFields(), { [label]: value });
        } catch (err) {
          console.error('[field-interaction] 적용 실패:', err);
          return;
        }
        onAfterEdit(label, value);
      },
      onCancel: () => undefined,
    });
  }

  scrollContent.addEventListener('click', onClick, { capture: true });
  scrollContent.addEventListener('mousemove', onMove);
  container.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    scrollContent.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
    scrollContent.removeEventListener('mousemove', onMove);
    container.removeEventListener('scroll', onScroll);
    if (rafId) cancelAnimationFrame(rafId);
    closeFieldPopover();
  };
}

function findLabelForFieldId(fields: FieldMap, fieldId: number): string | null {
  for (const [label, entries] of fields) {
    if (entries.some((e) => e.fieldId === fieldId)) return label;
  }
  return null;
}
