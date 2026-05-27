/**
 * 미리보기 캔버스에서의 누름틀 클릭 → 입력 팝오버 흐름 + 호버 하이라이트.
 *
 * 1) 마우스 좌표를 페이지 좌표로 변환 (CanvasView 의 virtualScroll/viewportManager 활용)
 * 2) wasm.hitTest 로 DocumentPosition 산출
 * 3) wasm.getFieldInfoAt 로 누름틀 여부 확인
 * 4) 매칭되는 라벨이 FIELD_CONFIGS 에 있으면:
 *    - 호버 시: 커서를 pointer 로 바꾸고 누름틀 영역에 노란 음영 오버레이 표시
 *    - 클릭 시: 입력 팝오버 표시
 * 5) 확정 시 setFieldValues 로 같은 라벨의 모든 누름틀에 동일 값 반영
 */

import type { WasmBridge } from '@/core/wasm-bridge';
import type { CanvasView } from '@/view/canvas-view';
import type { FieldInfoResult, HitTestResult } from '@/core/types';
import { FIELD_CONFIGS, formatDateTimeRangeEndKR, formatForLabel, parseFromHWP } from './field-config';
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

interface FieldHit {
  fieldId: number;
  label: string;
  pos: HitTestResult;
  fi: FieldInfoResult;
}

interface PageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function attachInlineEditing(deps: InlineEditDeps): () => void {
  const { wasm, canvasView, container, getFields, onAfterEdit } = deps;
  const scrollContent = container.querySelector<HTMLElement>('#scroll-content');
  if (!scrollContent) return () => undefined;

  // mousemove 는 자주 발생하므로 rAF 로 throttle
  let pendingMove: MouseEvent | null = null;
  let rafId = 0;

  // 호버 하이라이트 오버레이
  let highlightEl: HTMLDivElement | null = null;
  let hlFieldId: number | null = null;

  const onClick = (e: MouseEvent): void => {
    if (isPopoverOpen()) return;
    const hit = resolveFieldAt(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    hideHighlight();
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
      if (isPopoverOpen()) {
        hideHighlight();
        return;
      }
      const hit = resolveFieldAt(ev);
      if (!hit) {
        scrollContent.style.cursor = '';
        hideHighlight();
        return;
      }
      scrollContent.style.cursor = 'pointer';
      showHighlight(hit);
    });
  };

  const onLeave = (): void => {
    scrollContent.style.cursor = '';
    hideHighlight();
  };

  const onScroll = (): void => {
    // 스크롤 중에는 좌표/팝오버가 흔들리므로 정리
    hideHighlight();
    if (isPopoverOpen()) closeFieldPopover();
  };

  /** 마우스 이벤트 → 누름틀 정보 (FIELD_CONFIGS 에 등록된 라벨만) */
  function resolveFieldAt(e: MouseEvent): FieldHit | null {
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

    let pos: HitTestResult;
    try {
      pos = wasm.hitTest(pageIdx, pageX, pageY);
    } catch {
      return null;
    }

    let fi: FieldInfoResult;
    try {
      fi = wasm.getFieldInfoAt(pos);
    } catch {
      return null;
    }
    if (!fi.inField || fi.fieldId === undefined) return null;

    const label = findLabelForFieldId(getFields(), fi.fieldId);
    if (!label || !FIELD_CONFIGS[label]) return null;
    const resolvedLabel = resolvePairedDateTimeLabel(label, pos, fi, pageX);
    return { fieldId: fi.fieldId, label: resolvedLabel, pos, fi };
  }

  function openPopoverFor(hit: FieldHit, e: MouseEvent): void {
    const { fieldId, label } = hit;
    const entries = getFields().get(label) ?? [];
    const entry = entries.find((en) => en.fieldId === fieldId) ?? entries[0];
    const startRaw = getFields().get('시작일시')?.[0]?.value ?? '';
    const startValue = parseFromHWP('시작일시', startRaw);
    const initial = parseFromHWP(label, entry?.value ?? '', label === '종료일시' ? startValue : '');
    showFieldPopover({
      label,
      initialValue: initial,
      anchor: { x: e.clientX, y: e.clientY },
      onConfirm: (raw) => {
        const value = label === '종료일시'
          ? formatDateTimeRangeEndKR(raw, startValue)
          : formatForLabel(label, raw);
        if (!value) return; // 빈 값이면 취소처럼 동작
        try {
          // setFieldValues 가 forceBlackOnFields + clearGuide 까지 처리한다
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

  function resolvePairedDateTimeLabel(
    label: string,
    pos: HitTestResult,
    fi: FieldInfoResult,
    pageX: number,
  ): string {
    if (label !== '시작일시' || !getFields().has('종료일시')) return label;

    const rect = getFieldPageRect(pos, fi);
    if (!rect || rect.width <= 0) return label;

    return pageX >= rect.x + rect.width * 0.62 ? '종료일시' : label;
  }

  // ---- 하이라이트 오버레이 ----

  function ensureHighlightEl(): HTMLDivElement {
    if (!highlightEl) {
      highlightEl = document.createElement('div');
      highlightEl.className = 'field-hover-highlight';
      highlightEl.style.display = 'none';
    }
    // loadDocument() 가 scroll-content 자식을 갈아끼우면 분리되므로 재부착
    if (highlightEl.parentElement !== scrollContent) {
      scrollContent!.appendChild(highlightEl);
    }
    return highlightEl;
  }

  function showHighlight(hit: FieldHit): void {
    const el = ensureHighlightEl();
    if (hit.fieldId !== hlFieldId) {
      const pr = getFieldPageRect(hit.pos, hit.fi);
      const c = pr ? pageRectToContent(pr) : null;
      if (!c || c.width <= 0 || c.height <= 0) {
        hideHighlight();
        return;
      }
      const pad = 2;
      el.style.left = `${c.left - pad}px`;
      el.style.top = `${c.top - pad}px`;
      el.style.width = `${c.width + pad * 2}px`;
      el.style.height = `${c.height + pad * 2}px`;
      hlFieldId = hit.fieldId;
    }
    el.style.display = 'block';
  }

  function hideHighlight(): void {
    if (highlightEl) highlightEl.style.display = 'none';
    hlFieldId = null;
  }

  /** 누름틀의 페이지 좌표 사각형 (본문: getSelectionRects, 단일 셀: getCursorRectInCell × 2) */
  function getFieldPageRect(pos: HitTestResult, fi: FieldInfoResult): PageRect | null {
    const start = fi.startCharIdx;
    const end = fi.endCharIdx;
    if (start === undefined || end === undefined) return null;
    const inCell =
      pos.parentParaIndex !== undefined &&
      pos.controlIndex !== undefined &&
      pos.cellIndex !== undefined &&
      pos.cellParaIndex !== undefined;
    try {
      if (!inCell) {
        const rects = wasm.getSelectionRects(pos.sectionIndex, pos.paragraphIndex, start, pos.paragraphIndex, end);
        if (!rects || rects.length === 0) return null;
        return unionRects(rects);
      }
      // 중첩 표(깊이 2+)는 범위 외
      if ((pos.cellPath?.length ?? 1) > 1) return null;
      const r1 = wasm.getCursorRectInCell(pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!, pos.cellIndex!, pos.cellParaIndex!, start);
      const r2 = wasm.getCursorRectInCell(pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!, pos.cellIndex!, pos.cellParaIndex!, end);
      if (!r1 || !r2) return null;
      return {
        pageIndex: r1.pageIndex,
        x: Math.min(r1.x, r2.x),
        y: r1.y,
        width: Math.abs(r2.x - r1.x),
        height: r1.height,
      };
    } catch {
      return null;
    }
  }

  function pageRectToContent(r: PageRect): { left: number; top: number; width: number; height: number } | null {
    const virtualScroll = canvasView.getVirtualScroll();
    const zoom = canvasView.getViewportManager().getZoom();
    try {
      const pageOffset = virtualScroll.getPageOffset(r.pageIndex);
      const pageLeft = virtualScroll.getPageLeftResolved(r.pageIndex, scrollContent!.clientWidth);
      return {
        left: pageLeft + r.x * zoom,
        top: pageOffset + r.y * zoom,
        width: r.width * zoom,
        height: r.height * zoom,
      };
    } catch {
      return null;
    }
  }

  scrollContent.addEventListener('click', onClick, { capture: true });
  scrollContent.addEventListener('mousemove', onMove);
  scrollContent.addEventListener('mouseleave', onLeave);
  container.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    scrollContent.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
    scrollContent.removeEventListener('mousemove', onMove);
    scrollContent.removeEventListener('mouseleave', onLeave);
    container.removeEventListener('scroll', onScroll);
    if (rafId) cancelAnimationFrame(rafId);
    if (highlightEl) highlightEl.remove();
    highlightEl = null;
    closeFieldPopover();
  };
}

function unionRects(rects: Array<{ pageIndex: number; x: number; y: number; width: number; height: number }>): PageRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { pageIndex: rects[0].pageIndex, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function findLabelForFieldId(fields: FieldMap, fieldId: number): string | null {
  for (const [label, entries] of fields) {
    if (entries.some((e) => e.fieldId === fieldId)) return label;
  }
  return null;
}
