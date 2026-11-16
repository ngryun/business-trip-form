import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { initSync, HwpDocument } from '@rhwp/core';
import { applyExpenseFields, clearFareRows, expenseCellsWritable } from '../src/expense-fields.ts';

initSync({ module: readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url)) });
const template = readFileSync(new URL('../public/templates/business-trip.hwp', import.meta.url));
const jsonMethods = new Set(['getFieldList', 'getTableDimensions', 'getCellInfo', 'setFieldValue', 'getClickHereProps', 'updateClickHereProps']);
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
/** 운임표 「등 급」 열(8열)의 갈 때(6행)·올 때(7행) 칸 글자 */
function gradeCells(doc) {
  const count = JSON.parse(doc.getTableDimensions(0, 6, 0)).cellCount;
  const out = {};
  for (let i = 0; i < count; i++) {
    const info = JSON.parse(doc.getCellInfo(0, 6, 0, i));
    if (info.col === 8 && (info.row === 6 || info.row === 7)) out[info.row === 6 ? '갈때' : '올때'] = doc.getTextInCell(0, 6, 0, i, 0, 0, 1000);
  }
  return out;
}
for (const deleted of [[], ['갈때'], ['올때'], ['갈때', '올때']]) {
  test(`식비·동승자 편집 및 운임 삭제 HWP 왕복: ${deleted.join(',') || '기본'}`, () => {
    const doc = new HwpDocument(template);
    doc.convertToEditable();
    const wasm = bridge(doc);
    const values = { 식비지급받은금액: '2식', 총동승자수: '3명', 동승자1소속: '설악고', 동승자1성명: '홍길동', 동승자4성명: '김철수', 등급: '제2호' };
    for (const dir of deleted) values[`${dir}운임삭제`] = '1';
    clearFareRows(wasm, values);
    applyExpenseFields(wasm, values);
    assert.ok(text(doc).includes('2식'));
    // 등급은 갈 때·올 때 행의 「등 급」 칸에 함께 들어가고, 삭제한 행은 비어 있다.
    assert.deepEqual(gradeCells(doc), { 갈때: deleted.includes('갈때') ? '' : '제2호', 올때: deleted.includes('올때') ? '' : '제2호' });
    applyExpenseFields(wasm, { ...values, 식비지급받은금액: '지급 없음', 등급: '제1호' });
    const restored = new HwpDocument(doc.exportHwp());
    restored.convertToEditable();
    // 운임 "행 삭제"는 표의 행을 지우지 않는다 — 행 수는 항상 그대로.
    assert.equal(JSON.parse(restored.getTableDimensions(0, 6, 0)).rowCount, 16);
    for (const value of ['지급 없음', '3명', '설악고', '홍길동', '김철수']) assert.ok(text(restored).includes(value), value);
    assert.deepEqual(gradeCells(restored), { 갈때: deleted.includes('갈때') ? '' : '제1호', 올때: deleted.includes('올때') ? '' : '제1호' });
    const fields = JSON.parse(restored.getFieldList());
    for (const dir of ['갈때', '올때']) {
      for (const suffix of ['일자', '교통편', '출발지', '도착지']) {
        const field = fields.find((entry) => entry.name === `${dir}${suffix}`);
        assert.ok(field, `${dir}${suffix} 누름틀은 남아 있어야 한다`);
        const props = JSON.parse(restored.getClickHereProps(field.fieldId));
        if (deleted.includes(dir)) {
          assert.equal(field.value ?? '', '', `${dir}${suffix} 값은 비어야 한다`);
          assert.equal(props.guide ?? '', '', `${dir}${suffix} 안내문구는 비어야 한다`);
        } else {
          assert.ok(props.guide, `${dir}${suffix} 안내문구는 유지되어야 한다`);
        }
      }
    }
    applyExpenseFields(bridge(restored), {});
    for (const value of ['지급 없음', '3명', '설악고', '홍길동', '김철수', '제1호']) assert.ok(!text(restored).includes(value));
    restored.free();
    doc.free();
  });
}

test('올린 양식의 일반 칸: 내장 양식 구조면 쓸 수 있고, 칸에 글자가 있거나 표를 못 찾으면 쓰지 않는다', () => {
  // 원본의 총 동승자수 칸에는 "-명" 자리표시가 있다 — 그것까지는 빈 칸으로 본다.
  assert.equal(expenseCellsWritable(bridge(new HwpDocument(template))), true);
  const taebaek = readFileSync(new URL('../public/templates/business-trip-taebaek.hwp', import.meta.url));
  assert.equal(expenseCellsWritable(bridge(new HwpDocument(taebaek))), true);

  // 동승자 소속 자리에 이미 글자가 있는 양식(= 구조가 다른 양식)은 건드리지 않는다.
  const filled = new HwpDocument(template);
  applyExpenseFields(bridge(filled), { 동승자1소속: '이미 있는 글자' });
  assert.equal(expenseCellsWritable(bridge(filled)), false);

  // 소속 누름틀이 든 표가 없으면 쓸 곳을 알 수 없다.
  const noAnchor = bridge(new HwpDocument(template));
  assert.equal(expenseCellsWritable(new Proxy(noAnchor, { get: (target, key) => (key === 'getFieldList' ? () => [] : target[key]) })), false);
});
