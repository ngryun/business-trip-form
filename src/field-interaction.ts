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
import type { CellRegion } from './cell-fields';
import { FIELD_CONFIGS, formatDateTimeRange, formatForLabel, parseDateTimeRange, parseFromHWP } from './field-config';
import { fillDateTimeRange, setFieldValues, type FieldMap } from './field-filler';
import {
  closeFieldPopover,
  isPopoverOpen,
  showDateTimeRangePopover,
  showFareRowPopover,
  showFieldPopover,
  type FareDirection,
} from './field-popover';
import { getRecentValues, pushRecentValue } from './recent-values';

/** 라벨별로 "최근 입력" 자동완성을 노출할 가치가 있는 항목만 추적한다 (반복 입력이 잦은 텍스트류). */
const RECENT_TRACKED_LABELS = new Set([
  '소속', '직급', '성명', '이름',
  '출장지',
  '갈때출발지', '갈때도착지', '올때출발지', '올때도착지',
  '첨부서류',
]);

export interface InlineEditDeps {
  wasm: WasmBridge;
  canvasView: CanvasView;
  /** scroll-container 요소 (이벤트를 붙일 대상) */
  container: HTMLElement;
  /** 현재 누름틀 매핑을 반환 (편집 후 재스캔된 최신 값) */
  getFields: () => FieldMap;
  /** 편집 적용 직후 호출 — 미리보기 갱신·필드 재스캔·폼 동기화 등 */
  onAfterEdit: (label: string, value: string) => void;
  /**
   * 누름틀이 아닌 일반 표 칸(식비·동승자) 과 운임 행 삭제/복원.
   * 값의 단일 출처는 사이드패널 폼이라, 여기서는 폼 값을 읽고 쓰는 콜백만 받는다.
   */
  cells?: {
    /** 현재 클릭 가능한 셀 영역 목록 (페이지 좌표) */
    getRegions: () => CellRegion[];
    /** 셀에 대응하는 폼 입력값 */
    getValue: (key: string) => string;
    /** 셀 값 반영 — 빈 문자열이면 칸을 비운다 */
    commit: (key: string, value: string) => void;
    /** 운임 행의 현재 삭제 상태 */
    getFareDeleted: () => Record<FareDirection, boolean>;
    /** 운임 행 삭제/복원 토글 */
    toggleFare: (direction: FareDirection) => void;
  };
  /** (인)/도장 영역 상호작용 — 제공되면 미리보기에서 클릭으로 도장 메뉴를 연다 */
  stamp?: {
    /** 페이지 좌표 기준 클릭 영역 ((인) 표식 ∪ 현재 도장). 없으면 null */
    getRect: () => PageRect | null;
    /** 영역 클릭 시 호출 — 도장 메뉴 팝오버를 띄운다 */
    onOpen: (anchor: { x: number; y: number }) => void;
  };
}

interface FieldHit {
  fieldId: number;
  label: string;
  pos: HitTestResult | DocumentPosition;
  fi: FieldInfoResult;
}

/** attachInlineEditing 반환값 — 정리 + 편집 가능 영역 마커 제어 */
export interface InlineEditHandle {
  /** 이벤트/오버레이 정리 */
  dispose: () => void;
  /** 문서를 다시 그린 뒤 마커 좌표를 다시 계산 */
  refreshHints: () => void;
  setHintsVisible: (visible: boolean) => void;
  isHintsVisible: () => boolean;
}

interface PageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 하이라이트 재계산 여부만 가리는 합성 id — 실제 fieldId 와 겹치지 않도록 음수를 쓴다. */
const STAMP_HIGHLIGHT_ID = -999;
const CELL_HIGHLIGHT_BASE_ID = -1000;

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
  name?: string;
  guide?: string;
  value?: string;
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

export function attachInlineEditing(deps: InlineEditDeps): InlineEditHandle {
  const { wasm, canvasView, container, getFields, onAfterEdit, stamp, cells } = deps;
  const scrollContent = container.querySelector<HTMLElement>('#scroll-content');
  if (!scrollContent) {
    return {
      dispose: () => undefined,
      refreshHints: () => undefined,
      setHintsVisible: () => undefined,
      isHintsVisible: () => false,
    };
  }

  // mousemove 는 자주 발생하므로 rAF 로 throttle
  let pendingMove: MouseEvent | null = null;
  let rafId = 0;

  // 호버 하이라이트 오버레이
  let highlightEl: HTMLDivElement | null = null;
  let hlFieldId: number | null = null;

  // 편집 가능 영역 안내 마커 (항상 보이는 오버레이 — "여기를 누르면 고칠 수 있다" 표시)
  let hintLayerEl: HTMLDivElement | null = null;
  let hintsVisible = true;
  let hintTimer = 0;

  const onClick = (e: MouseEvent): void => {
    if (isPopoverOpen()) return;
    const anchor = { x: e.clientX, y: e.clientY };
    const spot = resolveSpotAt(e);

    if (spot?.kind === 'field') {
      const point = toPagePoint(e);
      const hit = buildHitForTarget(spot.target, point?.pageX ?? spot.target.fieldRect.x);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        hideHighlight();
        openPopoverFor(hit, anchor);
        return;
      }
    } else if (spot?.kind === 'cell') {
      e.preventDefault();
      e.stopPropagation();
      hideHighlight();
      openCellPopoverFor(spot.region, anchor);
      return;
    } else if (spot?.kind === 'stamp' && stamp) {
      e.preventDefault();
      e.stopPropagation();
      hideHighlight();
      stamp.onOpen(anchor);
      return;
    }

    // 좌표 계산에 실패한 누름틀은 기존 hit-test 로 (마커가 없는 자리도 종전처럼 눌린다)
    const hit = resolveFieldAt(e);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      hideHighlight();
      openPopoverFor(hit, anchor);
    }
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
      const spot = resolveSpotAt(ev);
      if (spot) {
        scrollContent.style.cursor = 'pointer';
        showRectHighlight(spot.rect, spot.hlId);
        return;
      }
      const hit = resolveFieldAt(ev);
      if (hit) {
        scrollContent.style.cursor = 'pointer';
        showHighlight(hit);
        return;
      }
      scrollContent.style.cursor = '';
      hideHighlight();
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

  /** 마우스 이벤트 → (페이지 인덱스, 페이지 좌표). 페이지 밖이면 null */
  function toPagePoint(e: MouseEvent): { pageIdx: number; pageX: number; pageY: number } | null {
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
    return {
      pageIdx,
      pageX: (contentX - pageLeft) / zoom,
      pageY: (contentY - pageOffset) / zoom,
    };
  }

  // (인)/도장 영역은 wasm 텍스트 스캔이 필요해서 mousemove 마다 새로 구하지 않고 잠시 캐시한다.
  let stampRectCache: { rect: PageRect | null; at: number } | null = null;
  function getStampRect(): PageRect | null {
    if (!stamp) return null;
    const now = Date.now();
    if (stampRectCache && now - stampRectCache.at < 800) return stampRectCache.rect;
    let rect: PageRect | null = null;
    try { rect = stamp.getRect(); } catch { /* noop */ }
    stampRectCache = { rect, at: now };
    return rect;
  }

  /** 마우스가 (인)/도장 영역 위에 있으면 그 페이지 사각형을 반환 */
  function resolveStampAt(e: MouseEvent): PageRect | null {
    if (!stamp) return null;
    const rect = getStampRect();
    if (!rect) return null;
    const point = toPagePoint(e);
    if (!point || point.pageIdx !== rect.pageIndex) return null;
    // 터치 기기는 손가락 기준 ~14 CSS px 여유를 준다. pad 는 페이지 좌표라 현재 줌으로 환산
    // — 모바일 폭 맞춤 줌(~0.5)에서는 페이지 좌표 기준 여유가 두 배쯤 필요하다.
    const padCss = window.matchMedia('(pointer: coarse)').matches ? 14 : 6;
    const zoom = canvasView.getViewportManager().getZoom() || 1;
    const pad = padCss / zoom;
    if (point.pageX < rect.x - pad || point.pageX > rect.x + rect.width + pad) return null;
    if (point.pageY < rect.y - pad || point.pageY > rect.y + rect.height + pad) return null;
    return rect;
  }

  /** 마우스가 편집 가능한 일반 셀(식비·동승자·운임 제목) 위에 있으면 그 영역을 반환 */
  function resolveCellAt(e: MouseEvent): { region: CellRegion; index: number } | null {
    if (!cells) return null;
    let regions: CellRegion[];
    try {
      regions = cells.getRegions();
    } catch {
      return null;
    }
    if (regions.length === 0) return null;
    const point = toPagePoint(e);
    if (!point) return null;
    // 칸 안쪽만 잡는다 — 표 선 위에서는 인접 칸끼리 하이라이트가 튀지 않도록 여유를 두지 않는다.
    for (let index = 0; index < regions.length; index += 1) {
      const { rect } = regions[index];
      if (point.pageIdx !== rect.pageIndex) continue;
      if (point.pageX < rect.x || point.pageX > rect.x + rect.width) continue;
      if (point.pageY < rect.y || point.pageY > rect.y + rect.height) continue;
      return { region: regions[index], index };
    }
    return null;
  }

  function openCellPopoverFor(region: CellRegion, anchor: { x: number; y: number }): void {
    if (!cells) return;
    if (region.kind === 'fare') {
      showFareRowPopover({
        anchor,
        deleted: cells.getFareDeleted(),
        onToggle: (direction) => cells.toggleFare(direction),
      });
      return;
    }
    showFieldPopover({
      label: region.label,
      config: { type: 'text' },
      placeholder: region.placeholder,
      initialValue: cells.getValue(region.key),
      anchor,
      onConfirm: (raw) => cells.commit(region.key, raw.trim()),
      onCancel: () => undefined,
    });
  }

  /** 마우스 이벤트 → 누름틀 정보 (FIELD_CONFIGS 에 등록된 라벨만) */
  function resolveFieldAt(e: MouseEvent): FieldHit | null {
    const point = toPagePoint(e);
    if (!point) return null;
    const { pageIdx, pageX, pageY } = point;

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

  function openPopoverFor(hit: FieldHit, anchor: { x: number; y: number }): void {
    const { fieldId, label } = hit;

    // 시작·종료 일시는 시작일시 누름틀에 범위로 합쳐 있으므로, 한쪽만 편집하고 다시 합쳐 넣는다.
    if (label === '시작일시' || label === '종료일시') {
      const rangeRaw = getFields().get('시작일시')?.[0]?.value ?? '';
      const { start, end } = parseDateTimeRange(rangeRaw);
      const commitRange = (nextStart: string, nextEnd: string): string | null => {
        const newRange = formatDateTimeRange(nextStart, nextEnd);
        if (!newRange) return null;
        try {
          fillDateTimeRange(wasm, getFields(), newRange);
        } catch (err) {
          console.error('[field-interaction] 적용 실패:', err);
          return null;
        }
        onAfterEdit('시작일시', newRange);
        return newRange;
      };
      // 시작/종료를 탭으로 오가는 하나의 팝오버 — 누름틀의 종료 쪽(오른쪽)을 클릭했으면 종료 탭으로 연다
      showDateTimeRangePopover({
        startValue: start,
        endValue: end,
        initialTab: label === '종료일시' ? 'end' : 'start',
        anchor,
        onConfirm: (nextStart, nextEnd) => { commitRange(nextStart, nextEnd); },
        onNext: (nextStart, nextEnd) => {
          commitRange(nextStart, nextEnd);
          openNextEmptyField(fieldId);
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
      recentValues: RECENT_TRACKED_LABELS.has(label) ? getRecentValues(label) : undefined,
      onConfirm: (raw) => {
        commitSingleField(label, raw);
      },
      onNext: (raw) => {
        commitSingleField(label, raw);
        openNextEmptyField(fieldId);
      },
      onCancel: () => undefined,
    });
  }

  function commitSingleField(label: string, raw: string): boolean {
    const value = formatForLabel(label, raw);
    if (!value) return false; // 빈 값이면 취소처럼 동작
    try {
      // setFieldValues 가 forceBlackOnFields + clearGuide 까지 처리한다
      setFieldValues(wasm, getFields(), { [label]: value });
    } catch (err) {
      console.error('[field-interaction] 적용 실패:', err);
      return false;
    }
    // 칩 자동완성용 최근 입력 — 원시 폼값(raw) 을 저장해 다음 팝오버에서 그대로 채울 수 있게 한다.
    if (RECENT_TRACKED_LABELS.has(label)) pushRecentValue(label, raw);
    onAfterEdit(label, value);
    return true;
  }

  function openNextEmptyField(fromFieldId: number): void {
    requestAnimationFrame(() => {
      const next = findNextEmptyField(fromFieldId);
      if (!next) return;
      openFieldNearCurrentView(next);
    });
  }

  function findNextEmptyField(fromFieldId: number): FieldHit | null {
    const items = getOrderedEditableFieldEntries();
    if (items.length === 0) return null;
    const currentIndex = items.findIndex((item) => item.entry.fieldId === fromFieldId);
    const ordered = currentIndex >= 0
      ? [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex)]
      : items;

    for (const item of ordered) {
      if (item.entry.fieldId === fromFieldId) continue;
      if (!isFieldEmpty(item.label, item.entry)) continue;
      const hit = buildFieldHit(item.entry, item.label);
      if (hit) return hit;
    }
    return null;
  }

  function getOrderedEditableFieldEntries(): Array<{ entry: FieldLocationEntry; label: string }> {
    const fields = getFields();
    let list: FieldLocationEntry[];
    try {
      list = wasm.getFieldList() as FieldLocationEntry[];
    } catch {
      return [];
    }

    const seen = new Set<number>();
    const items: Array<{ entry: FieldLocationEntry; label: string }> = [];
    for (const entry of list) {
      if (seen.has(entry.fieldId)) continue;
      seen.add(entry.fieldId);
      const label = findLabelForFieldId(fields, entry.fieldId);
      if (!label || !FIELD_CONFIGS[label]) continue;
      items.push({ entry, label });
    }
    return items;
  }

  function isFieldEmpty(label: string, entry: FieldLocationEntry): boolean {
    const fields = getFields();
    if (label === '시작일시' || label === '종료일시') {
      const rangeRaw = fields.get('시작일시')?.[0]?.value ?? '';
      const { start, end } = parseDateTimeRange(rangeRaw);
      return label === '시작일시' ? !start : !end;
    }

    const latest = fields.get(label)?.find((candidate) => candidate.fieldId === entry.fieldId);
    return !(latest?.value ?? entry.value ?? '').trim();
  }

  function buildFieldHit(entry: FieldLocationEntry, label: string): FieldHit | null {
    const found = findFieldRangeAtLocation(entry);
    if (!found) return null;
    return {
      fieldId: entry.fieldId,
      label,
      pos: found.pos,
      fi: found.fi,
    };
  }

  function openFieldNearCurrentView(hit: FieldHit): void {
    const geometry = getFieldGeometry(hit);
    const contentRect = geometry ? pageRectToContent(geometry.pageRect) : null;
    if (!contentRect) return;

    const targetTop = Math.max(0, contentRect.top - container.clientHeight * 0.35);
    container.scrollTop = targetTop;

    requestAnimationFrame(() => {
      const anchor = getClientAnchorForField(hit);
      if (!anchor) return;
      hideHighlight();
      openPopoverFor(hit, anchor);
    });
  }

  function getClientAnchorForField(hit: FieldHit): { x: number; y: number } | null {
    const geometry = getFieldGeometry(hit);
    const contentRect = geometry ? pageRectToContent(geometry.pageRect) : null;
    if (!contentRect) return null;

    const scrollRect = scrollContent!.getBoundingClientRect();
    return {
      x: scrollRect.left + contentRect.left + contentRect.width / 2,
      y: scrollRect.top + contentRect.top + contentRect.height / 2,
    };
  }

  function resolvePairedDateTimeLabel(
    label: string,
    pos: HitTestResult | DocumentPosition,
    fi: FieldInfoResult,
    pageX: number,
  ): string {
    // 시작일시 누름틀 하나가 범위 전체를 담으므로, 오른쪽(종료 쪽)을 클릭하면 종료 탭으로 연다.
    if (label !== '시작일시') return label;

    const rect = getFieldPageRect(pos, fi);
    if (!rect || rect.width <= 0) return label;

    return pageX >= rect.x + rect.width * 0.62 ? '종료일시' : label;
  }

  // ---- 편집 가능 영역 (누름틀 + 그 누름틀이 든 표 칸) ----

  /**
   * 편집 가능한 누름틀과 그 누름틀이 들어 있는 표 칸.
   *
   * 빈 누름틀은 폭이 글자 한 칸도 안 되어 "정확히 눌러야 열리는" 상태였다.
   * 칸 사각형을 함께 들고 있으면 (1) 칸 어디를 눌러도 열 수 있고,
   * (2) 그 칸에 안내 마커를 그려 클릭할 수 있는 자리를 눈에 보이게 만들 수 있다.
   */
  interface EditableFieldTarget {
    entry: FieldLocationEntry;
    label: string;
    fieldRect: PageRect;
    cellRect: PageRect | null;
    /** 실제로 눌러서 열 수 있는 영역 (칸 전체 또는 누름틀 주변 띠) */
    clickRect: PageRect;
    /** 값이 채워져 있는지 — 마커 강조 단계를 나눈다 */
    filled: boolean;
  }

  /**
   * 칸을 그대로 클릭 영역으로 쓸지 판단하는 기준 (페이지 좌표).
   * 표의 입력 칸은 두 줄 남짓이라 여기까지는 칸째로 잡고, 본문 문단이 여러 줄 들어간
   * 큰 칸(첨부·제출날짜·신청인이 함께 있는 아래쪽 칸)은 누름틀 주변만 잡는다.
   */
  const CELL_AS_CLICK_AREA_MAX_HEIGHT = 64;
  const CELL_AS_CLICK_AREA_MAX_RATIO = 3.5;

  function cellRectKey(rect: PageRect): string {
    return `${rect.pageIndex}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
  }

  /** 누름틀 주위로 넉넉히 잡은 클릭 영역 (칸 밖으로는 넘지 않는다) */
  function fieldClickBand(fieldRect: PageRect, cellRect: PageRect | null): PageRect {
    const padX = Math.max(16, fieldRect.height * 1.5);
    const padY = Math.max(3, fieldRect.height * 0.3);
    let x = fieldRect.x - padX;
    let y = fieldRect.y - padY;
    let right = fieldRect.x + fieldRect.width + padX;
    let bottom = fieldRect.y + fieldRect.height + padY;
    if (cellRect) {
      x = Math.max(x, cellRect.x);
      y = Math.max(y, cellRect.y);
      right = Math.min(right, cellRect.x + cellRect.width);
      bottom = Math.min(bottom, cellRect.y + cellRect.height);
    }
    return {
      pageIndex: fieldRect.pageIndex,
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  }

  /**
   * 좌표 계산은 누름틀 하나마다 wasm 을 여러 번 왕복해서 전체로는 수십 ms 가 든다.
   * 문서를 다시 그릴 때(scheduleHintRefresh) 캐시를 정확히 버리므로 TTL 은 보험일 뿐이다.
   */
  const FIELD_TARGET_TTL_MS = 4000;
  let fieldTargetCache: { targets: EditableFieldTarget[]; at: number } | null = null;

  function getFieldTargets(): EditableFieldTarget[] {
    const now = Date.now();
    if (fieldTargetCache && now - fieldTargetCache.at < FIELD_TARGET_TTL_MS) return fieldTargetCache.targets;
    const found: Array<Omit<EditableFieldTarget, 'clickRect'>> = [];
    for (const { entry, label } of getOrderedEditableFieldEntries()) {
      const range = findFieldRangeAtLocation(entry);
      if (!range) continue;
      const fieldRect = getFieldPageRect(range.pos, range.fi);
      if (!fieldRect) continue;
      found.push({
        entry,
        label,
        fieldRect,
        cellRect: getFieldCellPageRect(entry),
        filled: !isFieldEmpty(label, entry),
      });
    }

    // 한 칸에 누름틀이 하나뿐이고 그 칸이 한 줄짜리면 칸 전체를 클릭 영역으로 쓴다.
    // 본문 문단이 여러 줄 들어간 큰 칸(첨부·제출날짜·신청인이 같이 있는 아래쪽 칸)은
    // 칸째로 잡으면 무엇을 누르는지 알 수 없으므로 누름틀 주변만 잡는다.
    const perCell = new Map<string, number>();
    for (const item of found) {
      if (!item.cellRect) continue;
      const key = cellRectKey(item.cellRect);
      perCell.set(key, (perCell.get(key) ?? 0) + 1);
    }

    const targets: EditableFieldTarget[] = found.map((item) => {
      const { cellRect, fieldRect } = item;
      const alone = cellRect ? perCell.get(cellRectKey(cellRect)) === 1 : false;
      const compact = cellRect
        ? cellRect.height <= Math.max(fieldRect.height * CELL_AS_CLICK_AREA_MAX_RATIO, CELL_AS_CLICK_AREA_MAX_HEIGHT)
        : false;
      const clickRect = cellRect && alone && compact ? cellRect : fieldClickBand(fieldRect, cellRect);
      return { ...item, clickRect };
    });

    fieldTargetCache = { targets, at: now };
    return targets;
  }

  /** 클릭 영역(칸 전체 또는 누름틀 주변 띠) 안에 있는 누름틀 — 없으면 null */
  function fieldTargetAt(point: { pageIdx: number; pageX: number; pageY: number }): EditableFieldTarget | null {
    let best: { target: EditableFieldTarget; dist: number } | null = null;
    for (const target of getFieldTargets()) {
      const rect = target.clickRect;
      if (point.pageIdx !== rect.pageIndex) continue;
      if (point.pageX < rect.x || point.pageX > rect.x + rect.width) continue;
      if (point.pageY < rect.y || point.pageY > rect.y + rect.height) continue;
      // 한 칸에 누름틀이 여럿이면 클릭 지점에서 가까운 쪽을 고른다
      const cx = target.fieldRect.x + target.fieldRect.width / 2;
      const cy = target.fieldRect.y + target.fieldRect.height / 2;
      const dist = Math.hypot(point.pageX - cx, point.pageY - cy);
      if (!best || dist < best.dist) best = { target, dist };
    }
    return best?.target ?? null;
  }

  /** 누름틀 좌표 → 실제 편집에 필요한 FieldHit (클릭 시점에만 계산) */
  function buildHitForTarget(target: EditableFieldTarget, pageX: number): FieldHit | null {
    const hit = buildFieldHit(target.entry, target.label);
    if (!hit) return null;
    return { ...hit, label: resolvePairedDateTimeLabel(hit.label, hit.pos, hit.fi, pageX) };
  }

  /**
   * 마우스 아래에 있는 편집 대상 — 표시한 클릭 영역(안내 마커) 기준.
   *
   * 영역이 겹칠 때는 더 작은 쪽이 이긴다. 예를 들어 「신청인 성명」 띠 안에 (인) 표식이
   * 들어앉는데, 좁은 (인) 을 눌렀으면 도장 메뉴가 열려야 자연스럽다.
   */
  type Spot =
    | { kind: 'field'; target: EditableFieldTarget; rect: PageRect; hlId: number }
    | { kind: 'cell'; region: CellRegion; rect: PageRect; hlId: number }
    | { kind: 'stamp'; rect: PageRect; hlId: number };

  function resolveSpotAt(e: MouseEvent): Spot | null {
    const point = toPagePoint(e);
    if (!point) return null;

    const spots: Spot[] = [];
    const fieldTarget = fieldTargetAt(point);
    if (fieldTarget) {
      spots.push({
        kind: 'field',
        target: fieldTarget,
        rect: fieldTarget.clickRect,
        hlId: fieldTarget.entry.fieldId,
      });
    }
    const cellHit = resolveCellAt(e);
    if (cellHit) {
      spots.push({
        kind: 'cell',
        region: cellHit.region,
        rect: cellHit.region.rect,
        hlId: CELL_HIGHLIGHT_BASE_ID - cellHit.index,
      });
    }
    const stampRect = stamp ? resolveStampAt(e) : null;
    if (stampRect) {
      spots.push({ kind: 'stamp', rect: stampRect, hlId: STAMP_HIGHLIGHT_ID });
    }
    if (spots.length === 0) return null;

    spots.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    return spots[0];
  }

  /** 호버 하이라이트를 클릭 영역과 같은 사각형으로 맞추기 위한 조회 */
  function findClickRectForField(fieldId: number): PageRect | null {
    for (const target of getFieldTargets()) {
      if (target.entry.fieldId === fieldId) return target.clickRect;
    }
    return null;
  }

  // ---- 편집 가능 영역 안내 마커 ----

  type HintKind = 'input' | 'menu';

  interface HintBox {
    rect: ContentRect;
    kind: HintKind;
    filled: boolean;
  }

  function ensureHintLayer(): HTMLDivElement {
    if (!hintLayerEl) {
      hintLayerEl = document.createElement('div');
      hintLayerEl.className = 'edit-hint-layer';
      hintLayerEl.setAttribute('aria-hidden', 'true');
    }
    // loadDocument() 가 scroll-content 자식을 갈아끼우면 분리되므로 재부착
    if (hintLayerEl.parentElement !== scrollContent) {
      scrollContent!.appendChild(hintLayerEl);
    }
    return hintLayerEl;
  }

  function collectHintBoxes(): HintBox[] {
    const boxes: HintBox[] = [];
    const seen = new Set<string>();

    const push = (pageRect: PageRect | null, kind: HintKind, filled: boolean, pad = 0): void => {
      if (!pageRect) return;
      const c = pageRectToContent(pageRect);
      if (!c || c.width <= 2 || c.height <= 2) return;
      const rect: ContentRect = pad
        ? { left: c.left - pad, top: c.top - pad, width: c.width + pad * 2, height: c.height + pad * 2 }
        : c;
      const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (seen.has(key)) return;
      seen.add(key);
      boxes.push({ rect, kind, filled });
    };

    for (const target of getFieldTargets()) {
      push(target.clickRect, 'input', target.filled);
    }

    if (cells) {
      let regions: CellRegion[] = [];
      try {
        regions = cells.getRegions();
      } catch {
        regions = [];
      }
      for (const region of regions) {
        if (region.kind === 'fare') {
          push(region.rect, 'menu', true);
          continue;
        }
        let value = '';
        try {
          value = cells.getValue(region.key);
        } catch {
          value = '';
        }
        push(region.rect, 'input', value.trim().length > 0);
      }
    }

    push(getStampRect(), 'menu', true);
    return boxes;
  }

  function renderHints(): void {
    const layer = ensureHintLayer();
    if (!hintsVisible) {
      layer.replaceChildren();
      layer.hidden = true;
      return;
    }

    const boxes = collectHintBoxes();
    const frag = document.createDocumentFragment();
    for (const box of boxes) {
      const el = document.createElement('div');
      el.className = `edit-hint edit-hint--${box.kind}${box.filled ? '' : ' is-empty'}`;
      el.style.left = `${box.rect.left}px`;
      el.style.top = `${box.rect.top}px`;
      el.style.width = `${box.rect.width}px`;
      el.style.height = `${box.rect.height}px`;
      frag.appendChild(el);
    }
    layer.replaceChildren(frag);
    layer.hidden = boxes.length === 0;
  }

  /**
   * 문서를 다시 그린 직후엔 캔버스가 여러 번 갈아끼워지므로 살짝 모아서 갱신한다.
   * 좌표 재계산이 수십 ms 걸리므로 한가한 틈(requestIdleCallback)에 미룬다 —
   * 마커는 급할 게 없고, 그 사이 입력·렌더가 끊기지 않는 편이 낫다.
   */
  function scheduleHintRefresh(delay = 150): void {
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      const run = (): void => {
        fieldTargetCache = null;
        stampRectCache = null;
        renderHints();
      };
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (idle) idle(run, { timeout: 600 });
      else run();
    }, delay);
  }

  // 캔버스 교체(문서 재렌더) 감지 — 마커 레이어 자체 변경은 무시해 되돌이를 막는다
  const hintMutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      const touched = [...record.addedNodes, ...record.removedNodes];
      if (touched.some((node) => node !== hintLayerEl)) {
        // loadDocument() 가 scroll-content 자식을 비우면 레이어도 떨어져 나간다.
        // 좌표를 다시 재는 건 뒤로 미루더라도, 지금 있는 마커는 바로 다시 붙여 깜빡임을 막는다.
        if (hintsVisible) ensureHintLayer();
        scheduleHintRefresh();
        return;
      }
    }
  });
  hintMutationObserver.observe(scrollContent, { childList: true });

  // 줌·창 크기 변경은 scroll-content 크기 변화로 잡는다
  const hintResizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => scheduleHintRefresh(120))
    : null;
  hintResizeObserver?.observe(scrollContent);

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
    // 하이라이트는 실제 클릭 영역(= 안내 마커)과 같은 사각형으로 맞춘다
    const clickRect = findClickRectForField(hit.fieldId);
    if (clickRect) {
      showRectHighlight(clickRect, hit.fieldId);
      return;
    }
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

  /** 필드가 아닌 임의 페이지 사각형((인)/도장 영역, 일반 셀)에 호버 하이라이트를 표시 */
  function showRectHighlight(rect: PageRect, highlightId: number = STAMP_HIGHLIGHT_ID): void {
    const el = ensureHighlightEl();
    if (hlFieldId !== highlightId) {
      const c = pageRectToContent(rect);
      if (!c || c.width <= 0 || c.height <= 0) {
        hideHighlight();
        return;
      }
      const pad = 2;
      el.style.left = `${c.left - pad}px`;
      el.style.top = `${c.top - pad}px`;
      el.style.width = `${c.width + pad * 2}px`;
      el.style.height = `${c.height + pad * 2}px`;
      hlFieldId = highlightId;
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

  // 첫 렌더가 끝난 뒤 마커를 올린다 (이후에는 옵저버가 알아서 갱신)
  scheduleHintRefresh(300);

  return {
    dispose: () => {
      scrollContent.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
      scrollContent.removeEventListener('mousemove', onMove);
      scrollContent.removeEventListener('mouseleave', onLeave);
      container.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      window.clearTimeout(hintTimer);
      hintMutationObserver.disconnect();
      hintResizeObserver?.disconnect();
      if (highlightEl) highlightEl.remove();
      highlightEl = null;
      if (hintLayerEl) hintLayerEl.remove();
      hintLayerEl = null;
      closeFieldPopover();
    },
    refreshHints: () => scheduleHintRefresh(120),
    setHintsVisible: (visible: boolean) => {
      hintsVisible = visible;
      renderHints();
    },
    isHintsVisible: () => hintsVisible,
  };
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
