import type { WasmBridge } from '@/core/wasm-bridge';

interface ExpenseTarget {
  cellIndex: number;
  value: string;
  /** 운임표 등급·금액 칸 — 가운데 정렬로 맞춘다 */
  center?: boolean;
  /** 총 동승자수 칸 — 양식 원본에 "-명" 같은 단위 자리표시가 들어 있다 */
  unit?: boolean;
}

interface ExpenseTable {
  sec: number;
  para: number;
  ctrl: number;
  targets: ExpenseTarget[];
}

/**
 * 누름틀이 없는 일반 칸(식비·동승자·운임 등급·금액)의 위치와 넣을 값을 찾는다.
 * 표는 소속 누름틀이 든 표, 행은 제목 칸의 글자(식비·동승자·운임)로 찾는다. 행 삭제 후에는 좌표를 다시 찾는다.
 */
function locateExpenseTargets(wasm: WasmBridge, values: Record<string, string>): ExpenseTable {
  const fields = wasm.getFieldList();
  const anchor = fields.find((field) => field.name === '소속');
  const path = anchor?.location.path?.[0];
  if (!anchor || !path) throw new Error('정산 표를 찾지 못했습니다.');
  const sec = anchor.location.sectionIndex;
  const para = anchor.location.paraIndex;
  const ctrl = path.controlIndex;
  const cells = Array.from({ length: wasm.getTableDimensions(sec, para, ctrl).cellCount }, (_, index) => ({
    index,
    ...wasm.getCellInfo(sec, para, ctrl, index),
    text: wasm.getTextInCell(sec, para, ctrl, index, 0, 0, 1000).replace(/\s/g, ''),
  }));
  const targets: ExpenseTarget[] = [];
  const add = (row: number, col: number, value: string, unit = false): void => {
    const cell = cells.find((entry) => entry.row === row && entry.col === col);
    if (!cell) throw new Error('정산 입력 칸을 찾지 못했습니다.');
    targets.push({ cellIndex: cell.index, value, unit });
  };
  // 식비 줄은 양식에 따라 없다 (태백교육지원청 양식은 그 자리에 친지 숙박내역 줄이 있다).
  const meal = cells.find((cell) => cell.text === '식비');
  const passengers = cells.find((cell) => cell.text === '동승자');
  if (!passengers) throw new Error('동승자 항목을 찾지 못했습니다.');
  if (meal) add(meal.row, 2, values.식비지급받은금액 ?? '');
  add(passengers.row, 2, values.총동승자수 ?? '', true);
  for (let i = 1; i <= 4; i++) {
    add(passengers.row + i, 6, values[`동승자${i}소속`] ?? '');
    add(passengers.row + i, 9, values[`동승자${i}성명`] ?? '');
  }
  // 운임표 「등 급」·「금 액」 열 — 등급은 갈 때·올 때 행에 같은 값을, 금액은 방향별 값을 넣고, "행 삭제"된 방향은 비운다.
  // 행은 그 방향의 일자 누름틀이 든 칸으로 찾고, 없으면 제목 행 바로 아래 두 행으로 본다.
  const fareTitle = cells.find((cell) => cell.text === '운임');
  if (fareTitle) {
    const headerCol = (text: string): number | undefined =>
      cells.find((cell) => cell.row === fareTitle.row && cell.text === text)?.col;
    const fareColumns = [
      { col: headerCol('등급'), value: (): string => values.등급 ?? '' },
      { col: headerCol('금액'), value: (direction: string): string => values[`${direction}금액`] ?? '' },
    ];
    (['갈때', '올때'] as const).forEach((direction, offset) => {
      const cellIndex: unknown = fields.find((field) => field.name === `${direction}일자`)?.location.path?.[0]?.cellIndex;
      const row = (typeof cellIndex === 'number' ? cells[cellIndex]?.row : undefined) ?? fareTitle.row + 1 + offset;
      const deleted = values[`${direction}운임삭제`] === '1';
      for (const { col, value } of fareColumns) {
        const cell = col === undefined ? undefined : cells.find((entry) => entry.row === row && entry.col === col);
        // 양식은 두 행의 문단 정렬이 달라(윗행 가운데, 아랫행 왼쪽) 같은 값이 들쭉날쭉 보인다 — 둘 다 가운데로 맞춘다.
        if (cell) targets.push({ cellIndex: cell.index, value: deleted ? '' : value(direction), center: true });
      }
    });
  }
  return { sec, para, ctrl, targets };
}

/** 기존 양식의 일반 셀도 사이드패널에서 편집한다. */
export function applyExpenseFields(wasm: WasmBridge, values: Record<string, string>): void {
  const { sec, para, ctrl, targets } = locateExpenseTargets(wasm, values);
  for (const target of targets) {
    const length = wasm.getCellParagraphLength(sec, para, ctrl, target.cellIndex, 0);
    const current = wasm.getTextInCell(sec, para, ctrl, target.cellIndex, 0, 0, length);
    if (current !== target.value) {
      if (length) wasm.deleteTextInCell(sec, para, ctrl, target.cellIndex, 0, 0, length);
      if (target.value) wasm.insertTextInCell(sec, para, ctrl, target.cellIndex, 0, 0, target.value);
    }
    if (target.center) wasm.applyParaFormatInCell(sec, para, ctrl, target.cellIndex, 0, JSON.stringify({ alignment: 'center' }));
  }
}

/**
 * 올린 양식(막 불러온 원본 상태)의 일반 칸에 값을 써도 되는지.
 *
 * 일반 칸은 기본 양식의 표 구조(동승자 줄 아래 4줄의 7·10번째 열 …)를 그대로 따라가 찾으므로, 구조가 다른 양식에서는
 * 엉뚱한 칸의 글자를 지울 수 있다. 값을 넣을 칸이 모두 비어 있을 때만(총 동승자수 칸은 "-명" 같은 단위 자리표시까지)
 * 같은 구조로 보고, 아니면 일반 칸은 건드리지 않는다.
 */
export function expenseCellsWritable(wasm: WasmBridge): boolean {
  try {
    const { sec, para, ctrl, targets } = locateExpenseTargets(wasm, {});
    return targets.every((target) => {
      const text = wasm.getTextInCell(sec, para, ctrl, target.cellIndex, 0, 0, 1000).replace(/[\s\-–—_]/g, '');
      return text === '' || (target.unit === true && text === '명');
    });
  } catch {
    return false;
  }
}

/** 운임 행 삭제 시 비우는 누름틀 이름 접미사. */
export const FARE_FIELD_SUFFIXES = ['일자', '교통편', '출발지', '도착지'] as const;

/**
 * "행 삭제"된 운임 행의 내용을 비운다 — 표의 행 자체는 그대로 두고, 그 행의 누름틀 값과
 * 안내문구(빨간 placeholder)만 지워 빈 칸으로 보이게 한다. name 은 유지해 재탐색·복원이 가능하다.
 */
export function clearFareRows(wasm: WasmBridge, values: Record<string, string>): void {
  for (const direction of ['갈때', '올때']) {
    if (values[`${direction}운임삭제`] !== '1') continue;
    for (const suffix of FARE_FIELD_SUFFIXES) {
      const name = `${direction}${suffix}`;
      for (const field of wasm.getFieldList()) {
        if (field.name !== name) continue;
        if ((field.value ?? '') !== '') wasm.setFieldValue(field.fieldId, '');
        const props = wasm.getClickHereProps(field.fieldId);
        if (!props.ok || !props.guide) continue;
        wasm.updateClickHereProps(field.fieldId, '', props.memo ?? '', props.name || name, props.editable ?? true);
      }
    }
  }
}
