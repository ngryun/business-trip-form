/**
 * 누름틀이 아닌 "일반 표 칸"을 미리보기에서 직접 클릭해 편집하기 위한 좌표 계산.
 *
 * 식비 지급받은 금액 · 총 동승자수 · 동승자 명단(소속/성명) 은 양식에 누름틀이 없어
 * field-interaction 의 누름틀 hit-test 로는 잡히지 않는다. 여기서 표의 셀 bbox 를 구해
 * 클릭 가능한 영역 목록을 만들어 준다. 운임 행 삭제/복원은 "운 임" 제목 칸을 눌러 연다.
 *
 * 좌표계는 field-interaction 과 같은 "페이지 좌표"(줌 적용 전) 이다.
 */

import type { CellBbox } from '@/core/types';
import type { WasmBridge } from '@/core/wasm-bridge';

export interface CellPageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellTextRegion {
  kind: 'text';
  /** 사이드패널 폼 input 의 name — 값의 단일 출처는 계속 폼이다. */
  key: string;
  label: string;
  placeholder?: string;
  rect: CellPageRect;
}

export interface FareMenuRegion {
  kind: 'fare';
  key: 'fare';
  label: string;
  rect: CellPageRect;
}

export type CellRegion = CellTextRegion | FareMenuRegion;

/** 동승자 명단의 소속/성명 열 (표 좌표 기준) */
const PASSENGER_ORG_COL = 6;
const PASSENGER_NAME_COL = 9;
const PASSENGER_ROWS = 4;
/** 식비·총동승자수 값이 들어가는 열 */
const VALUE_COL = 2;

interface TableAnchor {
  sec: number;
  para: number;
  ctrl: number;
}

/** 정산 표의 위치. expense-fields 와 같은 기준(소속 누름틀)을 쓴다. */
function findTableAnchor(wasm: WasmBridge): TableAnchor | null {
  let anchor: ReturnType<WasmBridge['getFieldList']>[number] | undefined;
  try {
    anchor = wasm.getFieldList().find((field) => field.name === '소속');
  } catch {
    return null;
  }
  const path = anchor?.location.path?.[0];
  if (!anchor || !path) return null;
  return { sec: anchor.location.sectionIndex, para: anchor.location.paraIndex, ctrl: path.controlIndex };
}

function toRect(bbox: CellBbox): CellPageRect {
  return { pageIndex: bbox.pageIndex, x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h };
}

/** 미리보기에서 클릭 가능한 일반 셀 목록을 계산한다. 실패하면 빈 배열. */
export function computeCellRegions(wasm: WasmBridge): CellRegion[] {
  const anchor = findTableAnchor(wasm);
  if (!anchor) return [];
  const { sec, para, ctrl } = anchor;

  let bboxes: CellBbox[];
  try {
    bboxes = wasm.getTableCellBboxes(sec, para, ctrl);
  } catch {
    return [];
  }
  if (!bboxes || bboxes.length === 0) return [];

  const cellAt = (row: number, col: number): CellBbox | undefined =>
    bboxes.find((bbox) => bbox.row === row && bbox.col === col);

  // 제목 칸(0열)의 글자로 행 위치를 찾는다 — 운임 행이 삭제되면 행 번호가 밀리기 때문.
  const rowOfLabel = (text: string): number | null => {
    for (const bbox of bboxes) {
      if (bbox.col !== 0) continue;
      let cellText: string;
      try {
        cellText = wasm.getTextInCell(sec, para, ctrl, bbox.cellIdx, 0, 0, 100);
      } catch {
        continue;
      }
      if (cellText.replace(/\s/g, '') === text) return bbox.row;
    }
    return null;
  };

  const regions: CellRegion[] = [];
  const addText = (bbox: CellBbox | undefined, key: string, label: string, placeholder?: string): void => {
    if (!bbox) return;
    regions.push({ kind: 'text', key, label, placeholder, rect: toRect(bbox) });
  };

  const mealRow = rowOfLabel('식비');
  if (mealRow !== null) {
    addText(cellAt(mealRow, VALUE_COL), '식비지급받은금액', '식비 지급받은 금액', '예: 2식, 20,000원, 지급 없음');
  }

  const passengerRow = rowOfLabel('동승자');
  if (passengerRow !== null) {
    addText(cellAt(passengerRow, VALUE_COL), '총동승자수', '총 동승자수 (신청인 포함)', '예: 3명');
    for (let i = 1; i <= PASSENGER_ROWS; i += 1) {
      addText(cellAt(passengerRow + i, PASSENGER_ORG_COL), `동승자${i}소속`, `동승자 ${i} 소속`);
      addText(cellAt(passengerRow + i, PASSENGER_NAME_COL), `동승자${i}성명`, `동승자 ${i} 성명`);
    }
  }

  const fareRow = rowOfLabel('운임');
  const fareCell = fareRow !== null ? cellAt(fareRow, 0) : undefined;
  if (fareCell) {
    regions.push({ kind: 'fare', key: 'fare', label: '운임 행', rect: toRect(fareCell) });
  }

  return regions;
}

// 호버할 때마다 표 전체를 다시 재는 것은 비싸므로 잠시 캐시한다.
// 문서를 다시 그린 뒤에는 main.ts 가 invalidateCellRegions() 로 즉시 무효화한다.
const CACHE_TTL_MS = 1500;
let cache: { regions: CellRegion[]; at: number } | null = null;

export function invalidateCellRegions(): void {
  cache = null;
}

export function getCellRegions(wasm: WasmBridge): CellRegion[] {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.regions;
  const regions = computeCellRegions(wasm);
  cache = { regions, at: now };
  return regions;
}
