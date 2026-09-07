import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initSync, HwpDocument } from '@rhwp/core';
import { applyExpenseFields, removeFareRows } from '../src/expense-fields.ts';

initSync({ module: readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url)) });
const template = readFileSync(new URL('../public/templates/business-trip.hwp', import.meta.url));
const jsonMethods = new Set(['getFieldList', 'getTableDimensions', 'getCellInfo', 'deleteTableRow']);
function bridge(doc) {
  return new Proxy(doc, { get(target, key) {
    return (...args) => {
      const result = target[key](...args);
      return jsonMethods.has(key) ? JSON.parse(result) : result;
    };
  } });
}
function text(doc) {
  const count = JSON.parse(doc.getTableDimensions(0, 6, 0)).cellCount;
  return Array.from({ length: count }, (_, i) => doc.getTextInCell(0, 6, 0, i, 0, 0, 1000));
}
for (const deleted of [[], ['갈때'], ['올때'], ['갈때', '올때']]) {
  test(`식비·동승자 편집 및 운임 삭제 HWP 왕복: ${deleted.join(',') || '기본'}`, () => {
    const doc = new HwpDocument(template);
    doc.convertToEditable();
    const wasm = bridge(doc);
    const values = { 식비지급받은금액: '2식', 총동승자수: '3명', 동승자1소속: '설악고', 동승자1성명: '홍길동', 동승자4성명: '김철수' };
    for (const dir of deleted) values[`${dir}운임삭제`] = '1';
    removeFareRows(wasm, values);
    applyExpenseFields(wasm, values);
    assert.ok(text(doc).includes('2식'));
    applyExpenseFields(wasm, { ...values, 식비지급받은금액: '지급 없음' });
    const restored = new HwpDocument(doc.exportHwp());
    restored.convertToEditable();
    assert.equal(JSON.parse(restored.getTableDimensions(0, 6, 0)).rowCount, 16 - deleted.length);
    for (const value of ['지급 없음', '3명', '설악고', '홍길동', '김철수']) assert.ok(text(restored).includes(value), value);
    const fields = JSON.parse(restored.getFieldList());
    for (const dir of ['갈때', '올때']) assert.equal(fields.some((field) => field.name === `${dir}일자`), !deleted.includes(dir));
    applyExpenseFields(bridge(restored), {});
    for (const value of ['지급 없음', '3명', '설악고', '홍길동', '김철수']) assert.ok(!text(restored).includes(value));
    restored.free();
    doc.free();
  });
}
