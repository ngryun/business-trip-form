/**
 * 출장명을 양식에 넣는 방법.
 *
 * - 태백 양식: 출장명 누름틀이 따로 있으므로 출장명을 그 누름틀에 넣는다 (main.ts collectFormValues).
 * - 기본 양식: 출장명 칸이 없으므로 출장지 셀에서 누름틀 다음 문단으로 `[출장명 : …]` 줄을 넣는다
 *   (applyTripNameLine). 누름틀 값 안에 줄바꿈 문자를 넣으면 한글 엔진이 한 줄로 그리기 때문에
 *   실제 문단을 나눈다. NEIS 확장 프로그램이 출장목적을 출장명 키로 넘겨준다.
 */

/** 기본 양식의 출장지 아래 줄에 넣을 문구. 출장명이 비어 있으면 빈 문자열. */
export function tripNameLine(tripName: string): string {
  const name = (tripName ?? '').trim();
  return name ? `[출장명 : ${name}]` : '';
}

/** 셀 문단이 이 도구가 넣은 출장명 줄(또는 빈 줄)인지 — 양식 원래 문단을 지우지 않기 위한 판별. */
export function isTripNameLine(text: string): boolean {
  return /^\s*(\[출장명\s*:.*\]\s*)?$/.test(text ?? '');
}

/** applyTripNameLine 이 쓰는 WASM 브리지의 일부 — 테스트에서 가짜 객체로 대체하기 쉽도록 좁혀 둔다. */
export interface TripNameCellBridge {
  getFieldList(): Array<{
    fieldId: number;
    location: {
      sectionIndex: number;
      paraIndex: number;
      path?: Array<{ paraIndex: number; controlIndex: number; cellIndex: number }>;
    };
  }>;
  getCellParagraphCount(sec: number, parentPara: number, ctrl: number, cell: number): number;
  getCellParagraphLength(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number): number;
  getTextInCell(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number, offset: number, count: number): string;
  deleteTextInCell(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number, offset: number, count: number): unknown;
  mergeParagraphInCell(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number): unknown;
  splitParagraphInCell(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number, offset: number): unknown;
  insertTextInCell(sec: number, parentPara: number, ctrl: number, cell: number, cellPara: number, offset: number, text: string): unknown;
}

/**
 * 기본 양식의 출장지 셀에 `[출장명 : …]` 줄을 넣거나 지운다.
 *
 * 출장지 누름틀이 있는 문단은 그대로 두고, 그 뒤에 이 도구가 넣었던 문단(출장명 줄·빈 줄)을 먼저
 * 모두 지운 다음, 출장명이 있으면 누름틀 문단 끝에서 문단을 나눠 새 문단에 문구를 넣는다.
 * 누름틀 값은 장소만 유지되므로 이후 setFieldValues 로 출장지를 다시 채워도 줄이 깨지지 않는다.
 *
 * @returns 출장지 누름틀을 찾아 처리했으면 true, 찾지 못했으면 false
 */
export function applyTripNameLine(wasm: TripNameCellBridge, placeFieldId: number | undefined, tripName: string): boolean {
  if (placeFieldId === undefined) return false;
  const loc = wasm.getFieldList().find((f) => f.fieldId === placeFieldId)?.location;
  const cell = loc?.path?.[0];
  if (!loc || !cell || loc.path?.length !== 1) return false; // 단일 깊이 표 셀만 다룬다
  const sec = loc.sectionIndex;
  const parentPara = loc.paraIndex;
  const { controlIndex: ctrl, cellIndex: idx, paraIndex: fieldPara } = cell;

  // 1) 누름틀 문단 뒤에 이 도구가 넣은 문단을 제거한다 (양식 원래 문단은 건드리지 않음).
  let count = wasm.getCellParagraphCount(sec, parentPara, ctrl, idx);
  for (let p = count - 1; p > fieldPara; p--) {
    const len = wasm.getCellParagraphLength(sec, parentPara, ctrl, idx, p);
    const text = len > 0 ? wasm.getTextInCell(sec, parentPara, ctrl, idx, p, 0, len) : '';
    if (!isTripNameLine(text)) break;
    if (len > 0) wasm.deleteTextInCell(sec, parentPara, ctrl, idx, p, 0, len);
    wasm.mergeParagraphInCell(sec, parentPara, ctrl, idx, p);
    const next = wasm.getCellParagraphCount(sec, parentPara, ctrl, idx);
    if (next >= count) break; // 진전이 없으면 중단
    count = next;
  }

  // 2) 출장명이 있으면 누름틀 문단 끝에서 나눠 새 문단에 넣는다.
  const line = tripNameLine(tripName);
  if (!line) return true;
  const end = wasm.getCellParagraphLength(sec, parentPara, ctrl, idx, fieldPara);
  wasm.splitParagraphInCell(sec, parentPara, ctrl, idx, fieldPara, end);
  wasm.insertTextInCell(sec, parentPara, ctrl, idx, fieldPara + 1, 0, line);
  return true;
}
