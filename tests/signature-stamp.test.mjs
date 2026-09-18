import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { initSync, HwpDocument } from '@rhwp/core';

// signature-stamp.ts 는 WasmBridge 타입만 import 하므로 그대로 트랜스파일해 쓸 수 있다.
const source = readFileSync(new URL('../src/signature-stamp.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { SignatureStampManager } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

globalThis.measureTextWidth = (_font, text) => text.length * 6;
initSync({ module: readFileSync(new URL('../node_modules/@rhwp/core/rhwp_bg.wasm', import.meta.url)) });
const template = readFileSync(new URL('../public/templates/business-trip.hwp', import.meta.url));

/** WasmBridge 흉내: JSON 문자열을 돌려주는 메서드는 파싱하고, 속성 객체를 받는 메서드는 문자열로 넘긴다. */
const textMethods = new Set(['getTextRange', 'getTextInCell', 'getControlImageMime']);
function bridge(doc) {
  return new Proxy(doc, { get(target, key) {
    if (key === 'refreshLayout') return () => {};
    if (key === 'setPictureProperties') return (sec, para, ci, props) => JSON.parse(target.setPictureProperties(sec, para, ci, JSON.stringify(props)));
    return (...args) => {
      const result = target[key](...args);
      if (typeof result !== 'string' || textMethods.has(key)) return result;
      try { return JSON.parse(result); } catch { return result; }
    };
  } });
}

// 1x1 투명 PNG
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const stored = () => ({ mime: 'image/png', dataUrl: PNG_DATA_URL, widthPx: 300, heightPx: 300, updatedAt: '2026-01-01T00:00:00.000Z' });

test('도장을 여러 번 바꿔도 문단이 늘지 않고 한 페이지를 유지한다', () => {
  const doc = new HwpDocument(template);
  doc.convertToEditable();
  const wasm = bridge(doc);
  const paragraphs = doc.getParagraphCount(0);
  const manager = new SignatureStampManager(wasm);
  for (let i = 0; i < 5; i++) {
    manager.applyStored(stored());
    assert.ok(manager.hasStamp(), `${i + 1}번째 교체 후 도장이 있어야 한다`);
    assert.equal(doc.getParagraphCount(0), paragraphs + 1, `${i + 1}번째 교체 후 문단 수는 그림 문단 하나만 늘어야 한다`);
    assert.equal(JSON.parse(doc.getDocumentInfo()).pageCount, 1, `${i + 1}번째 교체 후에도 한 페이지`);
  }
  assert.ok(manager.rotate(7));
  assert.equal(manager.getRotationDeg(), 7);
  manager.applyStored(stored());
  assert.equal(doc.getParagraphCount(0), paragraphs + 1);
  assert.ok(manager.clear());
  assert.equal(doc.getParagraphCount(0), paragraphs, '삭제 후 원본 문단 수로 돌아와야 한다');
  const restored = new HwpDocument(doc.exportHwp());
  restored.convertToEditable();
  assert.equal(JSON.parse(restored.getDocumentInfo()).pageCount, 1);
  assert.equal(restored.getParagraphCount(0), paragraphs);
  restored.free();
  doc.free();
});
