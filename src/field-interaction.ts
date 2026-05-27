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
import type { DocumentPosition, FieldInfoResult, HitTestResult } from '@/core/types';
import { FIELD_CONFIGS, formatDateTimeRange, formatForLabel, parseDateTimeRange, parseFromHWP } from './field-config';
import { fillDateTimeRange, setFieldValues, type FieldMap } from './field-filler';
import { closeFieldPopover, isPopoverOpen, showDateTimeRangePopover, showFieldPopover } from './field-popover';

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

interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FieldGeometry {
  pageRect: PageRect;
  cellPageRect?: PageRect;
}

interface FieldLocationEntry {
  fieldId: number;
  location: {
    sectionIndex: number;
    paraIndex: number;
    path?: FieldLocationPathEntry[];
  };
}

interface FieldLocationPathEntry {
  paraIndex: number;
  controlIndex: number;
  cellIndex: number;
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
    const anchor = { x: e.clientX, y: e.clientY };

    // 시작·종료 일시는 시작일시 누름틀에 범위로 합쳐 있으므로, 한쪽만 편집하고 다시 합쳐 넣는다.
    if (label === '시작일시' || label === '종료일시') {
      const rangeRaw = getFields().get('시작일시')?.[0]?.value ?? '';
      const { start, end } = parseDateTimeRange(rangeRaw);
      if (isDesktopRangeEditing()) {
        showDateTimeRangePopover({
          startValue: start,
          endValue: end,
          anchor,
          onConfirm: (nextStart, nextEnd) => {
            const newRange = formatDateTimeRange(nextStart, nextEnd);
            if (!newRange) return;
            try {
              fillDateTimeRange(wasm, getFields(), newRange);
            } catch (err) {
              console.error('[field-interaction] 적용 실패:', err);
              return;
            }
            onAfterEdit('시작일시', newRange);
          },
          onCancel: () => undefined,
        });
        return;
      }
      showFieldPopover({
        label,
        initialValue: label === '종료일시' ? end : start,
        anchor,
        onConfirm: (raw) => {
          const newRange = label === '종료일시'
            ? formatDateTimeRange(start, raw)
            : formatDateTimeRange(raw, end);
          if (!newRange) return; // 시작 미입력이면 취소처럼 동작
          try {
            fillDateTimeRange(wasm, getFields(), newRange);
          } catch (err) {
            console.error('[field-interaction] 적용 실패:', err);
            return;
          }
          onAfterEdit(label, newRange);
        },
        onCancel: () => undefined,
      });
      return;
    }

    const entries = getFields().get(label) ?? [];
    const entry = entries.find((en) => en.fieldId === fieldId) ?? entries[0];
    const parsedInitial = parseFromHWP(label, entry?.value ?? '');
    const initial = label === '제출날짜' && !parsedInitial ? todayDateValue() : parsedInitial;
    showFieldPopover({
      label,
      initialValue: initial,
      anchor,
      onConfirm: (raw) => {
        const value = formatForLabel(label, raw);
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
      const geometry = getFieldGeometry(hit);
      const rawContentRect = geometry ? pageRectToContent(geometry.pageRect) : null;
      const cellContentRect = geometry?.cellPageRect ? pageRectToContent(geometry.cellPageRect) : null;
      const c = rawContentRect
        ? refineContentRectFromCanvas(rawContentRect, cellContentRect) ?? rawContentRect
        : null;
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

  function getFieldGeometry(hit: FieldHit): FieldGeometry | null {
    const stable = getStableFieldGeometry(hit.fieldId);
    if (stable) return stable;
    const fallbackRect = getFieldPageRect(hit.pos, hit.fi);
    return fallbackRect ? { pageRect: fallbackRect } : null;
  }

  function getStableFieldGeometry(fieldId: number): FieldGeometry | null {
    let entry: FieldLocationEntry | undefined;
    try {
      entry = wasm.getFieldList().find((field) => field.fieldId === fieldId) as FieldLocationEntry | undefined;
    } catch {
      return null;
    }
    if (!entry) return null;

    const found = findFieldRangeAtLocation(entry);
    if (!found) return null;
    const pageRect = getFieldPageRect(found.pos, found.fi);
    if (!pageRect) return null;
    return {
      pageRect,
      cellPageRect: getFieldCellPageRect(entry) ?? undefined,
    };
  }

  function findFieldRangeAtLocation(entry: FieldLocationEntry): { pos: DocumentPosition; fi: FieldInfoResult } | null {
    const maxScan = 1500;
    for (let offset = 0; offset <= maxScan; offset += 1) {
      const pos = buildFieldLocationPosition(entry, offset);
      let fi: FieldInfoResult;
      try {
        fi = wasm.getFieldInfoAt(pos);
      } catch {
        return null;
      }
      if (fi.inField && fi.fieldId === entry.fieldId && fi.startCharIdx !== undefined && fi.endCharIdx !== undefined) {
        return { pos: buildFieldLocationPosition(entry, fi.startCharIdx), fi };
      }
      if (fi.inField && fi.endCharIdx !== undefined && offset < fi.endCharIdx) {
        offset = fi.endCharIdx;
      }
    }
    return null;
  }

  function buildFieldLocationPosition(entry: FieldLocationEntry, charOffset: number): DocumentPosition {
    const { location } = entry;
    const path = location.path ?? [];
    if (path.length === 0) {
      return {
        sectionIndex: location.sectionIndex,
        paragraphIndex: location.paraIndex,
        charOffset,
      };
    }

    const first = path[0];
    const last = path[path.length - 1];
    const cellPath = path.map((item) => ({
      controlIndex: item.controlIndex,
      cellIndex: item.cellIndex,
      cellParaIndex: item.paraIndex,
    }));

    return {
      sectionIndex: location.sectionIndex,
      paragraphIndex: last.paraIndex,
      charOffset,
      parentParaIndex: location.paraIndex,
      controlIndex: first.controlIndex,
      cellIndex: first.cellIndex,
      cellParaIndex: first.paraIndex,
      cellPath,
    };
  }

  function getFieldCellPageRect(entry: FieldLocationEntry): PageRect | null {
    const path = entry.location.path ?? [];
    if (path.length === 0) return null;
    const targetCellIndex = path[path.length - 1].cellIndex;
    try {
      const bboxes = path.length === 1
        ? wasm.getTableCellBboxes(entry.location.sectionIndex, entry.location.paraIndex, path[0].controlIndex)
        : wasm.getTableCellBboxesByPath(
          entry.location.sectionIndex,
          entry.location.paraIndex,
          JSON.stringify(path.map((item) => ({
            controlIndex: item.controlIndex,
            cellIndex: item.cellIndex,
            cellParaIndex: item.paraIndex,
          }))),
        );
      const bbox = bboxes.find((box) => box.cellIdx === targetCellIndex);
      if (!bbox) return null;
      return {
        pageIndex: bbox.pageIndex,
        x: bbox.x,
        y: bbox.y,
        width: bbox.w,
        height: bbox.h,
      };
    } catch {
      return null;
    }
  }

  /** 누름틀의 페이지 좌표 사각형 (본문/표/중첩 표 모두 처리) */
  function getFieldPageRect(pos: HitTestResult | DocumentPosition, fi: FieldInfoResult): PageRect | null {
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

      if ((pos.cellPath?.length ?? 0) > 1) {
        const byPath = getCursorPairRectByPath(pos, start, end);
        if (byPath) return byPath;
      }

      const rects = getSelectionRectsInCellSafely(pos, start, end);
      if (rects?.length) return unionRects(rects);

      const r1 = wasm.getCursorRectInCell(pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!, pos.cellIndex!, pos.cellParaIndex!, start);
      const r2 = wasm.getCursorRectInCell(pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!, pos.cellIndex!, pos.cellParaIndex!, end);
      return cursorPairToRect(r1, r2) ?? cursorFallbackRect(pos);
    } catch {
      return cursorFallbackRect(pos);
    }
  }

  function getCursorPairRectByPath(pos: HitTestResult, start: number, end: number): PageRect | null {
    try {
      const pathJson = JSON.stringify(pos.cellPath);
      const r1 = wasm.getCursorRectByPath(pos.sectionIndex, pos.parentParaIndex!, pathJson, start);
      const r2 = wasm.getCursorRectByPath(pos.sectionIndex, pos.parentParaIndex!, pathJson, end);
      return cursorPairToRect(r1, r2);
    } catch {
      return null;
    }
  }

  function getSelectionRectsInCellSafely(pos: HitTestResult, start: number, end: number): PageRect[] | null {
    try {
      return wasm.getSelectionRectsInCell(
        pos.sectionIndex,
        pos.parentParaIndex!,
        pos.controlIndex!,
        pos.cellIndex!,
        pos.cellParaIndex!,
        start,
        pos.cellParaIndex!,
        end,
      );
    } catch {
      return null;
    }
  }

  function pageRectToContent(r: PageRect): ContentRect | null {
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

  function refineContentRectFromCanvas(rect: ContentRect, cellRect: ContentRect | null = null): ContentRect | null {
    const redSearchRect = cellRect ?? rect;
    const redBounds = scanCanvasBounds(redSearchRect, isRedTextPixel, false, rect);
    if (redBounds && redBounds.count > 8) return redBounds.rect;

    const narrowRect = rect.width < rect.height * 4;
    const expandX = narrowRect ? Math.max(12, rect.height * 3) : 4;
    const expandY = Math.max(4, rect.height * 0.25);
    return scanCanvasBounds(
      {
        left: rect.left - expandX,
        top: rect.top - expandY,
        width: rect.width + expandX * 2,
        height: rect.height + expandY * 2,
      },
      isDarkTextPixel,
      true,
      rect,
    )?.rect ?? null;
  }

  function scanCanvasBounds(
    searchRect: ContentRect,
    predicate: (r: number, g: number, b: number, a: number) => boolean,
    filterRuleLines = false,
    targetRect: ContentRect | null = null,
  ): { rect: ContentRect; count: number } | null {
    const canvas = findCanvasForContentRect(searchRect);
    if (!canvas) return null;

    const scrollRect = scrollContent!.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasLeft = canvasRect.left - scrollRect.left;
    const canvasTop = canvasRect.top - scrollRect.top;
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;

    const searchLeft = Math.max(canvasLeft, searchRect.left);
    const searchTop = Math.max(canvasTop, searchRect.top);
    const searchRight = Math.min(canvasLeft + canvasRect.width, searchRect.left + searchRect.width);
    const searchBottom = Math.min(canvasTop + canvasRect.height, searchRect.top + searchRect.height);
    const sx = Math.max(0, Math.floor((searchLeft - canvasLeft) * scaleX));
    const sy = Math.max(0, Math.floor((searchTop - canvasTop) * scaleY));
    const sw = Math.min(canvas.width - sx, Math.ceil((searchRight - searchLeft) * scaleX));
    const sh = Math.min(canvas.height - sy, Math.ceil((searchBottom - searchTop) * scaleY));
    if (sw < 3 || sh < 3) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    let image: ImageData;
    try {
      image = ctx.getImageData(sx, sy, sw, sh);
    } catch {
      return null;
    }

    const targetX = targetRect
      ? ((targetRect.left + targetRect.width / 2) - searchLeft) * scaleX
      : undefined;
    const targetY = targetRect
      ? ((targetRect.top + targetRect.height / 2) - searchTop) * scaleY
      : undefined;
    const bounds = scanPixelBounds(image, predicate, filterRuleLines, targetX, targetY);
    if (!bounds || bounds.count <= 8) return null;

    const pad = 3;
    const left = canvasLeft + (sx + bounds.minX) / scaleX - pad;
    const top = canvasTop + (sy + bounds.minY) / scaleY - pad;
    const right = canvasLeft + (sx + bounds.maxX + 1) / scaleX + pad;
    const bottom = canvasTop + (sy + bounds.maxY + 1) / scaleY + pad;
    const width = right - left;
    const height = bottom - top;
    if (width < 4 || height < 4) return null;
    return { rect: { left, top, width, height }, count: bounds.count };
  }

  function findCanvasForContentRect(rect: ContentRect): HTMLCanvasElement | null {
    const scrollRect = scrollContent!.getBoundingClientRect();
    for (const canvas of scrollContent!.querySelectorAll<HTMLCanvasElement>('canvas')) {
      const canvasRect = canvas.getBoundingClientRect();
      const canvasLeft = canvasRect.left - scrollRect.left;
      const canvasTop = canvasRect.top - scrollRect.top;
      if (
        rect.left < canvasLeft + canvasRect.width &&
        rect.left + rect.width > canvasLeft &&
        rect.top < canvasTop + canvasRect.height &&
        rect.top + rect.height > canvasTop
      ) {
        return canvas;
      }
    }
    return null;
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

function isDesktopRangeEditing(): boolean {
  return window.matchMedia('(min-width: 801px)').matches;
}

function todayDateValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function cursorPairToRect(
  r1: { pageIndex: number; x: number; y: number; height: number } | null | undefined,
  r2: { pageIndex: number; x: number; y: number; height: number } | null | undefined,
): PageRect | null {
  if (!r1 || !r2) return null;
  const minWidth = Math.max(20, Math.max(r1.height, r2.height) * 3);
  return {
    pageIndex: r1.pageIndex,
    x: Math.min(r1.x, r2.x),
    y: Math.min(r1.y, r2.y),
    width: Math.max(Math.abs(r2.x - r1.x), minWidth),
    height: Math.max(r1.y + r1.height, r2.y + r2.height) - Math.min(r1.y, r2.y),
  };
}

function cursorFallbackRect(pos: HitTestResult): PageRect | null {
  const r = (pos as HitTestResult & { cursorRect?: { pageIndex: number; x: number; y: number; height: number } }).cursorRect;
  if (!r) return null;
  const width = Math.max(20, r.height * 3);
  return {
    pageIndex: r.pageIndex,
    x: r.x,
    y: r.y,
    width,
    height: r.height,
  };
}

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

function scanPixelBounds(
  image: ImageData,
  predicate: (r: number, g: number, b: number, a: number) => boolean,
  filterRuleLines = false,
  targetX?: number,
  targetY?: number,
): PixelBounds | null {
  const { data, width, height } = image;
  const mask = new Uint8Array(width * height);
  const colCounts = new Uint16Array(width);
  const rowCounts = new Uint16Array(height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      if (!predicate(r, g, b, a)) continue;
      const idx = y * width + x;
      mask[idx] = 1;
      colCounts[x] += 1;
      rowCounts[y] += 1;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  const colLineThreshold = Math.max(8, height * 0.58);
  const rowLineThreshold = Math.max(8, width * 0.58);

  for (let y = 0; y < height; y += 1) {
    if (filterRuleLines && rowCounts[y] > rowLineThreshold) continue;
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      if (filterRuleLines && colCounts[x] > colLineThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  if (count === 0 || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  if (targetX !== undefined && Number.isFinite(targetX)) {
    const segment = findNearestTextSegment(mask, colCounts, rowCounts, width, height, filterRuleLines, targetX);
    if (segment) {
      const segmented = boundsForSegment(
        mask,
        colCounts,
        rowCounts,
        width,
        height,
        filterRuleLines,
        segment.start,
        segment.end,
        targetY,
      );
      if (segmented && segmented.count > 0) return segmented;
    }
  }

  return { minX, minY, maxX, maxY, count };
}

function findNearestTextSegment(
  mask: Uint8Array,
  colCounts: Uint16Array,
  rowCounts: Uint16Array,
  width: number,
  height: number,
  filterRuleLines: boolean,
  targetX: number,
): { start: number; end: number } | null {
  const colLineThreshold = Math.max(8, height * 0.58);
  const rowLineThreshold = Math.max(8, width * 0.58);
  const hasTextInColumn = (x: number): boolean => {
    if (filterRuleLines && colCounts[x] > colLineThreshold) return false;
    for (let y = 0; y < height; y += 1) {
      if (filterRuleLines && rowCounts[y] > rowLineThreshold) continue;
      if (mask[y * width + x]) return true;
    }
    return false;
  };

  const gapLimit = Math.max(4, Math.floor(height * 0.55));
  const segments: Array<{ start: number; end: number }> = [];
  let start = -1;
  let lastText = -1;
  for (let x = 0; x < width; x += 1) {
    if (!hasTextInColumn(x)) continue;
    if (start < 0) {
      start = x;
    } else if (x - lastText > gapLimit) {
      segments.push({ start, end: lastText });
      start = x;
    }
    lastText = x;
  }
  if (start >= 0) segments.push({ start, end: lastText });
  if (segments.length === 0) return null;

  return segments.reduce((best, segment) => {
    const center = (segment.start + segment.end) / 2;
    const bestCenter = (best.start + best.end) / 2;
    const distance = Math.abs(center - targetX);
    const bestDistance = Math.abs(bestCenter - targetX);
    if (targetX >= segment.start && targetX <= segment.end) return segment;
    return distance < bestDistance ? segment : best;
  }, segments[0]);
}

function boundsForSegment(
  mask: Uint8Array,
  colCounts: Uint16Array,
  rowCounts: Uint16Array,
  width: number,
  height: number,
  filterRuleLines: boolean,
  startX: number,
  endX: number,
  targetY?: number,
): PixelBounds | null {
  const ySegment = targetY !== undefined && Number.isFinite(targetY)
    ? findNearestTextRowSegment(mask, colCounts, rowCounts, width, height, filterRuleLines, startX, endX, targetY)
    : null;
  const startY = ySegment?.start ?? 0;
  const endY = ySegment?.end ?? height - 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  const colLineThreshold = Math.max(8, height * 0.58);
  const rowLineThreshold = Math.max(8, width * 0.58);

  for (let y = startY; y <= endY; y += 1) {
    if (filterRuleLines && rowCounts[y] > rowLineThreshold) continue;
    for (let x = startX; x <= endX; x += 1) {
      if (!mask[y * width + x]) continue;
      if (filterRuleLines && colCounts[x] > colLineThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  if (count === 0 || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY, count };
}

function findNearestTextRowSegment(
  mask: Uint8Array,
  colCounts: Uint16Array,
  rowCounts: Uint16Array,
  width: number,
  height: number,
  filterRuleLines: boolean,
  startX: number,
  endX: number,
  targetY: number,
): { start: number; end: number } | null {
  const colLineThreshold = Math.max(8, height * 0.58);
  const rowLineThreshold = Math.max(8, width * 0.58);
  const hasTextInRow = (y: number): boolean => {
    if (filterRuleLines && rowCounts[y] > rowLineThreshold) return false;
    for (let x = startX; x <= endX; x += 1) {
      if (filterRuleLines && colCounts[x] > colLineThreshold) continue;
      if (mask[y * width + x]) return true;
    }
    return false;
  };

  const gapLimit = Math.max(3, Math.floor(height * 0.08));
  const segments: Array<{ start: number; end: number }> = [];
  let start = -1;
  let lastText = -1;
  for (let y = 0; y < height; y += 1) {
    if (!hasTextInRow(y)) continue;
    if (start < 0) {
      start = y;
    } else if (y - lastText > gapLimit) {
      segments.push({ start, end: lastText });
      start = y;
    }
    lastText = y;
  }
  if (start >= 0) segments.push({ start, end: lastText });
  if (segments.length === 0) return null;

  return segments.reduce((best, segment) => {
    const center = (segment.start + segment.end) / 2;
    const bestCenter = (best.start + best.end) / 2;
    const distance = Math.abs(center - targetY);
    const bestDistance = Math.abs(bestCenter - targetY);
    if (targetY >= segment.start && targetY <= segment.end) return segment;
    return distance < bestDistance ? segment : best;
  }, segments[0]);
}

function isRedTextPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 32) return false;
  return r > 130 && r - Math.max(g, b) > 45 && g < 145 && b < 145;
}

function isDarkTextPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 32) return false;
  return r < 120 && g < 120 && b < 120;
}

function findLabelForFieldId(fields: FieldMap, fieldId: number): string | null {
  const matches: string[] = [];
  for (const [label, entries] of fields) {
    if (entries.some((e) => e.fieldId === fieldId)) matches.push(label);
  }
  if (matches.length === 0) return null;

  const exactName = matches.find((label) =>
    FIELD_CONFIGS[label] && fields.get(label)?.some((e) => e.fieldId === fieldId && e.name === label),
  );
  if (exactName) return exactName;

  return matches.find((label) => FIELD_CONFIGS[label]) ?? matches[0] ?? null;
}
