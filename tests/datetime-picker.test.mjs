import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { normalizeDateTimeLocalStep } from '../src/field-config.ts';

// 확장자 없는 상대 import 를 data: URL 로 바꿔 가며 TS 모듈을 재귀적으로 불러온다.
const loaded = new Map();
async function load(fileUrl) {
  if (loaded.has(fileUrl)) return loaded.get(fileUrl);
  let source = readFileSync(new URL(fileUrl), 'utf8');
  for (const [, specifier] of source.matchAll(/from '(\.\/[\w-]+)'/g)) {
    const dependency = await load(new URL(`${specifier}.ts`, fileUrl).href);
    source = source.replaceAll(`from '${specifier}'`, `from ${JSON.stringify(dependency)}`);
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  loaded.set(fileUrl, dataUrl);
  return dataUrl;
}
const { setupDateTimePicker } = await import(await load(new URL('../src/datetime-picker.ts', import.meta.url).href));
const { createDateInput } = await import(await load(new URL('../src/date-input.ts', import.meta.url).href));
const { createTimeInput } = await import(await load(new URL('../src/time-input.ts', import.meta.url).href));

/** 테스트용 최소 DOM — 자식 트리, 클래스, 속성, 간단한 선택자만 흉내 낸다. 이벤트는 버블링하지 않는다. */
class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.children = [];
    this.value = '';
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      toggle: (name, force) => (force ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  select() { this.selected = true; }
  focus() { document.activeElement = this; fire(this, 'focus'); }
  click() { fire(this, 'click'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  matches(selector) {
    const match = selector.trim().match(/^([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
    if (!match) throw new Error(`지원하지 않는 선택자: ${selector}`);
    const [, tag, classes, attributes] = match;
    if (tag && this.tagName !== tag) return false;
    if (classes.split('.').filter(Boolean).some(name => !this.classes.has(name))) return false;
    for (const attribute of attributes.match(/\[[^\]]+\]/g) ?? []) {
      const [, name, expected] = attribute.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      const actual = name === 'type' ? this.type : this.getAttribute(name);
      if (expected === undefined ? actual == null : actual !== expected) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return selector.split(',').flatMap(part => this.children.flatMap(child => [
      ...(child.matches(part) ? [child] : []),
      ...child.querySelectorAll(part),
    ]));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
function fire(target, type, init = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function resetDocument() {
  globalThis.document = {
    createElement: (tagName) => new Element(tagName),
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    documentElement: { clientWidth: 1280 },
  };
}
function typeInto(input, value) {
  input.value = value;
  fire(input, 'input');
}
function picker(value = '2026-09-13T09:00') {
  resetDocument();
  const root = new Element('div');
  const hidden = new Element('input');
  hidden.type = 'hidden';
  hidden.value = value;
  root.append(hidden);
  const changes = [];
  setupDateTimePicker(root, { onChange: value => changes.push(value) });
  const date = root.querySelector('.date-input');
  const time = root.querySelector('.time-input');
  return {
    root, hidden, changes, date, time,
    dateParts: date.querySelectorAll('.date-input__part'),
    timeParts: time.querySelectorAll('.time-input__part'),
    calendarButton: date.querySelector('.date-input__button'),
    calendar: date.querySelector('.date-input__panel'),
    clockButton: time.querySelector('.time-input__button'),
    timePanel: time.querySelector('.time-input__panel'),
  };
}
const currentYear = String(new Date().getFullYear());
const today = new Date();
const ymd = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const todayValue = ymd(today);

test('연도 네 자리와 월 두 자리 입력 시 다음 칸을 자동 선택한다', () => {
  resetDocument();
  const date = createDateInput();
  const [year, month, day] = date.root.querySelectorAll('.date-input__part');
  year.focus();
  for (const value of ['2', '20', '202']) {
    typeInto(year, value);
    assert.equal(document.activeElement, year);
  }
  typeInto(year, '2026');
  assert.equal(document.activeElement, month);
  assert.equal(month.selected, true);
  typeInto(month, '09');
  assert.equal(document.activeElement, day);
  typeInto(day, '13');
  assert.equal(date.getValue(), '2026-09-13');
  date.setValue('2026-02-30');
  assert.equal(date.getValue(), '');
});

test('연도를 비우고 월·일만 적으면 올해로 보고, 연도 칸 안내문은 올해다', () => {
  resetDocument();
  const date = createDateInput();
  const [year, month, day] = date.root.querySelectorAll('.date-input__part');
  assert.equal(year.placeholder, currentYear);
  typeInto(month, '10');
  typeInto(day, '5');
  assert.equal(date.getValue(), `${currentYear}-10-05`);
  typeInto(year, '20');
  assert.equal(date.getValue(), '', '연도를 적는 중간에는 값이 없다');
});

test('달력은 늘 오늘이 있는 달을 먼저 펼치고, 다른 달의 날짜를 골라 두었으면 그 달로 가는 버튼을 보여 준다', () => {
  resetDocument();
  const date = createDateInput();
  const button = date.root.querySelector('.date-input__button');
  const panel = date.root.querySelector('.date-input__panel');
  const sources = [];
  date.root.addEventListener('change', event => sources.push(event.detail?.source));
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.querySelector('.datetime-calendar__month').textContent, `${Number(currentYear)}년 ${today.getMonth() + 1}월`);
  const todayCell = panel.querySelectorAll('.datetime-calendar__day').find(cell => cell.classes.has('is-today'));
  assert.equal(todayCell?.dataset.value, todayValue);
  assert.match(panel.querySelector('.datetime-calendar__today-btn').textContent, /^오늘 /);
  panel.querySelector('.datetime-calendar__today-btn').click();
  assert.equal(date.getValue(), todayValue);
  assert.deepEqual(sources, ['panel']);
  assert.equal(panel.hidden, true);

  // 두 달 뒤 날짜를 골라 두어도 오늘 달을 먼저 펼치고, 이동 버튼으로 그 달을 본다.
  const other = new Date(today.getFullYear(), today.getMonth() + 2, 15);
  const otherValue = ymd(other);
  date.setValue(otherValue);
  button.click();
  assert.equal(panel.querySelector('.datetime-calendar__month').textContent, `${Number(currentYear)}년 ${today.getMonth() + 1}월`);
  const jump = panel.querySelector('.datetime-calendar__jump-btn');
  assert.equal(jump.textContent, `${other.getMonth() + 1}.15(${'일월화수목금토'[other.getDay()]})로 이동`);
  jump.click();
  assert.equal(date.getValue(), otherValue, '이동 버튼은 값을 바꾸지 않는다');
  assert.equal(panel.querySelector('.datetime-calendar__month').textContent, `${other.getFullYear()}년 ${other.getMonth() + 1}월`);
  assert.equal(panel.querySelector('.datetime-calendar__jump-btn'), null, '고른 달을 보고 있으면 이동 버튼이 없다');
  const selected = panel.querySelectorAll('.datetime-calendar__day').filter(cell => cell.classes.has('is-selected'));
  assert.deepEqual(selected.map(cell => cell.dataset.value), [otherValue]);
  panel.querySelectorAll('.datetime-calendar__nav')[0].click();
  const previous = new Date(other.getFullYear(), other.getMonth() - 1, 1);
  assert.equal(panel.querySelector('.datetime-calendar__month').textContent, `${previous.getFullYear()}년 ${previous.getMonth() + 1}월`);
  assert.equal(panel.querySelectorAll('.datetime-calendar__day').length, new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate());
  const target = ymd(new Date(previous.getFullYear(), previous.getMonth(), 3));
  panel.querySelectorAll('.datetime-calendar__day').find(cell => cell.dataset.value === target).click();
  assert.equal(date.getValue(), target);
});

test('시간은 시만 적어도 정시로 보고, 한 자리 시(3~9)는 곧장 분 칸으로 넘어가며 범위 밖 숫자는 버린다', () => {
  resetDocument();
  const time = createTimeInput({ defaultHour: '09' });
  const [hour, minute] = time.root.querySelectorAll('.time-input__part');
  typeInto(hour, '1');
  assert.equal(time.getValue(), '01:00');
  assert.equal(document.activeElement, null);
  typeInto(hour, '13');
  assert.equal(document.activeElement, minute);
  assert.equal(time.getValue(), '13:00');
  hour.focus();
  typeInto(hour, '7');
  assert.equal(hour.value, '07');
  assert.equal(document.activeElement, minute);
  typeInto(hour, '25');
  assert.equal(hour.value, '2');
  typeInto(minute, '75');
  assert.equal(minute.value, '7');
  time.setValue('18:30');
  assert.equal(hour.value, '18');
  assert.equal(minute.value, '30');
  fire(hour, 'keydown', { key: 'ArrowUp' });
  assert.equal(time.getValue(), '19:30');
  fire(minute, 'keydown', { key: 'ArrowDown' });
  assert.equal(time.getValue(), '19:20');
});

test('시간 판은 시를 누르면 정시로 정하고 열린 채 두며, 분을 누르면 닫힌다', () => {
  resetDocument();
  const time = createTimeInput({ defaultHour: '09' });
  const button = time.root.querySelector('.time-input__button');
  const panel = time.root.querySelector('.time-input__panel');
  const sources = [];
  time.root.addEventListener('change', event => sources.push(event.detail?.source));
  const options = panel.querySelectorAll('.time-panel__option');
  assert.deepEqual(options.slice(0, 24).map(option => option.dataset.value), Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')));
  assert.deepEqual(options.slice(24).map(option => option.dataset.value), ['00', '10', '20', '30', '40', '50']);
  assert.deepEqual(panel.querySelectorAll('.time-panel__label').map(label => label.textContent), ['오전', '오후', '분']);
  button.click();
  assert.equal(panel.hidden, false);
  options.find(option => option.dataset.value === '13').click();
  assert.equal(time.getValue(), '13:00');
  assert.equal(panel.hidden, false, '시만 골라도 분을 이어서 고를 수 있게 열어 둔다');
  assert.equal(options.find(option => option.dataset.value === '13').getAttribute('aria-pressed'), 'true');
  assert.equal(options[24].getAttribute('aria-pressed'), 'true', '분 00 이 눌린 상태로 표시된다');
  options.find(option => option.dataset.value === '30' && option !== options[3]).click();
  assert.equal(time.getValue(), '13:30');
  assert.equal(panel.hidden, true);
  assert.deepEqual(sources, ['panel', 'panel']);
  time.setValue('');
  button.click();
  options[24 + 3].click();
  assert.equal(time.getValue(), '09:30', '시가 없을 때 분만 고르면 기본 시를 쓴다');
});

test('시간 보정은 입력 후 Enter로 확정하며 blur에서 중복 반영하지 않는다', () => {
  const { time, timeParts: [hour, minute], changes } = picker();
  hour.focus();
  typeInto(hour, '13');
  typeInto(minute, '27');
  assert.equal(minute.value, '27', '칸에 있는 동안은 값을 고치지 않는다');
  fire(time, 'keydown', { key: 'Enter' });
  assert.equal(minute.value, '30');
  fire(time, 'focusout', { relatedTarget: null });
  assert.deepEqual(changes, ['2026-09-13T13:30']);
});

test('달력 선택은 즉시 기본 시간과 함께 반영한다', () => {
  const { hidden, changes, calendarButton, calendar } = picker('');
  calendarButton.click();
  calendar.querySelectorAll('.datetime-calendar__day').find(cell => cell.dataset.value.endsWith('-15')).click();
  const expected = `${todayValue.slice(0, 8)}15T09:00`;
  assert.equal(hidden.value, expected);
  assert.deepEqual(changes, [expected]);
});

test('시간 판에서 시를 고르면 정시로 바로 반영하고 분은 이어서 고를 수 있다', () => {
  const { hidden, changes, clockButton, timePanel } = picker('2026-09-13T09:00');
  clockButton.click();
  const options = timePanel.querySelectorAll('.time-panel__option');
  options.find(option => option.dataset.value === '13').click();
  assert.equal(hidden.value, '2026-09-13T13:00');
  options[24 + 3].click();
  assert.equal(hidden.value, '2026-09-13T13:30');
  assert.deepEqual(changes, ['2026-09-13T13:00', '2026-09-13T13:30']);
});

test('연도를 비운 날짜는 칸을 벗어날 때 올해로 확정하고 연도 칸을 채운다', () => {
  const { hidden, date, dateParts: [year, month, day] } = picker('');
  month.focus();
  typeInto(month, '10');
  typeInto(day, '05');
  assert.equal(hidden.value, '', '아직 칸 안에 있으면 반영하지 않는다');
  document.activeElement = null;
  fire(date, 'focusout', { relatedTarget: null });
  assert.equal(hidden.value, `${currentYear}-10-05T09:00`);
  assert.equal(year.value, currentYear);
});

test('100년 미만 연도에 1900년을 더하지 않고 자정 보정을 유지한다', () => {
  assert.equal(normalizeDateTimeLocalStep('0020-09-13T09:00'), '0020-09-13T09:00');
  assert.equal(normalizeDateTimeLocalStep('2026-12-31T23:57'), '2027-01-01T00:00');
});
