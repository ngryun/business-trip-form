import type { WasmBridge } from '@/core/wasm-bridge';

/** 기존 양식의 일반 셀도 사이드패널에서 편집한다. 행 삭제 후에는 좌표를 다시 찾는다. */
export function applyExpenseFields(wasm: WasmBridge, values: Record<string, string>): void {
  const anchor = wasm.getFieldList().find((field) => field.name === '소속');
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
  const write = (row: number, col: number, value: string): void => {
    const cell = cells.find((entry) => entry.row === row && entry.col === col);
    if (!cell) throw new Error('정산 입력 칸을 찾지 못했습니다.');
    const length = wasm.getCellParagraphLength(sec, para, ctrl, cell.index, 0);
    const current = wasm.getTextInCell(sec, para, ctrl, cell.index, 0, 0, length);
    if (current === value) return;
    if (length) wasm.deleteTextInCell(sec, para, ctrl, cell.index, 0, 0, length);
    if (value) wasm.insertTextInCell(sec, para, ctrl, cell.index, 0, 0, value);
  };
  const meal = cells.find((cell) => cell.text === '식비');
  const passengers = cells.find((cell) => cell.text === '동승자');
  if (!meal || !passengers) throw new Error('식비 또는 동승자 항목을 찾지 못했습니다.');
  write(meal.row, 2, values.식비지급받은금액 ?? '');
  write(passengers.row, 2, values.총동승자수 ?? '');
  for (let i = 1; i <= 4; i++) {
    write(passengers.row + i, 6, values[`동승자${i}소속`] ?? '');
    write(passengers.row + i, 9, values[`동승자${i}성명`] ?? '');
  }
}

export function removeFareRows(wasm: WasmBridge, values: Record<string, string>): void {
  // 뒤에서부터 삭제하여 앞 행의 좌표를 유지한다. 병합된 운임 제목은 엔진이 조정한다.
  for (const direction of ['올때', '갈때']) {
    if (values[`${direction}운임삭제`] !== '1') continue;
    const field = wasm.getFieldList().find((entry) => entry.name === `${direction}일자`);
    const path = field?.location.path?.[0];
    if (!field || !path) continue;
    const { sectionIndex: sec, paraIndex: para } = field.location;
    const { row } = wasm.getCellInfo(sec, para, path.controlIndex, path.cellIndex);
    if (!wasm.deleteTableRow(sec, para, path.controlIndex, row).ok) {
      throw new Error('운임 행을 삭제하지 못했습니다.');
    }
  }
}
