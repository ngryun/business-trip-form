import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { normalizeDateTimeLocalStep } from '../src/field-config.ts';

const source = readFileSync(new URL('../src/datetime-picker.ts', import.meta.url), 'utf8')
  .replace("'./field-config'", JSON.stringify(new URL('../src/field-config.ts', import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { setupDateTimePicker } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

class Element extends EventTarget {
  children = [];
  value = '';
  classList = { add() {} };
  append(...children) { this.children.push(...children); }
  querySelector(selector) {
    const type = selector.match(/type="(.*?)"/)[1];
    return this.children.find(child => child.type === type)
      ?? this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null;
  }
}
function fire(input, type, key) {
  const event = new Event(type);
  if (key) Object.defineProperty(event, 'key', { value: key });
  input.dispatchEvent(event);
}
function picker(value = '2026-09-13T09:00') {
  globalThis.document = { createElement: () => new Element(), activeElement: null };
  const root = new Element();
  const hidden = new Element();
  hidden.type = 'hidden';
  hidden.value = value;
  root.append(hidden);
  const changes = [];
  setupDateTimePicker(root, { onChange: value => changes.push(value) });
  return { date: root.querySelector('input[type="date"]'), time: root.querySelector('input[type="time"]'), hidden, changes };
}

test('연도를 연속 입력하는 동안 값을 다시 쓰거나 종료일 변경을 알리지 않는다', () => {
  const { date, hidden, changes } = picker();
  document.activeElement = date;
  for (const year of ['0002', '0020', '0202', '2027']) {
    fire(date, 'keydown', year.at(-1));
    date.value = `${year}-09-13`;
    fire(date, 'change');
    assert.equal(date.value, `${year}-09-13`);
    assert.equal(hidden.value, '2026-09-13T09:00');
    assert.equal(changes.length, 0);
  }
  document.activeElement = null;
  fire(date, 'blur');
  assert.deepEqual(changes, ['2027-09-13T09:00']);
});

test('시간 보정은 입력 후 Enter로 확정하며 blur에서 중복 반영하지 않는다', () => {
  const { time, changes } = picker();
  document.activeElement = time;
  fire(time, 'keydown', '7');
  time.value = '13:27';
  fire(time, 'change');
  assert.equal(time.value, '13:27');
  fire(time, 'keydown', 'Enter');
  assert.equal(time.value, '13:30');
  fire(time, 'blur');
  assert.deepEqual(changes, ['2026-09-13T13:30']);
});

test('달력 선택은 즉시 기본 시간과 함께 반영한다', () => {
  const { date, hidden, changes } = picker('');
  document.activeElement = date;
  date.value = '2026-09-15';
  fire(date, 'change');
  assert.equal(hidden.value, '2026-09-15T09:00');
  assert.deepEqual(changes, ['2026-09-15T09:00']);
});

test('100년 미만 연도에 1900년을 더하지 않고 자정 보정을 유지한다', () => {
  assert.equal(normalizeDateTimeLocalStep('0020-09-13T09:00'), '0020-09-13T09:00');
  assert.equal(normalizeDateTimeLocalStep('2026-12-31T23:57'), '2027-01-01T00:00');
});
