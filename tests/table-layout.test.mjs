import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { initSync, HwpDocument } from '@rhwp/core';

const source = readFileSync(new URL('../src/hwp-table-layout-patch.ts', import.meta.url), 'utf8')
  .replace("'pako'", JSON.stringify(import.meta.resolve('pako')))
  .replace("'./hwp-signature-export-patch'", JSON.stringify(new URL('../src/hwp-signature-export-patch.ts', import.meta.url).href));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { repairDeletedTableLayout } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
// 표 외곽 좌표를 검사한다. 글자 폭은 이 테스트의 비교 대상이 아니다.
globalThis.measureTextWidth = (_font, text) => text.length * 6;
initSync({ module: readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url)) });
const template = readFileSync(new URL('../public/templates/business-trip.hwp', import.meta.url));
function load(bytes) { const doc = new HwpDocument(bytes); doc.convertToEditable(); return doc; }
for (const rows of [[6], [7], [7, 6]]) {
  test(`운임 ${rows}행 삭제 후 반복 저장에도 원본 가로 위치·너비 유지`, () => {
    let doc = load(template);
    const initial = JSON.parse(doc.getTableBBox(0, 6, 0));
    for (const row of rows) {
      const before = doc.exportHwp();
      assert.equal(JSON.parse(doc.deleteTableRow(0, 6, 0, row)).ok, true);
      const exported = doc.exportHwp();
      const broken = load(exported);
      assert.notEqual(JSON.parse(broken.getTableBBox(0, 6, 0)).x, initial.x);
      broken.free();
      const repaired = repairDeletedTableLayout(before, exported, 0, 6, 0);
      doc.free();
      doc = load(repaired);
    }
    for (let i = 0; i < 3; i++) {
      const box = JSON.parse(doc.getTableBBox(0, 6, 0));
      assert.equal(box.x, initial.x);
      assert.equal(box.width, initial.width);
      assert.equal(box.y, initial.y);
      assert.ok(box.height < initial.height);
      assert.equal(JSON.parse(doc.getTableDimensions(0, 6, 0)).rowCount, 16 - rows.length);
      assert.equal(JSON.parse(doc.getParaPropertiesAt(0, 6)).alignment, 'center');
      const bytes = doc.exportHwp(); doc.free(); doc = load(bytes);
    }
    doc.free();
  });
}
