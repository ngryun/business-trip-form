/**
 * 첨부서류 칸.
 *
 * 공문서 붙임 표기처럼 문서는 한 줄에 하나씩 쓰고, 마지막 줄 끝에 두 칸 띄워 `끝.` 을 붙인다.
 *
 *   첨부: 주유영수증 1부
 *         하이패스영수증 1부  끝.
 *
 * 폼에는 문서만 한 줄에 하나씩 두고 `끝.` 은 양식에 넣을 때 붙인다 (attachmentLines).
 * 양식에는 첫 줄을 첨부서류 누름틀에 넣고, 나머지 줄은 누름틀 문단 뒤에 문단을 나눠 넣는다
 * (applyAttachmentLines). 누름틀 값 안의 줄바꿈 문자는 한 줄로 그려지기 때문이다 (trip-name.ts 와 같은 이유).
 */
import type { TripNameCellBridge } from './trip-name';

/** 첨부서류에 자주 쓰는 항목 — 입력창 위 토글 버튼으로 노출 */
export const ATTACHMENT_PRESETS = ['주유영수증 1부', '하이패스영수증 1부', '전기차충전영수증 1부', '출장신청서 1부'];

/** 마지막 문서 뒤에 붙이는 맺음 — 두 칸 띄우고 `끝.` */
const END_MARK = '  끝.';

/**
 * 입력값 → 문서 목록. 줄바꿈이나 쉼표로 나눈다 (예전처럼 쉼표로 이어 쓴 값도 줄로 나뉜다).
 * 금액의 천 단위 쉼표(3,500)는 나누지 않고, 직접 적은 맨 끝 `끝.` 은 뺀다 (두 번 붙지 않게).
 */
export function parseAttachmentItems(value: string): string[] {
  const items = (value ?? '').split(/\r?\n|,(?!\d)/).map((s) => s.trim()).filter(Boolean);
  if (items.length > 0) {
    const last = items.pop()!.replace(/(?:^|\s)끝\.?$/, '').trim();
    if (last) items.push(last);
  }
  return items;
}

/** 양식에 넣을 줄 — 문서마다 한 줄, 마지막 줄 끝에 `  끝.`. 문서가 없으면 빈 배열. */
export function attachmentLines(value: string): string[] {
  const items = parseAttachmentItems(value);
  if (items.length > 0) items[items.length - 1] += END_MARK;
  return items;
}

/** 목록에서 항목을 토글한다 — 있으면 빼고, 없으면 끝에 줄을 더한다. 결과는 한 줄에 하나. */
export function toggleAttachmentItem(value: string, item: string): string {
  const items = parseAttachmentItems(value);
  const idx = items.indexOf(item);
  if (idx >= 0) items.splice(idx, 1);
  else items.push(item);
  return items.join('\n');
}

/** 목록에 항목이 들어 있는지 */
export function hasAttachmentItem(value: string, item: string): boolean {
  return parseAttachmentItems(value).includes(item);
}

/** 누름틀 앞 글자(`첨부: `)만큼의 공백 — 한글 같은 전각 글자는 공백 두 칸 너비로 친다. */
export function attachmentIndent(prefix: string): string {
  let width = 0;
  for (const ch of prefix) width += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return ' '.repeat(width);
}

/** applyAttachmentLines 이 쓰는 WASM 브리지의 일부 — 누름틀 값으로 누름틀 앞 글자를 가려낸다. */
export interface AttachmentCellBridge extends Omit<TripNameCellBridge, 'getFieldList'> {
  getFieldList(): Array<{
    fieldId: number;
    value?: string;
    location: {
      sectionIndex: number;
      paraIndex: number;
      path?: Array<{ paraIndex: number; controlIndex: number; cellIndex: number }>;
    };
  }>;
}

/**
 * 첨부서류 누름틀 아래에 둘째 줄부터를 넣거나 지운다. lines 는 attachmentLines 결과 그대로이고,
 * 첫 줄은 호출자가 누름틀에 이미 넣었다고 본다.
 *
 * 누름틀 문단 바로 뒤에서 이 도구가 넣었던 줄(누름틀 앞 글자만큼 들여 쓴 줄)을 먼저 지운 다음,
 * 남은 줄을 같은 들여쓰기로 한 문단씩 나눠 넣는다. 양식의 빈 문단·제출날짜·신청인 문단은 건드리지 않는다.
 *
 * @returns 첨부서류 누름틀을 찾아 처리했으면 true, 찾지 못했으면 false
 */
export function applyAttachmentLines(wasm: AttachmentCellBridge, fieldId: number | undefined, lines: string[]): boolean {
  if (fieldId === undefined) return false;
  const field = wasm.getFieldList().find((f) => f.fieldId === fieldId);
  const loc = field?.location;
  const cell = loc?.path?.[0];
  if (!field || !loc || !cell || loc.path?.length !== 1) return false; // 단일 깊이 표 셀만 다룬다
  const sec = loc.sectionIndex;
  const parentPara = loc.paraIndex;
  const { controlIndex: ctrl, cellIndex: idx, paraIndex: fieldPara } = cell;
  const textAt = (p: number): string => {
    const len = wasm.getCellParagraphLength(sec, parentPara, ctrl, idx, p);
    return len > 0 ? wasm.getTextInCell(sec, parentPara, ctrl, idx, p, 0, len) : '';
  };

  // 누름틀 문단은 `첨부: <누름틀>` — 누름틀 값 앞까지가 들여쓰기 기준이다.
  const fieldText = textAt(fieldPara);
  const valueAt = fieldText.lastIndexOf(field.value ?? '');
  const indent = attachmentIndent(valueAt >= 0 ? fieldText.slice(0, valueAt) : fieldText);
  const isOurLine = (text: string): boolean => text.length > indent.length && text.startsWith(indent) && text[indent.length] !== ' ';

  // 1) 누름틀 문단 바로 뒤에 이어진, 이 도구가 넣은 줄을 지운다 (뒤에서부터 지우고 앞 문단에 합친다).
  const count = wasm.getCellParagraphCount(sec, parentPara, ctrl, idx);
  let last = fieldPara;
  while (last + 1 < count && isOurLine(textAt(last + 1))) last += 1;
  for (let p = last; p > fieldPara; p--) {
    const len = wasm.getCellParagraphLength(sec, parentPara, ctrl, idx, p);
    if (len > 0) wasm.deleteTextInCell(sec, parentPara, ctrl, idx, p, 0, len);
    wasm.mergeParagraphInCell(sec, parentPara, ctrl, idx, p);
  }

  // 2) 둘째 줄부터 앞 문단 끝에서 나눠 한 줄씩 넣는다.
  for (let k = 1; k < lines.length; k++) {
    const prev = fieldPara + k - 1;
    wasm.splitParagraphInCell(sec, parentPara, ctrl, idx, prev, wasm.getCellParagraphLength(sec, parentPara, ctrl, idx, prev));
    wasm.insertTextInCell(sec, parentPara, ctrl, idx, prev + 1, 0, indent + lines[k]);
  }
  return true;
}
